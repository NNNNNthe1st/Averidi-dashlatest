import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {setAuditActor} from '../audit/context';
import {requireAnalysisAccess} from '../analysis/service';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
import {ANALYSIS_ENGINE_VERSION} from '../../engines/analysis/pipeline';
import {sourcePolicySchema,sourceIncidentAckSchema,sourceFreshness,sourceIncidentMessages} from './source-contracts';
import {structuredDiagnostic} from '../observability/contracts';

type Code=keyof typeof sourceIncidentMessages;
/** Source row lock serializes policy/incident decisions across workers and web processes. */
async function assessSource(sourceId:string,workspaceId:string){
 return db.$transaction(async tx=>{
  await setAuditActor(tx,{issuer:'averidi-dashboard-worker',subject:'source-monitoring'},'WORKER');
  await tx.$queryRaw`SELECT id FROM "DashboardDataSource" WHERE id=${sourceId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const source=await tx.dashboardDataSource.findFirst({where:{id:sourceId,workspaceId}});if(!source)return;
  const [clock]=await tx.$queryRaw<{now:Date}[]>`SELECT now() AT TIME ZONE 'UTC' AS now`;
  const now=clock.now,policy=await tx.dashboardSourceMonitoringPolicy.findUnique({where:{sourceId_workspaceId:{sourceId,workspaceId}}});
  const datasets=await tx.dashboardDataset.findMany({where:{workspaceId,sourceId,status:{not:'ARCHIVED'}},select:{id:true}}),ids=datasets.map(d=>d.id);
  const sourceJobs={workspaceId,OR:[{payload:{path:['sourceId'],equals:sourceId}},...ids.map(id=>({payload:{path:['datasetId'],equals:id}}))]};
  const active=await tx.dashboardJob.count({where:{...sourceJobs,kind:{in:['SOURCE_REFRESH','DATASET_PROFILE','DATASET_INGEST']},status:{in:['QUEUED','RUNNING']}}});
  const previousRefresh=await tx.dashboardSourceIncident.findUnique({where:{sourceId_workspaceId_kind:{sourceId,workspaceId,kind:'REFRESH_FAILURE'}}});
  const recovering=Boolean(previousRefresh&&previousRefresh.status!=='RESOLVED'&&(!source.lastSyncedAt||source.lastSyncedAt<=previousRefresh.occurredAt));
  const refreshFailed=!active&&['FAILED','EXPIRED'].includes(source.status)||recovering;
  const blocked=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "DashboardAnalysisRun" r JOIN "DashboardDataset" d ON d."activeVersionId"=r."versionId" AND d.id=r."datasetId" AND d."workspaceId"=r."workspaceId" JOIN "DashboardDatasetVersion" v ON v.id=r."versionId" AND v."semanticRevision"=r."semanticRevision" WHERE d."workspaceId"=${workspaceId} AND d."sourceId"=${sourceId} AND d.status<>'ARCHIVED' AND r."engineVersion"=${ANALYSIS_ENGINE_VERSION} AND r.status='BLOCKED'`;
  const failed=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "DashboardDataset" d JOIN "DashboardDatasetVersion" v ON v.id=d."activeVersionId" LEFT JOIN LATERAL (SELECT j.status,j."finishedAt" FROM "DashboardJob" j WHERE j."workspaceId"=d."workspaceId" AND j.kind IN ('DATASET_ANALYZE','METRICS_CALCULATE') AND j.payload->>'datasetId'=d.id AND j.payload->>'versionId'=v.id AND j.payload->>'semanticRevision'=v."semanticRevision"::text ORDER BY j."createdAt" DESC,j.id DESC LIMIT 1) last_job ON true LEFT JOIN LATERAL (SELECT r."createdAt" FROM "DashboardAnalysisRun" r WHERE r."datasetId"=d.id AND r."versionId"=v.id AND r."semanticRevision"=v."semanticRevision" AND r."engineVersion"=${ANALYSIS_ENGINE_VERSION} ORDER BY r."createdAt" DESC LIMIT 1) last_run ON true WHERE d."workspaceId"=${workspaceId} AND d."sourceId"=${sourceId} AND d.status<>'ARCHIVED' AND last_job.status='FAILED' AND (last_run."createdAt" IS NULL OR last_job."finishedAt">last_run."createdAt")`;
  const previousMetric=await tx.dashboardSourceIncident.findUnique({where:{sourceId_workspaceId_kind:{sourceId,workspaceId,kind:'METRIC_FAILURE'}}});
  const incomplete=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "DashboardDataset" d LEFT JOIN "DashboardDatasetVersion" v ON v.id=d."activeVersionId" WHERE d."workspaceId"=${workspaceId} AND d."sourceId"=${sourceId} AND d.status<>'ARCHIVED' AND NOT EXISTS (SELECT 1 FROM "DashboardAnalysisRun" r WHERE r."datasetId"=d.id AND r."versionId"=v.id AND r."semanticRevision"=v."semanticRevision" AND r."engineVersion"=${ANALYSIS_ENGINE_VERSION} AND r.status='READY' AND COALESCE((SELECT j.status FROM "DashboardJob" j WHERE j."workspaceId"=d."workspaceId" AND j.kind IN ('DATASET_ANALYZE','METRICS_CALCULATE') AND j.payload->>'datasetId'=d.id AND j.payload->>'versionId'=v.id AND j.payload->>'semanticRevision'=v."semanticRevision"::text ORDER BY j."createdAt" DESC,j.id DESC LIMIT 1),'COMPLETED')='COMPLETED')`;
  const pendingReview=Boolean(previousMetric&&previousMetric.status!=='RESOLVED'&&Number(incomplete[0]?.count)>0);
  const metricFailed=Number(blocked[0]?.count)>0||Number(failed[0]?.count)>0||pendingReview;
  const freshness=sourceFreshness(source.lastSyncedAt,policy?.updatedAt??source.createdAt,policy?.maxAgeMinutes??null,now);
  const inactive=['DISCONNECTED','ARCHIVED'].includes(source.status);
  const checks:{kind:string;active:boolean;code:Code}[]=[
   {kind:'REFRESH_FAILURE',active:!inactive&&refreshFailed&&(policy?.notifyFailures??true),code:source.status==='EXPIRED'?'SOURCE_AUTH_REQUIRED':'SOURCE_REFRESH_FAILED'},
   {kind:'METRIC_FAILURE',active:!inactive&&Boolean(metricFailed)&&(policy?.notifyMetricFailures??true),code:Number(blocked[0]?.count)>0?'METRIC_VALIDATION_FAILED':Number(failed[0]?.count)>0?'METRIC_PROCESSING_FAILED':'METRIC_REVIEW_REQUIRED'},
   {kind:'STALE_SOURCE',active:!inactive&&freshness.stale,code:source.lastSyncedAt?'SOURCE_OVERDUE':'SOURCE_NEVER_REFRESHED'},
  ];
  for(const check of checks){
   const key={sourceId,workspaceId,kind:check.kind},previous=await tx.dashboardSourceIncident.findUnique({where:{sourceId_workspaceId_kind:key}});
   if(check.active){
    if(!previous)await tx.dashboardSourceIncident.create({data:{...key,code:check.code,occurredAt:now,observedAt:now}});
    else if(previous.status==='RESOLVED')await tx.dashboardSourceIncident.update({where:{id:previous.id},data:{status:'OPEN',code:check.code,generation:{increment:1},occurredAt:now,observedAt:now,resolvedAt:null,acknowledgedAt:null}});
    else if(previous.code!==check.code)await tx.dashboardSourceIncident.update({where:{id:previous.id},data:{code:check.code,observedAt:now}});
   }else if(previous&&previous.status!=='RESOLVED')await tx.dashboardSourceIncident.update({where:{id:previous.id},data:{status:'RESOLVED',resolvedAt:now,observedAt:now}});
  }
 },{timeout:15000,maxWait:3000});
}
/** Bounded keyset sweeps; caller carries cursor so large installations cannot starve later sources. */
export async function sweepSourceMonitoring(afterId?:string){
 const sources=await db.dashboardDataSource.findMany({where:{...(afterId?{id:{gt:afterId}}:{})},orderBy:{id:'asc'},take:100,select:{id:true,workspaceId:true}});
 for(const source of sources)await assessSource(source.id,source.workspaceId);
 return sources.length===100?sources.at(-1)!.id:undefined;
}
export async function reconcileSourceMonitoringForJob(job:{workspaceId:string;payload:unknown}){
 const p=job.payload&&typeof job.payload==='object'&&!Array.isArray(job.payload)?job.payload as Record<string,unknown>:{};
 const source=typeof p.sourceId==='string'?await db.dashboardDataSource.findFirst({where:{workspaceId:job.workspaceId,id:p.sourceId},select:{id:true}}):typeof p.datasetId==='string'?(await db.dashboardDataset.findFirst({where:{workspaceId:job.workspaceId,id:p.datasetId},select:{sourceId:true}})):null;
 const id=source&&('id' in source?source.id:source.sourceId);if(id)await assessSource(id,job.workspaceId);
}
export async function saveSourceMonitoringPolicy(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');const parsed=sourcePolicySchema.safeParse(input);if(!parsed.success)throw Error('INVALID_QUERY');const p=parsed.data;
 const result=await db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardDataSource" WHERE id=${p.sourceId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  if(!await tx.dashboardDataSource.count({where:{id:p.sourceId,workspaceId}}))throw Error('NOT_FOUND');
  const previous=await tx.dashboardSourceMonitoringPolicy.findUnique({where:{sourceId_workspaceId:{sourceId:p.sourceId,workspaceId}}});
  if((previous?.revision??0)!==p.expectedRevision)throw Error('VERSION_CONFLICT');
  const data={maxAgeMinutes:p.maxAgeMinutes,notifyFailures:p.notifyFailures,notifyMetricFailures:p.notifyMetricFailures,revision:p.expectedRevision+1};
  return previous?tx.dashboardSourceMonitoringPolicy.update({where:{id:previous.id},data}):tx.dashboardSourceMonitoringPolicy.create({data:{sourceId:p.sourceId,workspaceId,...data}});
 });
 await assessSource(p.sourceId,workspaceId);return result;
}
export async function listSourceMonitoring(actor:VerifiedDashboardActor,workspaceId:string){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 const [sources,incidents]=await Promise.all([
  db.dashboardDataSource.findMany({where:{workspaceId},orderBy:{name:'asc'},take:200,select:{id:true,name:true,status:true,lastSyncedAt:true,createdAt:true,monitoringPolicies:{select:{maxAgeMinutes:true,notifyFailures:true,notifyMetricFailures:true,revision:true,updatedAt:true}}}}),
  db.dashboardSourceIncident.findMany({where:{workspaceId},orderBy:{occurredAt:'desc'},take:100,include:{source:{select:{name:true}}}}),
 ]);
 return {sources:sources.map(({monitoringPolicies,...s})=>({...s,policy:monitoringPolicies[0]??null,freshness:sourceFreshness(s.lastSyncedAt,monitoringPolicies[0]?.updatedAt??s.createdAt,monitoringPolicies[0]?.maxAgeMinutes??null)})),incidents:incidents.map(i=>({...i,message:sourceIncidentMessages[i.code as Code]??'Review this source in Data or Connections.'})),sourcesLimited:sources.length===200,incidentsLimited:incidents.length===100};
}
export async function acknowledgeSourceIncident(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');const p=sourceIncidentAckSchema.safeParse(input);if(!p.success)throw Error('INVALID_QUERY');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await tx.$queryRaw`SELECT id FROM "DashboardSourceIncident" WHERE id=${p.data.id} AND "workspaceId"=${workspaceId} FOR UPDATE`;const event=await tx.dashboardSourceIncident.findFirst({where:{id:p.data.id,workspaceId,generation:p.data.generation}});if(!event)throw Error('VERSION_CONFLICT');
  await tx.dashboardSourceIncident.updateMany({where:{id:event.id,workspaceId,generation:p.data.generation,status:'OPEN'},data:{status:'ACKNOWLEDGED',acknowledgedAt:new Date()}});return {acknowledged:true};});
}
export function monitoringFailure(){console.error(structuredDiagnostic('monitoring_failed'));}
