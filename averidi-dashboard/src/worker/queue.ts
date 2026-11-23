import {auditedWrite} from '../features/audit/service';
import {setAuditActor} from '../features/audit/context';
import {assertDashboardAdmission} from '../features/administration/configuration';
import {assertCustomPermission} from '../features/permissions/policy';
import {jobPermission} from '../features/permissions/catalog';
import {authorizeReportWork} from '../features/sharing/report-access';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../server/db';
import {requireWorkspaceRole,type VerifiedDashboardActor} from '../server/workspace-access';
import {requireDashboardEntitlement} from '../features/subscriptions/entitlements';
import {normalizeWorkerPayload} from './contracts';
import {assertWorkerResourceScope,assertReportScheduleRecipients} from './resource-scope';
export function validateDashboardJob(kind:string,payload:unknown){return normalizeWorkerPayload(kind,payload);}
export async function enqueueDashboardJob(workspaceId:string,kind:string,payload:unknown,idempotencyKey:string,availableAt=new Date(),actor?:VerifiedDashboardActor){
 const normalized=validateDashboardJob(kind,payload);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)||!Number.isFinite(availableAt.getTime()))throw Error('INVALID_JOB_KEY');
 return dashboardDb.$transaction(async tx=>{
  if(actor)await setAuditActor(tx,actor);
  const lock='dashboard-job:'+JSON.stringify([workspaceId,idempotencyKey]);
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lock},0))`;
  await assertWorkerResourceScope(tx,workspaceId,kind,normalized);
  const job=await tx.dashboardJob.upsert({where:{workspaceId_idempotencyKey:{workspaceId,idempotencyKey}},update:{},create:{workspaceId,kind,payload:normalized as Prisma.InputJsonValue,idempotencyKey,availableAt}});
  if(job.kind!==kind||!isDeepStrictEqual(job.payload,normalized))throw Error('IDEMPOTENCY_CONFLICT');return job;
 });
}
export async function enqueueActorDashboardJob(actor:VerifiedDashboardActor,workspaceId:string,kind:string,payload:unknown,key:string){
 if(!await requireWorkspaceRole(actor,workspaceId,'EDITOR'))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,jobPermission(kind));
 if(kind==='DATA_CLEANUP'&&payload&&typeof payload==='object'&&'lifecycle' in payload&&payload.lifecycle!==undefined&&!await requireWorkspaceRole(actor,workspaceId,'OWNER'))throw Error('FORBIDDEN');
 if(!await requireDashboardEntitlement(actor,workspaceId))throw Error('SUBSCRIPTION_REQUIRED');
 await authorizeReportWork(actor,workspaceId,kind,payload);
 return enqueueDashboardJob(workspaceId,kind,payload,key,new Date(),actor);
}
export async function cancelActorDashboardJob(actor:VerifiedDashboardActor,workspaceId:string,id:string){
 if(!await requireWorkspaceRole(actor,workspaceId,'EDITOR'))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,'jobs.manage');
 const now=new Date();
 await auditedWrite(actor,tx=>tx.dashboardJob.updateMany({where:{id,workspaceId,status:'QUEUED',effectCommittedAt:null},data:{status:'CANCELLED',cancelRequestedAt:now,finishedAt:now}}));
 await dashboardDb.dashboardJob.updateMany({where:{id,workspaceId,status:'RUNNING',effectCommittedAt:null},data:{cancelRequestedAt:now}});
 return dashboardDb.dashboardJob.findFirst({where:{id,workspaceId},select:{id:true,status:true,progress:true,cancelRequestedAt:true,effectCommittedAt:true}});
}
export async function scheduleDashboardJob(workspaceId:string,kind:string,payload:unknown,intervalSeconds:number,nextRunAt:Date){
 const normalized=validateDashboardJob(kind,payload);
 if(!Number.isInteger(intervalSeconds)||intervalSeconds<60||intervalSeconds>2592000||!Number.isFinite(nextRunAt.getTime()))throw Error('INVALID_SCHEDULE');
 return dashboardDb.$transaction(async tx=>{await assertDashboardAdmission(tx,'SCHEDULE_CREATION_ENABLED');await assertWorkerResourceScope(tx,workspaceId,kind,normalized);return tx.dashboardJobSchedule.create({data:{workspaceId,kind,payload:normalized as Prisma.InputJsonValue,intervalSeconds,nextRunAt}});});
}
export async function dispatchDueDashboardSchedules(now=new Date()){
 const due=await dashboardDb.dashboardJobSchedule.findMany({where:{enabled:true,nextRunAt:{lte:now}},orderBy:{nextRunAt:'asc'},take:100});let dispatched=0;
 for(const schedule of due){
  try{await dashboardDb.$transaction(async tx=>{
   const changed=await tx.dashboardJobSchedule.updateMany({where:{id:schedule.id,enabled:true,nextRunAt:schedule.nextRunAt},data:{nextRunAt:new Date(now.getTime()+schedule.intervalSeconds*1000),lastErrorCode:null}});if(changed.count!==1)return;
   const payload=await assertWorkerResourceScope(tx,schedule.workspaceId,schedule.kind,schedule.payload);
   const key='schedule_'+createHash('sha256').update(schedule.id+':'+schedule.nextRunAt.toISOString()).digest('hex');
   await tx.dashboardJob.upsert({where:{workspaceId_idempotencyKey:{workspaceId:schedule.workspaceId,idempotencyKey:key}},update:{},create:{workspaceId:schedule.workspaceId,kind:schedule.kind,payload,idempotencyKey:key}});dispatched++;
  });}catch(error){if(!['UNSUPPORTED_JOB_KIND','INVALID_JOB_PAYLOAD','RELATIONSHIP_CONFLICT','DATASET_UNAVAILABLE','ALERT_UNAVAILABLE','REPORT_UNAVAILABLE','DELIVERY_UNAVAILABLE','SCHEDULE_UNAVAILABLE','INVALID_STORAGE_SCOPE'].includes(error instanceof Error?error.message:''))throw error;await dashboardDb.dashboardJobSchedule.updateMany({where:{id:schedule.id,enabled:true,nextRunAt:schedule.nextRunAt},data:{enabled:false,lastErrorCode:error instanceof Error?error.message:'INVALID_SCHEDULE'}});}
 }
 return dispatched;
}
export async function dispatchDueReportSchedules(now=new Date()){
 const due=await dashboardDb.dashboardReportSchedule.findMany({where:{enabled:true,nextRunAt:{lte:now}},orderBy:{nextRunAt:'asc'},take:100});let dispatched=0;
 for(const schedule of due){
  try{await dashboardDb.$transaction(async tx=>{
   const changed=await tx.dashboardReportSchedule.updateMany({where:{id:schedule.id,enabled:true,nextRunAt:schedule.nextRunAt},data:{nextRunAt:new Date(now.getTime()+schedule.intervalSeconds*1000),lastErrorCode:null}});if(!changed.count)return;
   if(schedule.intervalSeconds<60)throw Error('INVALID_SCHEDULE');
   await assertReportScheduleRecipients(tx,schedule.workspaceId,schedule.recipients);
   const key='report_schedule_'+createHash('sha256').update(schedule.id+':'+schedule.nextRunAt.toISOString()).digest('hex');
   await tx.dashboardJob.upsert({where:{workspaceId_idempotencyKey:{workspaceId:schedule.workspaceId,idempotencyKey:key}},update:{},create:{workspaceId:schedule.workspaceId,kind:'REPORT_GENERATE',payload:{reportId:schedule.reportId,scheduleId:schedule.id},idempotencyKey:key}});dispatched++;
  });}catch(error){if(!['INVALID_SCHEDULE','INVALID_RECIPIENTS','RECIPIENT_UNAVAILABLE'].includes(error instanceof Error?error.message:''))throw error;await dashboardDb.dashboardReportSchedule.updateMany({where:{id:schedule.id,enabled:true,nextRunAt:schedule.nextRunAt},data:{enabled:false,lastErrorCode:error instanceof Error?error.message:'INVALID_SCHEDULE'}});}
 }
 return dispatched;
}
