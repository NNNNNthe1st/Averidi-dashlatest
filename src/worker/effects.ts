import {setAuditActor} from '../features/audit/context';
import {assertStorageQuota} from '../features/quotas/service';
import {withStorageMutation,storageMutationGuard} from '../features/storage/guard';
import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {dashboardDb} from '../server/db';
import {readDashboardObject,writeDashboardObject} from '../server/storage';
import type {DashboardProcessorJob} from './processors';
export function workerArtifactId(jobId:string,suffix=''){return 'job_'+createHash('sha256').update(jobId+':'+suffix).digest('hex');}
export async function assertWorkerLease(tx:Prisma.TransactionClient,job:DashboardProcessorJob,signal?:AbortSignal){
 await setAuditActor(tx,{issuer:'dashboard-worker',subject:job.id},'WORKER');
 signal?.throwIfAborted();
 if(job.deadlineAt!==undefined&&Date.now()>=job.deadlineAt)throw Error('JOB_TIMEOUT');
 if(!job.leaseToken)throw Error('JOB_CANCELLED_OR_LEASE_LOST');
 const held=await tx.dashboardJob.updateMany({where:{id:job.id,workspaceId:job.workspaceId,status:'RUNNING',leaseToken:job.leaseToken,cancelRequestedAt:null,leaseExpiresAt:{gt:new Date()}},data:{leaseExpiresAt:new Date(Date.now()+300000)}});
 if(held.count!==1)throw Error('JOB_CANCELLED_OR_LEASE_LOST');
}
export async function recordWorkerEffect(tx:Prisma.TransactionClient,job:DashboardProcessorJob,result:Prisma.InputJsonValue,signal?:AbortSignal){
 await assertWorkerLease(tx,job,signal);
 await tx.dashboardJob.update({where:{id:job.id},data:{result,effectCommittedAt:new Date()}});
}
export async function publishWorkerEffect<T extends Prisma.InputJsonValue>(job:DashboardProcessorJob,apply:(tx:Prisma.TransactionClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
 return dashboardDb.$transaction(async tx=>{
  await assertWorkerLease(tx,job,signal);
  const previous=await tx.dashboardJob.findUniqueOrThrow({where:{id:job.id},select:{effectCommittedAt:true,result:true}});
  if(previous.effectCommittedAt)return previous.result as T;
  const result=await apply(tx);
  await recordWorkerEffect(tx,job,result,signal);return result;
 },{timeout:30000});
}
export async function writeWorkerArtifact(key:string,bytes:Buffer,tx?:Prisma.TransactionClient){
 const apply=async()=>{
 try{await writeDashboardObject(key,bytes);}catch(error){
  // A crash may leave the immutable object before its database publication.
  // Replay accepts only identical bytes; arbitrary provider errors remain errors.
  let previous:Buffer;try{previous=await readDashboardObject(key);}catch{throw error;}
  if(!previous.equals(bytes))throw Error('ARTIFACT_CONFLICT');
 }
 };
 if(tx){await storageMutationGuard(tx,key);await assertStorageQuota(tx,key,bytes.length);return apply();}
 return withStorageMutation(key,apply,bytes.length);
}
