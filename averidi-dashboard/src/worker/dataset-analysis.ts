import {recordWorkerEffect,workerArtifactId} from './effects';
import {workspaceQuotaUsage} from '../features/quotas/service';
import {generateDashboardConfig,recommendDashboardTemplates} from '../engines/generation/dashboard-templates';
import {validateGovernedDefinition} from '../features/analysis/views';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../server/db';
import {loadAnalysisInput,prepareAnalysisInput,assertCurrentAnalysis} from '../features/analysis/service';
import {ANALYSIS_ENGINE_VERSION,analyzeDashboardData} from '../engines/analysis/pipeline';
import type {DashboardProcessorJob} from './processors';
import {queueDatasetAlerts} from '../features/monitoring/service';
import {columnarEnabled,publishColumnarFrame} from '../engines/columnar/engine';
export const datasetAnalysisPayloadSchema=z.object({datasetId:z.string().min(1).max(128),versionId:z.string().min(1).max(128),semanticRevision:z.number().int().nonnegative(),template:z.enum(['SALES','EXECUTIVE','CUSTOMER','FINANCIAL','PRODUCT','MARKETING','OPERATIONS','INVENTORY','CUSTOM']).optional()}).strict();
export async function processDatasetAnalysisJob(job:DashboardProcessorJob,signal?:AbortSignal){
 signal?.throwIfAborted();
 const parsed=datasetAnalysisPayloadSchema.safeParse(job.payload);
 if(!parsed.success||!job.leaseToken)throw Error('INVALID_JOB_PAYLOAD');
 const p=parsed.data,input=await loadAnalysisInput(job.workspaceId,p.datasetId,p.versionId);
 if(input.version.semanticRevision!==p.semanticRevision)throw Error('SUPERSEDED_ANALYSIS');
 const prepared=await prepareAnalysisInput(input);
 signal?.throwIfAborted();
 const result=analyzeDashboardData(prepared,p.versionId,input.confirmation);
 signal?.throwIfAborted();
 // Frames are published by the existing worker, never by read-only requests.
 // The same guarded database transaction below prevents stale revisions being attached.
 const frame=columnarEnabled()?await publishColumnarFrame({workspaceId:job.workspaceId,datasetId:p.datasetId,versionId:p.versionId,
  semanticRevision:p.semanticRevision,sourceChecksum:input.version.checksum,prepared,confirmation:input.confirmation,signal}):undefined;
 signal?.throwIfAborted();
 const publishedResult={...result,...(frame?{frame}:{})};
 const run=await dashboardDb.$transaction(async tx=>{
  await assertCurrentAnalysis(tx,job.workspaceId,p.datasetId,p.versionId,p.semanticRevision);
  const held=await tx.dashboardJob.updateMany({where:{id:job.id,workspaceId:job.workspaceId,status:'RUNNING',leaseToken:job.leaseToken,cancelRequestedAt:null,leaseExpiresAt:{gt:new Date()}},data:{leaseExpiresAt:new Date(Date.now()+300000)}});
  if(held.count!==1)throw Error('JOB_CANCELLED_OR_LEASE_LOST');
  const run=await tx.dashboardAnalysisRun.upsert({where:{versionId_semanticRevision_engineVersion:{versionId:p.versionId,semanticRevision:p.semanticRevision,engineVersion:ANALYSIS_ENGINE_VERSION}},update:frame?{result:JSON.parse(JSON.stringify(publishedResult)) as Prisma.InputJsonValue}:{},create:{workspaceId:job.workspaceId,datasetId:p.datasetId,versionId:p.versionId,semanticRevision:p.semanticRevision,engineVersion:ANALYSIS_ENGINE_VERSION,sourceChecksum:input.version.checksum,status:result.quality.status==='PASS'?'READY':'BLOCKED',result:JSON.parse(JSON.stringify(publishedResult)) as Prisma.InputJsonValue}});
  let viewId:string|undefined;
  const templateUnavailable=Boolean(p.template&&run.status==='READY'&&!recommendDashboardTemplates(result.outcomes).some(t=>t.key===p.template&&t.available));
  if(p.template&&run.status==='READY'&&!templateUnavailable){
   const definition=validateGovernedDefinition(generateDashboardConfig(p.template,result.outcomes,undefined,false,false,false,result.dimensions.filter(d=>d.role!=='DATE'||Boolean(input.confirmation.metricRules.timezone))),result);
   const quota=(await workspaceQuotaUsage(job.workspaceId,tx)).resources.find(x=>x.key==='dashboards');
   if(quota?.remaining==='0')throw Error('DASHBOARD_QUOTA_EXCEEDED:dashboards');
   viewId=workerArtifactId(job.id,'auto-dashboard');
   await tx.dashboardView.upsert({where:{id:viewId},update:{},create:{id:viewId,workspaceId:job.workspaceId,datasetId:p.datasetId,analysisId:run.id,name:definition.name,definition:definition as Prisma.InputJsonValue}});
  }
  if(run.status==='READY')await queueDatasetAlerts(tx,job.workspaceId,p.datasetId,run.id);
  await recordWorkerEffect(tx,job,{analysisId:run.id,status:run.status,readyMetrics:result.outcomes.filter(m=>m.status==='READY').length,...(viewId?{viewId}:{}),...(templateUnavailable?{templateUnavailable:true}:{})},signal);
  return {run,viewId,templateUnavailable};
 });
 return {analysisId:run.run.id,status:run.run.status,readyMetrics:result.outcomes.filter(m=>m.status==='READY').length,...(run.viewId?{viewId:run.viewId}:{}),...(run.templateUnavailable?{templateUnavailable:true}:{})};
}
