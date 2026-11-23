import {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {currentAnalysis,assertCurrentAnalysis,prepareAnalysisInput} from '../../features/analysis/service';
import {generateDashboardConfig} from '../../engines/generation/dashboard-templates';
import {analyzeDashboardData} from '../../engines/analysis/pipeline';
import {normalizeWorkerPayload} from '../contracts';
import {publishWorkerEffect,workerArtifactId} from '../effects';
import type {DashboardProcessorJob} from '../processors';
import {alertConditionSchema} from '../../features/monitoring/contracts';

export async function processDashboardGeneration(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('DASHBOARD_GENERATE',job.payload);const input=await currentAnalysis(job.workspaceId,p.datasetId,p.analysisId);
 const definition=generateDashboardConfig(p.template,input.result.outcomes,p.name);const viewId=workerArtifactId(job.id,'view');
 return publishWorkerEffect(job,async tx=>{
  await assertCurrentAnalysis(tx,job.workspaceId,p.datasetId,input.version.id,input.version.semanticRevision);
  await tx.dashboardView.create({data:{id:viewId,workspaceId:job.workspaceId,datasetId:p.datasetId,analysisId:p.analysisId,name:definition.name,definition:definition as Prisma.InputJsonValue}});
  return {viewId,analysisId:p.analysisId,widgets:definition.widgets.length};
 },signal);
}
const conditionSchema=alertConditionSchema;
export async function processAlertEvaluation(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('ALERTS_EVALUATE',job.payload);
 const rule=await dashboardDb.dashboardAlertRule.findFirst({where:{id:p.ruleId,workspaceId:job.workspaceId,enabled:true},include:{metric:true,target:true}});
 if(!rule)throw Error('ALERT_UNAVAILABLE');
 const condition=conditionSchema.safeParse(rule.condition);if(!condition.success)throw Error('INVALID_ALERT_RULE');
 const analysis=await dashboardDb.dashboardAnalysisRun.findFirst({where:{id:p.analysisId,workspaceId:job.workspaceId}});if(!analysis)throw Error('DATASET_UNAVAILABLE');
 if(condition.data.datasetId&&condition.data.datasetId!==analysis.datasetId)throw Error('ALERT_UNAVAILABLE');
 const input=await currentAnalysis(job.workspaceId,analysis.datasetId,analysis.id);
 let results=input.result;
 if(rule.target){
  if(rule.target.metricId!==rule.metricId)throw Error('INVALID_ALERT_RULE');
  const date=input.result.dimensions.filter(d=>d.role==='DATE');if(date.length!==1)throw Error('CONFIRMED_TIMEZONE_REQUIRED');
  results=analyzeDashboardData(await prepareAnalysisInput(input),input.version.id,input.confirmation,{filters:[{type:'DATE_RANGE',field:date[0].field,value:rule.target.periodStart.toISOString().slice(0,10),end:new Date(rule.target.periodEnd.getTime()-1).toISOString().slice(0,10)}],compare:false});
 }
 const metric=results.outcomes.find(m=>m.key===rule.metric.key);
 if(!metric||metric.status!=='READY'||metric.value===null)throw Error('METRIC_UNAVAILABLE');
 if(condition.data.definitionVersion&&condition.data.definitionVersion!==metric.lineage.definitionVersion)throw Error('METRIC_UNAVAILABLE');
 if(metric.definition.format==='CURRENCY'&&condition.data.currency!==undefined&&condition.data.currency!==metric.lineage.currency)throw Error('METRIC_UNAVAILABLE');
 if(rule.target?.datasetId&&rule.target.datasetId!==analysis.datasetId)throw Error('ALERT_UNAVAILABLE');
 if(rule.target?.definitionVersion&&rule.target.definitionVersion!==metric.lineage.definitionVersion)throw Error('METRIC_UNAVAILABLE');
 if(rule.target?.currency&&rule.target.currency!==metric.lineage.currency)throw Error('METRIC_UNAVAILABLE');
 const threshold=condition.data.threshold??(rule.target?Number(rule.target.value):undefined);if(threshold===undefined||!Number.isFinite(threshold))throw Error('INVALID_ALERT_RULE');
 const value=metric.value,operator=condition.data.operator;
 const triggered=operator==='GT'?value>threshold:operator==='GTE'?value>=threshold:operator==='LT'?value<threshold:value<=threshold;
 const eventKey=workerArtifactId(p.analysisId,JSON.stringify({ruleId:rule.id,condition:rule.condition,target:rule.target?{value:String(rule.target.value),start:rule.target.periodStart,end:rule.target.periodEnd}:null}));
 return publishWorkerEffect(job,async tx=>{
  await assertCurrentAnalysis(tx,job.workspaceId,input.dataset.id,input.version.id,input.version.semanticRevision);
  await tx.$queryRaw`SELECT id FROM "DashboardAlertRule" WHERE id=${rule.id} FOR UPDATE`;
  if(rule.target)await tx.$queryRaw`SELECT id FROM "DashboardTarget" WHERE id=${rule.target.id} FOR SHARE`;
  const current=await tx.dashboardAlertRule.findFirst({where:{id:rule.id,workspaceId:job.workspaceId,enabled:true},include:{target:true}});
  if(!current||current.metricId!==rule.metricId||JSON.stringify(current.condition)!==JSON.stringify(rule.condition)||JSON.stringify(current.target)!==JSON.stringify(rule.target))throw Error('VERSION_CONFLICT');
  if(triggered)await tx.dashboardAlertEvent.upsert({where:{ruleId_eventKey:{ruleId:rule.id,eventKey}},update:{},create:{workspaceId:job.workspaceId,ruleId:rule.id,eventKey,observedValue:value}});
  return {ruleId:rule.id,analysisId:analysis.id,triggered,observedValue:value};
 },signal);
}
