import {createHash} from 'node:crypto';
import {observeDuration,flushObservations} from '../features/observability/metrics';
import {structuredDiagnostic} from '../features/observability/contracts';
import {reconcileSourceMonitoringForJob,monitoringFailure} from '../features/monitoring/sources';
import {ConnectorError} from '../features/connectors/contracts';
import {reconcileTerminalReportDeliveries} from './delivery-failure';
import {claimDashboardJob,finishDashboardJob,recoverExpiredDashboardJobs,renewDashboardJobLease,reportDashboardJobProgress,workerErrorCode} from './job-claim';
import {processDashboardJob} from './processors';
import {dashboardDb} from '../server/db';
import {evaluateDashboardSubscription,evaluateDashboardTrial} from '../features/subscriptions/entitlements';
import {markFailedDashboardProfile,reconcileTerminalDashboardProfiles} from './profile-failure';
import {dashboardWorkerSettings} from './settings';
import type {Prisma} from '@prisma/client';
export async function runDashboardWorkerOnce(signal?:AbortSignal,onClaim?:(jobId:string)=>Promise<void>){
 const {timeout}=dashboardWorkerSettings();signal?.throwIfAborted();
 await recoverExpiredDashboardJobs();await reconcileTerminalDashboardProfiles();await reconcileTerminalReportDeliveries();
 const job=await claimDashboardJob();if(!job)return {claimed:false as const};if(!job.leaseToken)throw Error('Claimed job has no lease.');
 const observedStart=performance.now();
 const deadlineAt=Date.now()+timeout;const controller=new AbortController();const stop=()=>controller.abort(Error('WORKER_SHUTDOWN'));
 signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
 const deadline=setTimeout(()=>controller.abort(Error('JOB_TIMEOUT')),timeout);deadline.unref();
 let pending:Promise<unknown>|null=null,lastRenewal=Date.now();
 const poll=setInterval(()=>{
  if(pending)return;
  pending=(async()=>{
   const current=await dashboardDb.dashboardJob.findFirst({where:{id:job.id,workspaceId:job.workspaceId,leaseToken:job.leaseToken,status:'RUNNING'},select:{cancelRequestedAt:true,leaseExpiresAt:true,effectCommittedAt:true}});
   if(!current||!current.leaseExpiresAt||current.leaseExpiresAt<=new Date())controller.abort(Error('JOB_CANCELLED_OR_LEASE_LOST'));
   else if(current.cancelRequestedAt&&!current.effectCommittedAt)controller.abort(Error('JOB_CANCELLED'));
   else if(Date.now()-lastRenewal>=60000){if((await renewDashboardJobLease(job.id,job.leaseToken!)).count!==1)controller.abort(Error('JOB_CANCELLED_OR_LEASE_LOST'));lastRenewal=Date.now();}
  })().catch(()=>controller.abort(Error('JOB_CANCELLED_OR_LEASE_LOST'))).finally(()=>{pending=null;});
 },1000);poll.unref();
 try{
  await onClaim?.(job.id);controller.signal.throwIfAborted();
  if(!job.effectCommittedAt&&job.kind!=='DATA_CLEANUP'){
   const subscription=await dashboardDb.dashboardSubscription.findUnique({where:{workspaceId:job.workspaceId},select:{planCode:true,status:true,currentPeriodEnd:true,accessSuspended:true,billingPlan:{select:{active:true,entitlements:true}}}});
   const workspace=await dashboardDb.dashboardWorkspace.findUnique({where:{id:job.workspaceId},select:{trialStartedAt:true}});
   const trialActive=Boolean(!subscription?.accessSuspended&&workspace?.trialStartedAt&&evaluateDashboardTrial(workspace.trialStartedAt).active);
   if(!evaluateDashboardSubscription(subscription).active&&!trialActive)throw Error('SUBSCRIPTION_REQUIRED');
  }
  await reportDashboardJobProgress(job.id,job.leaseToken,10);
  const result=job.effectCommittedAt?job.result as Prisma.InputJsonValue:await processDashboardJob({...job,deadlineAt},controller.signal);
  await reportDashboardJobProgress(job.id,job.leaseToken,90);
  const done=await finishDashboardJob(job.id,job.leaseToken,true,undefined,result);if(done.count!==1)throw Error('JOB_CANCELLED_OR_LEASE_LOST');
  const final=await dashboardDb.dashboardJob.findUniqueOrThrow({where:{id:job.id},select:{status:true}});return {claimed:true as const,jobId:job.id,status:final.status};
 }catch(error){
  const finished=await finishDashboardJob(job.id,job.leaseToken,false,workerErrorCode(error),undefined,error instanceof ConnectorError?error.retryAfterSeconds:0);
  if(finished.count===1){await markFailedDashboardProfile(job);await reconcileTerminalReportDeliveries();}
  throw error;
 }finally{clearInterval(poll);clearTimeout(deadline);signal?.removeEventListener('abort',stop);if(pending)await pending;
  const final=await dashboardDb.dashboardJob.findFirst({where:{id:job.id,workspaceId:job.workspaceId},select:{status:true,lastError:true}}).catch(()=>null);
  const duration=performance.now()-observedStart;observeDuration('JOB',job.kind,final?.status??'UNKNOWN',duration);console.log(structuredDiagnostic('job_finished',{kind:job.kind,outcome:final?.status??'UNKNOWN',durationMs:duration,code:final?.lastError??undefined,correlationId:createHash('sha256').update(job.id).digest('hex').slice(0,32)}));
  await reconcileSourceMonitoringForJob(job).catch(monitoringFailure);void flushObservations();
 }
}
if(process.argv[1]?.endsWith('run-once.ts'))runDashboardWorkerOnce().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Dashboard worker iteration failed.');process.exitCode=1;}).finally(()=>dashboardDb.$disconnect());
