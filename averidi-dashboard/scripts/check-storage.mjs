import {mkdir,realpath,lstat} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import * as storageModule from "../src/server/storage.ts";
const {dashboardStorageRoot,dashboardWorkspaceArtifactKey,writeDashboardObject,readDashboardObject,deleteDashboardTemporaryObject}=storageModule.default??storageModule;
import * as objectModule from "../src/server/object-storage.ts";
const {dashboardObjectConfig}=objectModule.default??objectModule;
const backend=process.env.DASHBOARD_STORAGE_BACKEND??"local";
if(backend==="local"){
 const root=dashboardStorageRoot();
 await mkdir(root,{recursive:true,mode:0o700});
 if(await realpath(root)!==root)throw new Error("Storage root must not be a symlink.");
 const stat=await lstat(root);
 if(!stat.isDirectory()||(stat.mode&0o077))throw new Error("Storage root must be private (0700).");
}else if(backend==="object")dashboardObjectConfig();
else throw new Error("Unknown Dashboard storage backend.");
if(process.env.DASHBOARD_STORAGE_WRITE_CHECK==="true"){
 const id=randomUUID();
 const key=dashboardWorkspaceArtifactKey("temporary","infrastructure_check",id);
 const bytes=Buffer.from("dashboard-storage-check:"+id);
 let written=false;
 try{
  await writeDashboardObject(key,bytes);
  written=true;
  if(!(await readDashboardObject(key)).equals(bytes))throw new Error("Storage read-back mismatch.");
  let rejected=false;try{await writeDashboardObject(key,Buffer.from("overwrite"));}catch{rejected=true;}
  if(!rejected)throw new Error("Storage allowed immutable overwrite.");
 }finally{if(written)await deleteDashboardTemporaryObject(key);}
 console.log("Dashboard storage write/read/immutability/cleanup passed.");
}else console.log("Dashboard storage configuration passed.");
