import {rm} from 'node:fs/promises';
import {dashboardWorkspaceArtifactKey,dashboardStoragePath,readDashboardObject} from './storage';
import {dashboardObjectConfig,signedDashboardObjectRequest} from './object-storage';
/** Internal cleanup primitive. Caller must hold an expired export record and job lease. */
export async function deleteExpiredReportArtifact(workspaceId:string,exportId:string){
 const key=dashboardWorkspaceArtifactKey('reports',workspaceId,exportId);
 if(process.env.DASHBOARD_STORAGE_BACKEND==='object'){
  const signed=signedDashboardObjectRequest(dashboardObjectConfig(),key,'DELETE');
  const response=await fetch(signed.url,{method:'DELETE',headers:signed.headers,redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok&&response.status!==404)throw Error('STORAGE_UNAVAILABLE');return;
 }
 try{await readDashboardObject(key);await rm(dashboardStoragePath(key));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
