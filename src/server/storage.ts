import { mkdir, open, realpath, rm, lstat, link } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireDashboardStorageRoot } from "./data-boundary";

// This application never falls back to the main website's upload directory.
export function dashboardStorageRoot(): string {
  return requireDashboardStorageRoot(process.env.DASHBOARD_STORAGE_ROOT);
}

export function dashboardStorageKey(workspaceId: string, datasetId: string, versionId: string): string {
  for (const id of [workspaceId, datasetId, versionId]) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid Dashboard storage identifier.");
  }
  return ["uploads", workspaceId, datasetId, versionId, "source.bin"].join("/");
}

export type DashboardStorageArea = "processed" | "snapshots" | "reports" | "exports" | "temporary";
export function dashboardWorkspaceArtifactKey(area: DashboardStorageArea, workspaceId: string, artifactId: string): string {
  if (!["processed","snapshots","reports","exports","temporary"].includes(area) ||
      ![workspaceId,artifactId].every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)))
    throw new Error("Invalid Dashboard storage artifact identifier.");
  return [area,workspaceId,artifactId+".bin"].join("/");
}

export function dashboardStoragePath(key: string): string {
  if (!key || key.includes("\\") || path.posix.isAbsolute(key) ||
      !/^(?:uploads\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/source\.bin|(?:processed|snapshots|reports|exports|temporary)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.bin)$/.test(key) ||
      key.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid Dashboard storage key.");
  }
  const root = dashboardStorageRoot();
  const resolved = path.resolve(root, ...key.split("/"));
  if (!resolved.startsWith(root + path.sep)) throw new Error("Storage key escapes Dashboard storage.");
  return resolved;
}

export async function writeDashboardObject(key: string, bytes: Uint8Array): Promise<void> {
  if(process.env.DASHBOARD_STORAGE_BACKEND==="object"){
    const {requestDashboardObject}=await import("./object-storage");
    await requestDashboardObject(key,"PUT",bytes);
    return;
  }
  if(process.env.DASHBOARD_STORAGE_BACKEND && process.env.DASHBOARD_STORAGE_BACKEND!=="local")throw new Error("Invalid Dashboard storage backend.");
  const target = dashboardStoragePath(key);
  const root = dashboardStorageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const realRoot = await realpath(root);
  if (realRoot !== root) throw new Error("Dashboard storage root must not be a symlink.");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || (rootStat.mode & 0o077)) throw new Error("Dashboard storage root must be private (0700).");
  let parent = root;
  for (const segment of key.split("/").slice(0,-1)) {
    parent = path.join(parent,segment);
    await mkdir(parent,{mode:0o700}).catch(error=>{if(error.code!=="EEXIST")throw error;});
    const stat=await lstat(parent);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("Dashboard storage parent must be a real directory.");
  }
  const realParent = await realpath(path.dirname(target));
  if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
    throw new Error("Dashboard storage parent escapes its root.");
  }
  const temporary = target + ".tmp-" + randomUUID();
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    // No replacement of existing immutable dataset versions.
    await link(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readDashboardObject(key: string): Promise<Buffer> {
  if(process.env.DASHBOARD_STORAGE_BACKEND==="object"){
    const {requestDashboardObject}=await import("./object-storage");
    const result=await requestDashboardObject(key,"GET");
    if(!Buffer.isBuffer(result))throw new Error("Dashboard object read returned no bytes.");
    return result;
  }
  if(process.env.DASHBOARD_STORAGE_BACKEND && process.env.DASHBOARD_STORAGE_BACKEND!=="local")throw new Error("Invalid Dashboard storage backend.");
  const target = dashboardStoragePath(key);
  const configuredRoot = dashboardStorageRoot();
  const root = await realpath(configuredRoot);
  if (root !== configuredRoot) throw new Error("Dashboard storage root must not be a symlink.");
  const parent = await realpath(path.dirname(target));
  if (parent !== path.dirname(target) || (parent !== root && !parent.startsWith(root + path.sep))) {
    throw new Error("Dashboard storage parent escapes its root.");
  }
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Invalid Dashboard file.");
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error("Dashboard file changed during access.");
    return await handle.readFile();
  } finally { await handle.close(); }
}

/**
 * Remove an unregistered upload after an aborted version transaction.
 * Call only for a freshly generated, unique upload key, after confirming no
 * database version references it. Never use this for committed versions.
 */
export async function deleteDashboardUncommittedUpload(key:string):Promise<void>{
 if(!/^uploads\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/source\.bin$/.test(key))throw new Error("INVALID_UNCOMMITTED_UPLOAD_KEY");
 if(process.env.DASHBOARD_STORAGE_BACKEND==="object"){
  const {requestDashboardObject}=await import("./object-storage");
  await requestDashboardObject(key,"DELETE");return;
 }
 if(process.env.DASHBOARD_STORAGE_BACKEND&&process.env.DASHBOARD_STORAGE_BACKEND!=="local")throw new Error("Invalid Dashboard storage backend.");
 const target=dashboardStoragePath(key),root=await realpath(dashboardStorageRoot());
 const parent=await realpath(path.dirname(target));
 if(parent!==path.dirname(target)||!parent.startsWith(root+path.sep))throw new Error("Invalid Dashboard storage parent.");
 const stat=await lstat(target);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Invalid Dashboard upload.");
 await rm(target);
}

/** Cleanup is deliberately limited to temporary workspace objects, never retained data. */
export async function deleteDashboardTemporaryObject(key: string): Promise<void> {
  if (!key.startsWith("temporary/")) throw new Error("Only temporary Dashboard objects can be deleted here.");
  if (process.env.DASHBOARD_STORAGE_BACKEND === "object") {
    const { requestDashboardObject } = await import("./object-storage");
    await requestDashboardObject(key, "DELETE");
    return;
  }
  // Validate backend, object type and containment using the same path as reads.
  await readDashboardObject(key);
  await rm(dashboardStoragePath(key));
}
