import {reportFormatSchema,reportSettingsSchema} from './settings';
import {normalizeReportBranding} from './branding';
import {setAuditActor} from '../audit/context';
import {authorizedView,assertReportView,memberViewWhere} from '../sharing/access';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {requireAnalysisAccess,currentAnalysis,calculateAnalysisQuery,assertCurrentAnalysis} from '../analysis/service';
import {validateGovernedDefinition} from '../analysis/views';
import {analysisQuerySchema} from '../../engines/analysis/pipeline';
import type {VerifiedDashboardActor} from '../../server/workspace-access';

export const reportDefinitionSchema=z.object({
 name:z.string().trim().min(1).max(120),
 viewId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
 format:reportFormatSchema.optional(),
 definition:reportSettingsSchema.default({}),
}).strict();
export const reportDefinitionUpdateSchema=reportDefinitionSchema.extend({expectedUpdatedAt:z.string().datetime({offset:true})});
const reportFields={id:true,name:true,viewId:true,format:true,definition:true,updatedAt:true} as const;
export async function listReportDefinitions(actor:VerifiedDashboardActor,workspaceId:string){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 const allowed=await memberViewWhere(actor.userId,workspaceId);
 const [reports,exports]=await Promise.all([
  db.dashboardReportDefinition.findMany({where:{workspaceId,OR:[{viewId:null},{view:allowed}]},select:reportFields,orderBy:{createdAt:'desc'},take:100}),
  db.dashboardReportExport.findMany({where:{workspaceId,report:{OR:[{viewId:null},{view:allowed}]},AND:[{OR:[{sourceViewId:null},{sourceView:allowed}]}],status:'READY',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{id:true,reportId:true,format:true,completedAt:true,expiresAt:true},orderBy:{createdAt:'desc'},take:100}),
 ]);
 return {reports,exports};
}
export async function saveReportDefinition(actor:VerifiedDashboardActor,workspaceId:string,input:unknown,reportId?:string){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');
 const parsed=(reportId?reportDefinitionUpdateSchema:reportDefinitionSchema).safeParse(input);
 if(!parsed.success)throw Error('INVALID_REPORT_DEFINITION');
 const value=parsed.data;
 if(value.definition.branding)value.definition.branding=await normalizeReportBranding(value.definition.branding);
 if(value.definition.expiresAt&&Date.parse(value.definition.expiresAt)<=Date.now())throw Error('INVALID_REPORT_DEFINITION');
 if(reportId){const old=await db.dashboardReportDefinition.findFirst({where:{id:reportId,workspaceId}});if(!old)throw Error('REPORT_UNAVAILABLE');await assertReportView(actor,workspaceId,old.viewId,'EDIT');}
 const view=await authorizedView(actor,workspaceId,value.viewId,'EDIT').catch(()=>{throw Error('REPORT_UNAVAILABLE');});
 if(!view?.analysisId)throw Error('REPORT_UNAVAILABLE');
 const analysis=await currentAnalysis(workspaceId,view.datasetId,view.analysisId);
 validateGovernedDefinition(view.definition,analysis.result);
 if(value.definition.query)await calculateAnalysisQuery(actor,workspaceId,view.datasetId,view.analysisId,value.definition.query);
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await authorizedView(actor,workspaceId,value.viewId,'EDIT',tx);
  if(reportId){const old=await tx.dashboardReportDefinition.findFirst({where:{id:reportId,workspaceId}});if(!old)throw Error('REPORT_UNAVAILABLE');await assertReportView(actor,workspaceId,old.viewId,'EDIT',tx);}
  // Report generation already checks this revision at publication; authoring
  // also rejects a view changed while the customer was saving a definition.
  await assertCurrentAnalysis(tx,workspaceId,view.datasetId,analysis.version.id,analysis.version.semanticRevision);
  await tx.$queryRaw`SELECT id FROM "DashboardView" WHERE id=${view.id} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  if(!await tx.dashboardView.count({where:{id:view.id,workspaceId,updatedAt:view.updatedAt,analysisId:view.analysisId}}))throw Error('VERSION_CONFLICT');
  const existingFormat=reportId?(await tx.dashboardReportDefinition.findFirstOrThrow({where:{id:reportId,workspaceId},select:{format:true}})).format:'CSV';
  const data={name:value.name,viewId:value.viewId,format:value.format??existingFormat,definition:value.definition as Prisma.InputJsonValue};
  let report;
  if(reportId){
   const expected=(value as z.infer<typeof reportDefinitionUpdateSchema>).expectedUpdatedAt;
   const changed=await tx.dashboardReportDefinition.updateMany({where:{id:reportId,workspaceId,updatedAt:new Date(expected)},data});
   if(changed.count!==1)throw Error('VERSION_CONFLICT');
   report=await tx.dashboardReportDefinition.findFirstOrThrow({where:{id:reportId,workspaceId},select:reportFields});
  }else report=await tx.dashboardReportDefinition.create({data:{workspaceId,...data},select:reportFields});
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:reportId?'REPORT_UPDATED':'REPORT_CREATED',resourceType:'REPORT',resourceId:report.id}});
  return report;
 });
}
