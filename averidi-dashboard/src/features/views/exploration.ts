import {setAuditActor} from '../audit/context';
import {authorizedView} from '../sharing/access';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
import {analysisQuerySchema,effectiveAnalysisFilters,type AnalysisQuery} from '../../engines/analysis/pipeline';
import {dashboardBusinessDay} from '../../engines/metrics/business-period';
import type {DashboardRow} from '../../engines/ingestion/ingest';
import {requireAnalysisAccess,calculateAnalysisQuery,currentAnalysis,assertCurrentAnalysis} from '../analysis/service';

export const filterPresetSchema=z.object({name:z.string().trim().min(1).max(120),query:analysisQuerySchema}).strict();
async function ownedView(actor:VerifiedDashboardActor,workspaceId:string,viewId:string){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 const view=await authorizedView(actor,workspaceId,viewId);
 if(!view)throw Error('NOT_FOUND');if(!view.analysisId)throw Error('ANALYSIS_REQUIRED');return view;
}
export async function listFilterPresets(actor:VerifiedDashboardActor,workspaceId:string,viewId:string){
 await ownedView(actor,workspaceId,viewId);
 return db.dashboardSavedView.findMany({where:{workspaceId,viewId,userId:actor.userId},select:{id:true,name:true,filters:true},orderBy:{createdAt:'desc'},take:100});
}
export async function saveFilterPreset(actor:VerifiedDashboardActor,workspaceId:string,viewId:string,input:unknown){
 const view=await ownedView(actor,workspaceId,viewId),p=filterPresetSchema.safeParse(input);if(!p.success)throw Error('INVALID_QUERY');
 const analysis=await calculateAnalysisQuery(actor,workspaceId,view.datasetId,view.analysisId!,p.data.query);
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await assertCurrentAnalysis(tx,workspaceId,view.datasetId,analysis.version.id,analysis.version.semanticRevision);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'dashboard-presets:'+JSON.stringify([workspaceId,viewId,actor.userId])},0))`;
  if(await tx.dashboardSavedView.count({where:{workspaceId,viewId,userId:actor.userId}})>=100)throw Error('PRESET_LIMIT');
  const preset=await tx.dashboardSavedView.create({data:{workspaceId,viewId,userId:actor.userId,name:p.data.name,filters:p.data.query as Prisma.InputJsonValue,layout:{}},select:{id:true,name:true,filters:true}});
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'FILTER_PRESET_CREATED',resourceType:'SAVED_VIEW',resourceId:preset.id}});return preset;
 });
}
export async function removeFilterPreset(actor:VerifiedDashboardActor,workspaceId:string,viewId:string,id:string){
 await ownedView(actor,workspaceId,viewId);
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  const removed=await tx.dashboardSavedView.deleteMany({where:{id,workspaceId,viewId,userId:actor.userId}});
  if(removed.count)await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'FILTER_PRESET_REMOVED',resourceType:'SAVED_VIEW',resourceId:id}});
  return {removed:removed.count===1};
 });
}
export function matchingSourceRows(rows:DashboardRow[],query:AnalysisQuery,timezone:string|null|undefined){
 const filters=effectiveAnalysisFilters(query);
 return rows.filter(row=>filters.every(filter=>{
  const value=row[filter.field];
  if(filter.type==='MISSING')return value===null||value===undefined;
  if(filter.type==='CATEGORY')return value!==null&&value!==undefined&&String(value)===filter.value;
  const day=timezone?dashboardBusinessDay(value,timezone):null;return day!==null&&day>=filter.value&&day<=filter.end!;
 }));
}
export async function readDrilldownRecords(actor:VerifiedDashboardActor,workspaceId:string,viewId:string,input:unknown){
 const p=z.object({query:analysisQuerySchema,offset:z.number().int().min(0).max(50000).default(0)}).strict().safeParse(input);if(!p.success)throw Error('INVALID_QUERY');
 const view=await ownedView(actor,workspaceId,viewId),data=await calculateAnalysisQuery(actor,workspaceId,view.datasetId,view.analysisId!,p.data.query);
 const matching=matchingSourceRows(data.prepared.rows,p.data.query,data.confirmation.metricRules.timezone);
 const columns=data.confirmation.confirmedMappings.filter(field=>field.canonicalConcept!=='IGNORE').map(field=>field.sourceField);
 const rows=matching.slice(p.data.offset,p.data.offset+100).map(row=>Object.fromEntries(columns.map(field=>[field,row[field]])));
 await currentAnalysis(workspaceId,view.datasetId,view.analysisId!);
 await authorizedView(actor,workspaceId,viewId);
 return {columns,rows,total:matching.length,nextOffset:p.data.offset+rows.length<matching.length?p.data.offset+rows.length:null,versionId:data.version.id,analysisId:view.analysisId};
}
