import {listSourceMonitoring} from './sources';
import {setAuditActor} from '../audit/context';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
import {requireAnalysisAccess,readDatasetAnalysis,currentAnalysis,assertCurrentAnalysis} from '../analysis/service';
import {monitoringMetrics,targetSchema,alertSchema,mutationSchema} from './contracts';
import {enqueueActorDashboardJob} from '../../worker/queue';

function revision(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function targetResult(row:{direction?:string|null;pacing?:string;id:string;name:string;metricId:string;value:Prisma.Decimal;periodStart:Date;periodEnd:Date;datasetId:string|null;currency:string|null;definitionVersion:string|null}){return {...row,value:String(row.value),revision:revision([row.name,row.metricId,String(row.value),row.periodStart.toISOString(),row.periodEnd.toISOString(),row.datasetId,row.currency,row.definitionVersion,row.direction??null,row.pacing??"NONE"])};}
function alertResult<T extends {name:string;metricId:string;condition:unknown;targetId:string|null;enabled:boolean}>(row:T){return {...row,revision:revision([row.name,row.metricId,row.condition,row.targetId,row.enabled])};}
async function audit(tx:Prisma.TransactionClient,actor:VerifiedDashboardActor,workspaceId:string,action:string,resourceType:string,resourceId:string){await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action,resourceType,resourceId}});}
async function metric(tx:Prisma.TransactionClient,workspaceId:string,key:string){const definition=monitoringMetrics.find(item=>item.key===key)!;return tx.dashboardMetricDefinition.upsert({where:{workspaceId_key:{workspaceId,key}},update:{},create:{workspaceId,key,name:definition.label,definition:{catalogKey:key,formula:definition.formula}}});}
export async function listMonitoring(actor:VerifiedDashboardActor,workspaceId:string){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 const [targets,rules,events]=await Promise.all([
  db.dashboardTarget.findMany({where:{workspaceId},include:{metric:{select:{key:true,name:true}}},orderBy:{createdAt:'desc'},take:100}),
  db.dashboardAlertRule.findMany({where:{workspaceId},include:{metric:{select:{key:true,name:true}}},orderBy:{createdAt:'desc'},take:100}),
  db.dashboardAlertEvent.findMany({where:{workspaceId},include:{rule:{select:{name:true,metric:{select:{key:true,name:true}}}}},orderBy:{occurredAt:'desc'},take:100}),
 ]);return {sourceMonitoring:await listSourceMonitoring(actor,workspaceId),targets:targets.map(row=>({...targetResult(row),metric:row.metric})),rules:rules.map(alertResult),events:events.map(row=>({...row,observedValue:String(row.observedValue)}))};
}
export async function saveTarget(actor:VerifiedDashboardActor,workspaceId:string,input:unknown,expected?:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');const p=targetSchema.safeParse(input),edit=expected===undefined?null:mutationSchema.safeParse(expected);if(!p.success||edit&&!edit.success)throw Error('INVALID_QUERY');
 const analysis=(await readDatasetAnalysis(actor,workspaceId,p.data.datasetId)).analysis;if(!analysis)throw Error('ANALYSIS_REQUIRED');
 const current=await currentAnalysis(workspaceId,p.data.datasetId,analysis.id),outcome=current.result.outcomes.find(item=>item.key===p.data.metricKey&&item.status==='READY');if(!outcome?.lineage.definitionVersion)throw Error('METRIC_UNAVAILABLE');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await assertCurrentAnalysis(tx,workspaceId,p.data.datasetId,current.version.id,current.version.semanticRevision);
  const m=await metric(tx,workspaceId,p.data.metricKey),data={direction:p.data.direction??null,pacing:p.data.pacing,name:p.data.name,metricId:m.id,datasetId:p.data.datasetId,currency:outcome.definition.format==='CURRENCY'?outcome.lineage.currency:null,definitionVersion:outcome.lineage.definitionVersion,value:new Prisma.Decimal(p.data.value),periodStart:new Date(p.data.start+'T00:00:00Z'),periodEnd:new Date(Date.parse(p.data.through+'T00:00:00Z')+86400000)};
  let row;
  if(edit?.success){await tx.$queryRaw`SELECT id FROM "DashboardTarget" WHERE id=${edit.data.id} AND "workspaceId"=${workspaceId} FOR UPDATE`;const previous=await tx.dashboardTarget.findFirst({where:{id:edit.data.id,workspaceId}});if(!previous)throw Error('NOT_FOUND');if(targetResult(previous).revision!==edit.data.expectedRevision)throw Error('VERSION_CONFLICT');if((previous.metricId!==m.id||previous.datasetId!==p.data.datasetId)&&await tx.dashboardAlertRule.count({where:{workspaceId,targetId:previous.id}}))throw Error('TARGET_IN_USE');row=await tx.dashboardTarget.update({where:{id:previous.id},data});}
  else row=await tx.dashboardTarget.create({data:{workspaceId,...data}});
  await audit(tx,actor,workspaceId,edit?'TARGET_UPDATED':'TARGET_CREATED','TARGET',row.id);return targetResult(row);
 });
}
export async function removeTarget(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');const p=mutationSchema.safeParse(input);if(!p.success)throw Error('INVALID_QUERY');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await tx.$queryRaw`SELECT id FROM "DashboardTarget" WHERE id=${p.data.id} AND "workspaceId"=${workspaceId} FOR UPDATE`;const previous=await tx.dashboardTarget.findFirst({where:{id:p.data.id,workspaceId}});if(!previous)throw Error('NOT_FOUND');if(targetResult(previous).revision!==p.data.expectedRevision)throw Error('VERSION_CONFLICT');if(await tx.dashboardAlertRule.count({where:{workspaceId,targetId:previous.id}}))throw Error('TARGET_IN_USE');await tx.dashboardTarget.delete({where:{id:previous.id}});await audit(tx,actor,workspaceId,'TARGET_REMOVED','TARGET',previous.id);return {removed:true};});
}
export async function saveAlert(actor:VerifiedDashboardActor,workspaceId:string,input:unknown,expected?:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');const p=alertSchema.safeParse(input),edit=expected===undefined?null:mutationSchema.safeParse(expected);if(!p.success||edit&&!edit.success)throw Error('INVALID_QUERY');
 const analysis=(await readDatasetAnalysis(actor,workspaceId,p.data.datasetId)).analysis;if(!analysis)throw Error('ANALYSIS_REQUIRED');
 const current=await currentAnalysis(workspaceId,p.data.datasetId,analysis.id),outcome=current.result.outcomes.find(item=>item.key===p.data.metricKey&&item.status==='READY');if(!outcome?.lineage.definitionVersion)throw Error('METRIC_UNAVAILABLE');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await assertCurrentAnalysis(tx,workspaceId,p.data.datasetId,current.version.id,current.version.semanticRevision);
  const m=await metric(tx,workspaceId,p.data.metricKey);
  if(p.data.targetId){const target=await tx.dashboardTarget.findFirst({where:{id:p.data.targetId,workspaceId,metricId:m.id,datasetId:p.data.datasetId}});if(!target)throw Error('NOT_FOUND');if(target.definitionVersion!==outcome.lineage.definitionVersion||outcome.definition.format==='CURRENCY'&&target.currency!==outcome.lineage.currency)throw Error('METRIC_UNAVAILABLE');if(current.result.dimensions.filter(item=>item.role==='DATE').length!==1||!current.confirmation.metricRules.timezone)throw Error('CONFIRMED_TIMEZONE_REQUIRED');}
  const data={name:p.data.name,metricId:m.id,targetId:p.data.targetId,enabled:p.data.enabled,condition:{operator:p.data.operator,datasetId:p.data.datasetId,currency:outcome.definition.format==='CURRENCY'?outcome.lineage.currency:null,definitionVersion:outcome.lineage.definitionVersion,...(p.data.threshold!==undefined?{threshold:p.data.threshold}:{})} as Prisma.InputJsonValue};
  let row;
  if(edit?.success){await tx.$queryRaw`SELECT id FROM "DashboardAlertRule" WHERE id=${edit.data.id} AND "workspaceId"=${workspaceId} FOR UPDATE`;const previous=await tx.dashboardAlertRule.findFirst({where:{id:edit.data.id,workspaceId}});if(!previous)throw Error('NOT_FOUND');if(alertResult(previous).revision!==edit.data.expectedRevision)throw Error('VERSION_CONFLICT');row=await tx.dashboardAlertRule.update({where:{id:previous.id},data});}
  else row=await tx.dashboardAlertRule.create({data:{workspaceId,...data}});
  await audit(tx,actor,workspaceId,edit?'ALERT_RULE_UPDATED':'ALERT_RULE_CREATED','ALERT_RULE',row.id);return alertResult(row);
 });
}
export async function evaluateAlert(actor:VerifiedDashboardActor,workspaceId:string,id:string,key:string){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');const rule=await db.dashboardAlertRule.findFirst({where:{id,workspaceId,enabled:true}});
 const condition=rule?.condition as {datasetId?:string}|undefined;if(!condition?.datasetId)throw Error('ALERT_UNAVAILABLE');
 const analysis=(await readDatasetAnalysis(actor,workspaceId,condition.datasetId)).analysis;if(!analysis)throw Error('ANALYSIS_REQUIRED');
 return enqueueActorDashboardJob(actor,workspaceId,'ALERTS_EVALUATE',{ruleId:id,analysisId:analysis.id},key);
}
export async function acknowledgeAlert(actor:VerifiedDashboardActor,workspaceId:string,id:string){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');const event=await tx.dashboardAlertEvent.findFirst({where:{id,workspaceId}});if(!event)throw Error('NOT_FOUND');const changed=await tx.dashboardAlertEvent.updateMany({where:{id,workspaceId,status:'OPEN'},data:{status:'ACKNOWLEDGED',acknowledgedAt:new Date()}});if(changed.count)await audit(tx,actor,workspaceId,'ALERT_ACKNOWLEDGED','ALERT_EVENT',id);return {acknowledged:true};});
}
/** Only explicitly dataset-bound rules participate in automatic evaluation. */
export async function queueDatasetAlerts(tx:Prisma.TransactionClient,workspaceId:string,datasetId:string,analysisId:string){
 let cursor:string|undefined;
 for(;;){
  const rules=await tx.dashboardAlertRule.findMany({where:{workspaceId,enabled:true,condition:{path:['datasetId'],equals:datasetId}},select:{id:true},orderBy:{id:'asc'},take:1000,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  if(!rules.length)return;
  await tx.dashboardJob.createMany({data:rules.map(rule=>({workspaceId,kind:'ALERTS_EVALUATE',payload:{ruleId:rule.id,analysisId},idempotencyKey:'auto_alert_'+createHash('sha256').update(JSON.stringify([rule.id,analysisId])).digest('hex')})),skipDuplicates:true});
  if(rules.length<1000)return;cursor=rules.at(-1)!.id;
 }
}
