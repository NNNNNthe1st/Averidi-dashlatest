import {setAuditActor} from '../audit/context';
import {authorizedView,assertReportView} from '../sharing/access';
import {authorizeReportRecipients} from '../sharing/report-access';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dashboardDb} from '../../server/db';
import {requireAnalysisAccess} from '../analysis/service';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
export async function queueInAppReportDelivery(actor:VerifiedDashboardActor,workspaceId:string,input:unknown,key:string){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');
 const p=z.object({exportId:z.string().min(1).max(128),userId:z.string().min(1).max(128)}).strict().safeParse(input);
 if(!p.success||!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw Error('INVALID_JOB_PAYLOAD');
 return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  const lock='dashboard-delivery:'+JSON.stringify([workspaceId,key]);
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lock},0))`;
  if(!await tx.dashboardMembership.count({where:{workspaceId,userId:p.data.userId,role:{in:['OWNER','EDITOR','VIEWER']}}}))throw Error('RECIPIENT_UNAVAILABLE');
  if(!await tx.dashboardReportExport.count({where:{id:p.data.exportId,workspaceId,status:'READY',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}}))throw Error('REPORT_UNAVAILABLE');
  const artifact=await tx.dashboardReportExport.findFirstOrThrow({where:{id:p.data.exportId,workspaceId},include:{report:true}});await assertReportView(actor,workspaceId,artifact.report.viewId,'EDIT',tx);await authorizeReportRecipients(tx,workspaceId,artifact.report.viewId,[{userId:p.data.userId}]);await assertReportView(actor,workspaceId,artifact.sourceViewId,'VIEW',tx);await authorizeReportRecipients(tx,workspaceId,artifact.sourceViewId,[{userId:p.data.userId}]);
  const destination='user:'+p.data.userId;
  const delivery=await tx.dashboardReportDelivery.upsert({where:{workspaceId_idempotencyKey:{workspaceId,idempotencyKey:key}},update:{},create:{workspaceId,exportId:p.data.exportId,destination,idempotencyKey:key}});
  if(delivery.exportId!==p.data.exportId||delivery.destination!==destination)throw Error('IDEMPOTENCY_CONFLICT');
  const jobKey='delivery_'+createHash('sha256').update(delivery.id).digest('hex');
  const job=await tx.dashboardJob.upsert({where:{workspaceId_idempotencyKey:{workspaceId,idempotencyKey:jobKey}},update:{},create:{workspaceId,kind:'REPORT_DELIVER',payload:{deliveryId:delivery.id},idempotencyKey:jobKey}});
  return {deliveryId:delivery.id,jobId:job.id};
 });
}
