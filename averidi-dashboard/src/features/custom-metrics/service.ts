import {setAuditActor} from '../audit/context';
import {randomUUID,createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {requireWorkspaceRole,type VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {requireDashboardEntitlement} from '../subscriptions/entitlements';
import {assertCustomPermission} from '../permissions/policy';
import {readDatasetAnalysis,currentAnalysis,calculateAnalysisQuery,assertCurrentAnalysis} from '../analysis/service';
import {evaluateFormula} from './formula';
import {formulaDefinitionSchema,storedFormulaSchema,formulaCommandSchema} from './contracts';
import {ANALYSIS_ENGINE_VERSION} from '../../engines/analysis/pipeline';
import type {z} from 'zod';
async function access(actor:Actor,workspaceId:string,write=false){if(!await requireWorkspaceRole(actor,workspaceId,write?'EDITOR':'VIEWER'))throw Error('FORBIDDEN');await assertCustomPermission(actor,workspaceId,write?'analysis.manage':'analysis.read');if(!await requireDashboardEntitlement(actor,workspaceId))throw Error('SUBSCRIPTION_REQUIRED');}
const prefix='CUSTOM_FORMULA_';
export async function readCustomMetrics(actor:Actor,workspaceId:string,datasetId?:string){
 await access(actor,workspaceId);
 const datasets=await db.dashboardDataset.findMany({where:{workspaceId,status:'READY'},take:100,orderBy:{id:'asc'},select:{id:true,name:true,activeVersion:{select:{id:true,checksum:true,semanticRevision:true}}}}),records=await db.dashboardMetricDefinition.findMany({where:{workspaceId,key:{startsWith:prefix}},take:100,orderBy:{createdAt:'asc'}});
 const runs=await db.dashboardAnalysisRun.findMany({where:{workspaceId,id:{in:records.flatMap(r=>{const parsed=storedFormulaSchema.safeParse(r.definition);return parsed.success?[parsed.data.definition.analysisId]:[];})},status:'READY',engineVersion:ANALYSIS_ENGINE_VERSION},select:{id:true}});
 const definitions=records.map(row=>{const parsed=storedFormulaSchema.safeParse(row.definition),definition=parsed.success?parsed.data:null;const active=datasets.find(d=>d.id===definition?.definition.datasetId)?.activeVersion;return {id:row.id,name:row.name,updatedAt:row.updatedAt,definition,current:!!definition&&definition.source.engineVersion===ANALYSIS_ENGINE_VERSION&&runs.some(r=>r.id===definition.definition.analysisId)&&!!active&&active.id===definition.source.versionId&&active.checksum===definition.source.checksum&&active.semanticRevision===definition.source.semanticRevision};});
 let context:unknown=null,state:string|null=null;
 if(datasetId){const dataset=datasets.find(d=>d.id===datasetId);if(!dataset)throw Error('DATASET_UNAVAILABLE');try{const read=await readDatasetAnalysis(actor,workspaceId,datasetId);if(!read.analysis||read.analysis.status!=='READY')throw Error('ANALYSIS_REQUIRED');const current=await currentAnalysis(workspaceId,datasetId,read.analysis.id);context={datasetId,analysisId:current.run.id,versionId:current.version.id,metrics:current.result.outcomes,dimensions:current.result.dimensions,rules:current.confirmation.metricRules};}catch(e){const code=e instanceof Error?e.message:'';if(!['ANALYSIS_REQUIRED','CONFIRMATION_REQUIRED','STALE_ANALYSIS'].includes(code))throw e;state=code;}}
 return {datasets:datasets.map(({id,name})=>({id,name})),definitions,context,state};
}
async function preview(actor:Actor,workspaceId:string,definition:z.infer<typeof formulaDefinitionSchema>){
 const input=await calculateAnalysisQuery(actor,workspaceId,definition.datasetId,definition.analysisId,definition.query);if(input.result.quality.status!=='PASS')throw Error('CUSTOM_METRIC_QUALITY_REQUIRED');
 const calculated=evaluateFormula(definition.expression,input.result.outcomes,definition.format);
 const source={versionId:input.version.id,checksum:input.version.checksum,semanticRevision:input.version.semanticRevision,engineVersion:input.run.engineVersion};
 const basis={metricRules:input.confirmation.metricRules,confirmedMappings:input.confirmation.confirmedMappings};
 const reviewToken=createHash('sha256').update(JSON.stringify({definition,source,basis,calculated})).digest('hex');
 return {input,stored:{kind:'CUSTOM_FORMULA' as const,version:1 as const,definition,source,basis,preview:calculated,reviewToken,calculatedAt:new Date().toISOString()}};
}
export async function mutateCustomMetric(actor:Actor,workspaceId:string,input:unknown){
 const parsed=formulaCommandSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_CUSTOM_METRIC');const c=parsed.data;await access(actor,workspaceId,c.action!=='PREVIEW');
 const prepared='definition' in c?await preview(actor,workspaceId,c.definition):null;if(c.action==='PREVIEW')return prepared!.stored;
 if(prepared&&'expectedPreview' in c&&prepared.stored.reviewToken!==c.expectedPreview)throw Error('CUSTOM_METRIC_PREVIEW_CHANGED');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${workspaceId} FOR UPDATE`;
  const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}});if(!member||!['OWNER','EDITOR'].includes(member.role))throw Error('FORBIDDEN');await assertCustomPermission(actor,workspaceId,'analysis.manage',tx);
  if(prepared)await assertCurrentAnalysis(tx,workspaceId,prepared.input.dataset.id,prepared.input.version.id,prepared.input.version.semanticRevision);
  const previous='id' in c?await tx.dashboardMetricDefinition.findFirst({where:{id:c.id,workspaceId,key:{startsWith:prefix}}}):null;
  if('id' in c&&(!previous||!storedFormulaSchema.safeParse(previous.definition).success||previous.updatedAt.toISOString()!==c.expectedUpdatedAt))throw Error(previous?'CUSTOM_METRIC_CONFLICT':'NOT_FOUND');
  let metricId=previous?.id;
  if(c.action==='DELETE'){
   if(await tx.dashboardMetricResult.count({where:{metricId:c.id}})||await tx.dashboardWidget.count({where:{metricId:c.id}})||await tx.dashboardTarget.count({where:{metricId:c.id}})||await tx.dashboardAlertRule.count({where:{metricId:c.id}}))throw Error('CUSTOM_METRIC_IN_USE');
   await tx.dashboardMetricDefinition.delete({where:{id:c.id}});
  }else{
   if(c.action==='CREATE'&&await tx.dashboardMetricDefinition.count({where:{workspaceId,key:{startsWith:prefix}}})>=100)throw Error('CUSTOM_METRIC_LIMIT');
   const data={name:c.definition.name,definition:prepared!.stored as unknown as Prisma.InputJsonValue};const row=previous?await tx.dashboardMetricDefinition.update({where:{id:previous.id},data:{...data,updatedAt:new Date(Math.max(Date.now(),previous.updatedAt.getTime()+1))}}):await tx.dashboardMetricDefinition.create({data:{...data,workspaceId,key:prefix+randomUUID()}});metricId=row.id;
   await tx.dashboardMetricComponent.deleteMany({where:{workspaceId,metricId:row.id}});await tx.dashboardMetricComponent.createMany({data:prepared!.stored.preview.inputs.map(m=>({workspaceId,metricId:row.id,key:m.key,kind:'GOVERNED_METRIC',definition:m as Prisma.InputJsonValue}))});
  }
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'CUSTOM_METRIC_'+c.action,resourceType:'METRIC',resourceId:metricId!,details:{previous:previous?.definition??null,...(prepared?{definition:prepared.stored}:{})} as Prisma.InputJsonValue}});
  return {id:metricId};
 },{timeout:30000});
}
