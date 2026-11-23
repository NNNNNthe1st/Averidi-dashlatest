import {assertStorageQuota} from '../quotas/service';
import type {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {storageMaintenanceKey} from './inventory';
export async function storageMutationGuard(tx:Prisma.TransactionClient,key?:string){
 await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(hashtextextended('dashboard-storage-maintenance',0))`;
 if(await tx.dashboardStorageMaintenance.count({where:{id:'storage',expiresAt:{gt:new Date()}}}))throw Error('STORAGE_MAINTENANCE');
 if(key){if(!storageMaintenanceKey(key))throw Error('INVALID_STORAGE_SCOPE');const workspaceId=key.split('/')[1];
  const [scope]=await tx.$queryRaw<{allowed:boolean}[]>`SELECT pg_try_advisory_xact_lock_shared(hashtextextended(${'dashboard-erasure-workspace:'+workspaceId},0)) AS allowed`;if(!scope.allowed)throw Error('ACCOUNT_ERASURE_BUSY');
  const workspace=await tx.dashboardWorkspace.findUnique({where:{id:workspaceId},select:{erasureRequestId:true}});if(workspace?.erasureRequestId)throw Error('WORKSPACE_ERASING');
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'dashboard-storage-object:'+workspaceId+':'+key},0))`;
  if(await tx.dashboardStorageDeletion.count({where:{workspaceId,storageKey:key,status:{in:['DELETING','DELETED']}}}))throw Error('STORAGE_OBJECT_RETIRED');
 }
}
export async function withStorageMutation<T>(key:string,apply:()=>Promise<T>,bytes?:number){return dashboardDb.$transaction(async tx=>{await storageMutationGuard(tx,key);if(bytes!==undefined)await assertStorageQuota(tx,key,bytes);return apply();},{timeout:25000});}

export async function lockStoragePolicy(tx:Prisma.TransactionClient,workspaceId:string){await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'dashboard-storage-policy:'+workspaceId},0))`;}
