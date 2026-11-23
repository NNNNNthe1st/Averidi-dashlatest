import path from "node:path";

/**
 * Fail closed if the standalone Dashboard database is accidentally pointed at
 * a known website/Analyst database name. Operators must still provision a
 * physically separate database and credentials: name checking alone is not isolation.
 */
export function requireDashboardDatabaseUrl(value: string | undefined): string {
  if (!value || !value.trim()) throw new Error("DASHBOARD_DATABASE_URL must be configured.");
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("DASHBOARD_DATABASE_URL must be a valid PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Dashboard requires a PostgreSQL database.");
  if(!parsed.hostname || !parsed.username || !parsed.password || parsed.hash || parsed.searchParams.has("schema") && parsed.searchParams.get("schema") === "public_shared")
    throw new Error("Dashboard database requires dedicated host credentials and a non-shared connection.");
  let databaseName: string;
  try {databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();}
  catch {throw new Error("Dashboard database name is invalid.");}
  if (!databaseName || /^(averidi|averidi_dev|sales_solutions|analyst|postgres|template0|template1)$/.test(databaseName))
    throw new Error("Dashboard database must be distinct from the website and Analyst.");
  return value;
}

export function requireDashboardStorageRoot(value: string | undefined): string {
  if (!value?.trim()) throw new Error("DASHBOARD_STORAGE_ROOT must be configured.");
  const target = path.resolve(value);
  if (target === path.parse(target).root) throw new Error("Dashboard storage cannot be the filesystem root.");
  return target;
}
