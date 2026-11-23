import {quotaFailure} from '../features/quotas/contracts';
import {randomUUID} from 'node:crypto';
import {Prisma,type DashboardJob} from '@prisma/client';
import {dashboardDb} from '../server/db';
import {workerJobKinds} from './contracts';
export const DASHBOARD_JOB_KINDS=[...workerJobKinds];
const LEASE_MS=5*60*1000,MAX_ATTEMPTS=3;
export function retryDelay(attempt:number){return Math.min(3600000,Math.pow(2,Math.max(0,attempt-1))*30000);}
export async function recoverExpiredDashboardJobs(now=new Date()){
 const stale=await dashboardDb.dashboardJob.findMany({where:{status:'RUNNING',leaseExpiresAt:{lt:now}},select:{id:true,attempts:true,leaseToken:true,cancelRequestedAt:true,effectCommittedAt:true},take:100});let recovered=0;
 for(const job of stale){
  const committed=!!job.effectCommittedAt,terminal=job.attempts>=MAX_ATTEMPTS;
  const changed=await dashboardDb.dashboardJob.updateMany({where:{id:job.id,status:'RUNNING',leaseToken:job.leaseToken,leaseExpiresAt:{lt:now},effectCommittedAt:job.effectCommittedAt,cancelRequestedAt:job.cancelRequestedAt},data:{status:committed?'COMPLETED':job.cancelRequestedAt?'CANCELLED':terminal?'FAILED':'QUEUED',progress:committed?100:undefined,finishedAt:committed||job.cancelRequestedAt||terminal?now:null,leaseToken:null,leaseExpiresAt:null,lastError:committed?null:'LEASE_EXPIRED',availableAt:new Date(now.getTime()+retryDelay(job.attempts))}});recovered+=changed.count;
 }
 return recovered;
}
export async function claimDashboardJob(now=new Date()){
 // Prisma stores UTC timestamp-without-zone values. Explicit UTC literals keep
 // raw claims and leases correct when PostgreSQL uses a non-UTC session timezone.
 const token=randomUUID();
 const rows=await dashboardDb.$queryRaw<DashboardJob[]>(Prisma.sql`
  WITH candidate AS (
   SELECT id FROM "DashboardJob"
   WHERE status='QUEUED' AND "cancelRequestedAt" IS NULL AND "availableAt"<=${now.toISOString()}::timestamp AND attempts<${MAX_ATTEMPTS}
    AND kind IN (${Prisma.join(DASHBOARD_JOB_KINDS)})
   ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE "DashboardJob" j SET status='RUNNING',attempts=j.attempts+1,"leaseToken"=${token},"leaseExpiresAt"=${new Date(now.getTime()+LEASE_MS).toISOString()}::timestamp,"lastError"=NULL,"reconciledAt"=NULL,progress=0,"finishedAt"=NULL,"updatedAt"=${now.toISOString()}::timestamp
   FROM candidate WHERE j.id=candidate.id RETURNING j.*`);
 return rows[0]??null;
}
export async function renewDashboardJobLease(id:string,leaseToken:string,now=new Date()){
 return dashboardDb.dashboardJob.updateMany({where:{id,leaseToken,status:'RUNNING',cancelRequestedAt:null,leaseExpiresAt:{gt:now}},data:{leaseExpiresAt:new Date(now.getTime()+LEASE_MS)}});
}
const permanent=new Set(['REPORT_PAGE_LIMIT','REPORT_IMAGE_LIMIT','REPORT_OUTPUT_LIMIT','QUOTA_EXCEEDED','CONNECTOR_ACCOUNT_MISMATCH','CONNECTOR_OAUTH_REJECTED','CONNECTOR_PARTIAL_REPORT','CONNECTOR_WEBHOOK_REQUIRED','INVALID_RELATIONSHIP','RELATIONSHIP_CONFLICT','RELATIONSHIP_CARDINALITY','JOIN_LIMIT_EXCEEDED','EMPTY_JOIN','STORAGE_POLICY_REQUIRED','STORAGE_LEGAL_HOLD','STORAGE_OBJECT_RETIRED','INVALID_STORAGE_POLICY','CONNECTORS_DISABLED','CONNECTOR_NOT_CONFIGURED','CONNECTOR_DISCONNECTED','CONNECTOR_AUTH_REQUIRED','CONNECTOR_PERMISSION_REQUIRED','CONNECTOR_CHANGED','CONNECTOR_INVALID_RESPONSE','CONNECTOR_INVALID_HEADERS','CONNECTOR_INVALID_MAPPING','CONNECTOR_UNSTABLE_SNAPSHOT','CONNECTOR_EMPTY_SNAPSHOT','CONNECTOR_LIMIT_EXCEEDED','CONNECTOR_RESPONSE_TOO_LARGE','CONNECTOR_ENDPOINT_FORBIDDEN','CONNECTOR_REQUEST_REJECTED','SUBSCRIPTION_REQUIRED','INVALID_JOB_PAYLOAD','DATASET_UNAVAILABLE','SUPERSEDED_VERSION','VERSION_NO_LONGER_PENDING','SUPERSEDED_ANALYSIS','CONFIRMATION_REQUIRED','SOURCE_INTEGRITY_FAILURE','SOURCE_FORMAT_UNAVAILABLE','VERSION_CONFLICT','INVALID_CONFIRMED_FIELDS','ARTIFACT_CONFLICT','INVALID_TRANSFORMATION','EMPTY_TRANSFORMATION','CONNECTOR_UNAVAILABLE','ALERT_UNAVAILABLE','INVALID_ALERT_RULE','METRIC_UNAVAILABLE','REPORT_UNAVAILABLE','UNSUPPORTED_REPORT_FORMAT','INVALID_REPORT_DEFINITION','REPORT_EXPIRED','SCHEDULE_UNAVAILABLE','INVALID_RECIPIENTS','RECIPIENT_UNAVAILABLE','UNSUPPORTED_DELIVERY_TRANSPORT','DELIVERY_UNAVAILABLE','INVALID_STORAGE_SCOPE','INVALID_WIDGET_DIMENSION','TEMPLATE_UNAVAILABLE','STALE_ANALYSIS','TOO_MANY_CHART_GROUPS','CONFIRMED_TIMEZONE_REQUIRED']);
export function workerErrorCode(error:unknown){if(quotaFailure(error))return 'QUOTA_EXCEEDED';const code=error instanceof Error?error.message:String(error??'');return permanent.has(code)||['JOB_TIMEOUT','WORKER_SHUTDOWN','JOB_CANCELLED','JOB_CANCELLED_OR_LEASE_LOST','STORAGE_UNAVAILABLE','STORAGE_MAINTENANCE','STORAGE_OBJECT_CHANGED','IMPORT_IN_PROGRESS','CONNECTOR_RATE_LIMITED','CONNECTOR_REFRESH_BUSY','CONNECTOR_NETWORK_ERROR','CONNECTOR_PROVIDER_UNAVAILABLE'].includes(code)?code:'PROCESSING_FAILED';}
export async function finishDashboardJob(id:string,leaseToken:string,success:boolean,error?:string,result?:Prisma.InputJsonValue,retryAfterSeconds=0){
 const job=await dashboardDb.dashboardJob.findFirst({where:{id,leaseToken,status:'RUNNING',leaseExpiresAt:{gt:new Date()}},select:{attempts:true,cancelRequestedAt:true,effectCommittedAt:true,result:true}});if(!job)return {count:0};
 const committed=!!job.effectCommittedAt,cancelled=!committed&&(!!job.cancelRequestedAt||error==='JOB_CANCELLED');
 const retry=!committed&&!cancelled&&!success&&job.attempts<MAX_ATTEMPTS&&!permanent.has(error??'');
 return dashboardDb.dashboardJob.updateMany({where:{id,leaseToken,status:'RUNNING',cancelRequestedAt:job.cancelRequestedAt,effectCommittedAt:job.effectCommittedAt,leaseExpiresAt:{gt:new Date()}},data:{status:committed?'COMPLETED':cancelled?'CANCELLED':success?'COMPLETED':retry?'QUEUED':'FAILED',progress:(committed||success)&&!cancelled?100:undefined,result:committed?job.result as Prisma.InputJsonValue:success&&!cancelled?result:undefined,finishedAt:retry?null:new Date(),leaseToken:null,leaseExpiresAt:null,lastError:committed||success?null:workerErrorCode(error),availableAt:retry?new Date(Date.now()+Math.max(retryDelay(job.attempts),Math.min(3600,retryAfterSeconds)*1000)):new Date()}});
}
export async function reportDashboardJobProgress(id:string,leaseToken:string,progress:number){
 if(!Number.isInteger(progress)||progress<0||progress>99)throw Error('Invalid job progress.');
 const changed=await dashboardDb.dashboardJob.updateMany({where:{id,leaseToken,status:'RUNNING',cancelRequestedAt:null,leaseExpiresAt:{gt:new Date()},progress:{lte:progress}},data:{progress}});if(changed.count!==1)throw Error('JOB_CANCELLED_OR_LEASE_LOST');
}
