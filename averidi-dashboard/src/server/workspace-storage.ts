import {withStorageMutation} from '../features/storage/guard';
import {requireWorkspaceRole,type VerifiedDashboardActor} from './workspace-access';
import {validDashboardObjectKey} from './object-storage';
import {readDashboardObject,writeDashboardObject,deleteDashboardTemporaryObject,deleteDashboardUncommittedUpload} from './storage';

async function authorize(actor:VerifiedDashboardActor,workspaceId:string,key:string,write:boolean){
 if(!validDashboardObjectKey(key)||key.split('/')[1]!==workspaceId)throw new Error('FORBIDDEN');
 if(!await requireWorkspaceRole(actor,workspaceId,write?'EDITOR':'VIEWER'))throw new Error('FORBIDDEN');
}
/** Request-facing storage entry points; internal worker adapters remain server-only. */
export async function readWorkspaceObject(actor:VerifiedDashboardActor,workspaceId:string,key:string){
 await authorize(actor,workspaceId,key,false);
 return readDashboardObject(key);
}
export async function writeWorkspaceObject(actor:VerifiedDashboardActor,workspaceId:string,key:string,bytes:Uint8Array){
 await authorize(actor,workspaceId,key,true);
 await withStorageMutation(key,()=>writeDashboardObject(key,bytes),bytes.byteLength);
}
export async function deleteWorkspaceTemporaryObject(actor:VerifiedDashboardActor,workspaceId:string,key:string){
 await authorize(actor,workspaceId,key,true);
 await withStorageMutation(key,()=>deleteDashboardTemporaryObject(key));
}

/** Only remove a newly-written upload after a failed database commit. */
export async function deleteUncommittedWorkspaceUpload(actor:VerifiedDashboardActor,workspaceId:string,key:string){
 await authorize(actor,workspaceId,key,true);
 await withStorageMutation(key,()=>deleteDashboardUncommittedUpload(key));
}
