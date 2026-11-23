import {storageMutationGuard,lockStoragePolicy} from '../../features/storage/guard';
import {dashboardStorageBackend} from '../../features/storage/inventory';
import {planStorageCleanup,applyStorageCleanup} from '../../features/storage/lifecycle';
import {dashboardDb} from '../../server/db';
import {dashboardWorkspaceArtifactKey,deleteDashboardTemporaryObject} from '../../server/storage';
import {deleteExpiredReportArtifact} from '../../server/delete-report-artifact';
import {normalizeWorkerPayload} from '../contracts';
import {assertWorkerLease,publishWorkerEffect} from '../effects';
import type {DashboardProcessorJob} from '../processors';
async function holdCleanupPolicy(tx:import('@prisma/client').Prisma.TransactionClient,workspaceId:string){
 await storageMutationGuard(tx);await lockStoragePolicy(tx,workspaceId);await tx.$queryRaw`SELECT "workspaceId" FROM "DashboardStoragePolicy" WHERE "workspaceId"=${workspaceId} FOR UPDATE`;
 if((await tx.dashboardStoragePolicy.findUnique({where:{workspaceId}}))?.legalHold)throw Error('STORAGE_LEGAL_HOLD');
}
export async function processDataCleanup(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('DATA_CLEANUP',job.payload);
 const policy=await dashboardDb.dashboardStoragePolicy.findUnique({where:{workspaceId:job.workspaceId}});if(policy?.legalHold)throw Error('STORAGE_LEGAL_HOLD');
 let lifecycle:Record<string,number>={};
 if(p.lifecycle==='PLAN')lifecycle=await planStorageCleanup(job.workspaceId,tx=>assertWorkerLease(tx,job,signal),job.id,dashboardStorageBackend(signal));
 if(p.lifecycle==='APPLY')lifecycle=await applyStorageCleanup(job.workspaceId,tx=>assertWorkerLease(tx,job,signal),job.id,dashboardStorageBackend(signal));
 if(p.temporaryKeys.some(key=>!new RegExp('^temporary/'+job.workspaceId+'/[A-Za-z0-9_-]+\\.bin$').test(key)))throw Error('INVALID_STORAGE_SCOPE');
 for(const key of [...new Set(p.temporaryKeys)]){
  signal?.throwIfAborted();await dashboardDb.$transaction(async tx=>{await assertWorkerLease(tx,job,signal);await holdCleanupPolicy(tx,job.workspaceId);
   try{await deleteDashboardTemporaryObject(key);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&(error as NodeJS.ErrnoException).code!=='DASHBOARD_OBJECT_NOT_FOUND')throw error;}
  },{timeout:25000});
 }
 const expired=p.expiredReports?await dashboardDb.dashboardReportExport.findMany({where:{workspaceId:job.workspaceId,status:{in:['READY','CLEANUP_PENDING']},expiresAt:{lte:new Date()}},orderBy:{expiresAt:'asc'},take:100}):[];
 let removed=0;
 for(const item of expired){
  if(item.storageKey!==dashboardWorkspaceArtifactKey('reports',job.workspaceId,item.id))throw Error('INVALID_STORAGE_SCOPE');
  const marked=await dashboardDb.$transaction(async tx=>{
   await assertWorkerLease(tx,job,signal);await holdCleanupPolicy(tx,job.workspaceId);
   return tx.dashboardReportExport.updateMany({where:{id:item.id,workspaceId:job.workspaceId,status:{in:['READY','CLEANUP_PENDING']},expiresAt:{lte:new Date()}},data:{status:'CLEANUP_PENDING'}});
  });
  if(!marked.count)continue;
  await dashboardDb.$transaction(async tx=>{
   await assertWorkerLease(tx,job,signal);await holdCleanupPolicy(tx,job.workspaceId);
   await deleteExpiredReportArtifact(job.workspaceId,item.id);
   await tx.dashboardReportExport.updateMany({where:{id:item.id,workspaceId:job.workspaceId,status:'CLEANUP_PENDING'},data:{status:'EXPIRED'}});
  },{timeout:25000});removed++;
 }
 return publishWorkerEffect(job,async()=>({temporaryObjects:p.temporaryKeys.length,expiredReports:removed,...lifecycle} as Record<string,number>),signal);
}
