import {salesViewContext} from '../sales/view-context';
import {salesBreakdownsSchema,salesHierarchy,type SalesBreakdowns} from '../../engines/sales/hierarchy';
import {setAuditActor} from '../audit/context';
import {workspaceQuotaUsage} from '../quotas/service';
import {authorizedView} from '../sharing/access';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
import {definitionSchema} from '../views/validation';
import {generateDashboardConfig,salesPresentationConfig,recommendDashboardTemplates,type DashboardConfig} from '../../engines/generation/dashboard-templates';
import {analysisQuerySchema,type DashboardAnalysis} from '../../engines/analysis/pipeline';
import {buildDashboardWidgets} from '../../engines/visualization/widgets';
import {assertCurrentAnalysis,currentAnalysis,prepareAnalysisInput,requireAnalysisAccess} from './service';
import {ANALYSIS_ENGINE_VERSION} from '../../engines/analysis/pipeline';
import {currentSourceQuality} from '../data-model/source-quality-status';
import {redactSourceQuality} from '../data-model/source-quality';
import {readWidgetTargets} from '../monitoring/widget-targets';
import {workspacePolicy} from '../permissions/policy';
import {queryCacheSettings} from './cache-contracts';
import {queryCacheBinding,readQueryCache,writeQueryCache} from './query-cache';
import {columnarEnabled} from '../../engines/columnar/engine';
import {buildGovernedDashboardWidgets,canUseUnfilteredKpiFrame} from './governed-widgets';
type ViewData=ReturnType<typeof buildDashboardWidgets>&{analysisId:string;versionId:string;sourceChecksum:string;calculatedAt:Date;salesContext?:ReturnType<typeof salesViewContext>};
const generateSchema=z.object({datasetId:z.string().min(1).max(128),analysisId:z.string().min(1).max(128),template:definitionSchema.shape.template,name:z.string().trim().min(1).max(120).optional()}).strict();
export function validateGovernedDefinition(definition:unknown,result:DashboardAnalysis){
 const p=definitionSchema.safeParse(definition);if(!p.success)throw Error('INVALID_VIEW');
 if(!recommendDashboardTemplates(result.outcomes).find(t=>t.key===p.data.template)?.available)throw Error('TEMPLATE_UNAVAILABLE');
 if(p.data.widgets.length>30)throw Error('WIDGET_LIMIT');
 for(const w of p.data.widgets){
  if(!result.outcomes.some(m=>m.key===w.metricKey&&(m.status==='READY'&&m.value!==null||['NEW_CUSTOMERS','RETAINED_CUSTOMERS','CUSTOMER_RETENTION_RATE'].includes(m.key)&&m.requiresPeriod===true)))throw Error('METRIC_UNAVAILABLE');
  if(w.kind==='SALES_TREND'&&(p.data.template!=='SALES'||w.metricKey!=='REVENUE'||w.secondaryMetricKey!=='PROFIT'||!result.outcomes.some(m=>m.key==='PROFIT'&&m.status==='READY'&&m.value!==null)))throw Error('INVALID_SALES_TREND');
  if(w.kind!=='SALES_TREND'&&w.secondaryMetricKey)throw Error('INVALID_SECONDARY_METRIC');
  const dim=result.dimensions.find(d=>d.field===w.dimensionField);
  if(w.kind==='KPI'&&w.dimensionField||w.kind!=='KPI'&&!dim||['LINE','SALES_TREND'].includes(w.kind)&&dim?.role!=='DATE'||['BAR','HORIZONTAL_BAR','DONUT'].includes(w.kind)&&dim?.role!=='DIMENSION')throw Error('INVALID_WIDGET_DIMENSION');
 }
 return p.data as DashboardConfig;
}
export async function generateWorkspaceDashboard(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');
 const p=generateSchema.safeParse(input);if(!p.success)throw Error('INVALID_VIEW');
 const data=await currentAnalysis(workspaceId,p.data.datasetId,p.data.analysisId);
 if('salesProfile' in data&&p.data.template!=='SALES')throw Error('INVALID_VIEW');
 const definition=generateDashboardConfig(p.data.template,data.result.outcomes,p.data.name,false,false,false,data.result.dimensions.filter(d=>d.role!=='DATE'||Boolean(data.confirmation.metricRules.timezone)));
 return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await assertCurrentAnalysis(tx,workspaceId,data.dataset.id,data.version.id,data.version.semanticRevision);
  const dashboardQuota=(await workspaceQuotaUsage(workspaceId,tx)).resources.find(resource=>resource.key==='dashboards');
  if(dashboardQuota?.remaining==='0')throw Error('DASHBOARD_QUOTA_EXCEEDED:dashboards');
  return tx.dashboardView.create({data:{workspaceId,datasetId:data.dataset.id,analysisId:data.run.id,name:definition.name,definition:definition as Prisma.InputJsonValue},select:{id:true,name:true,datasetId:true,analysisId:true,definition:true,updatedAt:true}});
 });
}
export async function readWorkspaceDashboardData(actor:VerifiedDashboardActor,workspaceId:string,viewId:string,input:unknown,breakdowns:SalesBreakdowns={}){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 const query=analysisQuerySchema.safeParse(input);if(!query.success)throw Error('INVALID_QUERY');
 const view=await authorizedView(actor,workspaceId,viewId,'VIEW');
 if(!view)throw Error('NOT_FOUND');if(!view.analysisId)throw Error('ANALYSIS_REQUIRED');
 if(!(await workspacePolicy(actor.userId,workspaceId))?.permissions.includes('views.read'))throw Error('FORBIDDEN');
 const data=await currentAnalysis(workspaceId,view.datasetId,view.analysisId);
 const storedDefinition=validateGovernedDefinition(view.definition,data.result);
 // Sales uses the approved fixed presentation even for previously saved layouts.
 let definition=salesPresentationConfig(storedDefinition,data.result.outcomes,data.result.dimensions.filter(d=>d.role!=='DATE'||Boolean(data.confirmation.metricRules.timezone)));
 const selectedBreakdowns=salesBreakdownsSchema.safeParse(breakdowns);if(!selectedBreakdowns.success)throw Error('INVALID_QUERY');
 if(Object.keys(breakdowns).length){
  if(definition.template!=='SALES')throw Error('INVALID_QUERY');
  const levels=salesHierarchy(data.result.dimensions);
  for(const concept of ['GEOGRAPHY','CATEGORY'] as const){const field=breakdowns[concept];if(field&&!levels[concept].some(d=>d.field===field))throw Error('INVALID_WIDGET_DIMENSION');}
  definition={...definition,widgets:definition.widgets.map(w=>w.id==='sales-region-map'&&breakdowns.GEOGRAPHY?{...w,dimensionField:breakdowns.GEOGRAPHY}:w.id==='sales-revenue-category'&&breakdowns.CATEGORY?{...w,dimensionField:breakdowns.CATEGORY}:w)};
 }
 let cache=null;try{cache=queryCacheSettings();}catch{/* Invalid optional cache configuration never replaces a valid calculation. Readiness reports the configuration failure. */}
 const binding=queryCacheBinding(workspaceId,viewId,{...(definition.template==='SALES'?{salesContextVersion:3}:{}),engine:ANALYSIS_ENGINE_VERSION,viewRevision:view.updatedAt.toISOString(),definition,analysisId:data.run.id,versionId:data.version.id,semanticRevision:data.version.semanticRevision,checksum:data.version.checksum,profiledAt:data.version.profiledAt,confirmation:data.confirmation,
  columnar:columnarEnabled()?data.result.frame?.formatVersion===3?{formatVersion:3,
   artifactChecksum:data.result.frame.artifactChecksum,projection:data.result.frame.projection,
   engineVersion:data.result.frame.engineVersion}:null:'disabled'},query.data);
 let result:ViewData|null=null;
 if(cache){const value=await readQueryCache(binding,cache).catch(()=>null);
  const envelope=z.object({analysisId:z.literal(view.analysisId),versionId:z.literal(data.version.id),sourceChecksum:z.literal(data.version.checksum),calculatedAt:z.literal(data.run.createdAt.toISOString()),analysis:z.object({engineVersion:z.literal(ANALYSIS_ENGINE_VERSION),outcomes:z.array(z.unknown()).min(1)}).passthrough(),widgets:z.array(z.unknown()).max(30)}).passthrough().safeParse(value);
  if(envelope.success&&(definition.template!=='SALES'||envelope.data.salesContext&&typeof envelope.data.salesContext==='object'))result={...envelope.data,calculatedAt:new Date(envelope.data.calculatedAt)} as ViewData;
 }
 if(!result){
  const canUseFrame=definition.template!=='SALES'&&canUseUnfilteredKpiFrame(definition,data,query.data);
  const prepared=canUseFrame?undefined:await prepareAnalysisInput(data);
  const governedWidgets=await buildGovernedDashboardWidgets(definition,prepared,data,query.data,{
   refreshedAt:data.version.profiledAt!.toISOString(),calculatedAt:data.run.createdAt.toISOString()
  });
  result={analysisId:view.analysisId,versionId:data.version.id,sourceChecksum:data.version.checksum,calculatedAt:data.run.createdAt,...governedWidgets,...(definition.template==='SALES'?{salesContext:salesViewContext(prepared!,data.confirmation,'salesProfile' in data?data.salesProfile:undefined,governedWidgets.analysis,query.data,breakdowns)}:{})};
  if(cache)await writeQueryCache(actor,binding,result,cache).catch(()=>false);
 }
 const targets=await readWidgetTargets(actor,workspaceId,view.datasetId,query.data,result);
 const quality=await currentSourceQuality({workspaceId,datasetId:view.datasetId,versionId:data.version.id,status:data.version.status,profile:data.version.profile,semanticRevision:data.version.semanticRevision,checksum:data.version.checksum,analysisStatus:data.run.status,analysisQualityStatus:result.analysis.quality.status});
 // Recheck after expensive work so a refreshed version/confirmation cannot be labelled current.
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 await currentAnalysis(workspaceId,view.datasetId,view.analysisId);
 const currentView=await authorizedView(actor,workspaceId,viewId,'VIEW');
 if(currentView.updatedAt.getTime()!==view.updatedAt.getTime())throw Error('VERSION_CONFLICT');
 const policy=await workspacePolicy(actor.userId,workspaceId);if(!policy?.permissions.includes('views.read'))throw Error('FORBIDDEN');
 const identity=definition.template==='SALES'?await Promise.all([dashboardDb.dashboardWorkspace.findUniqueOrThrow({where:{id:workspaceId},select:{name:true}}),dashboardDb.dashboardUser.findUniqueOrThrow({where:{id:actor.userId},select:{displayName:true}})]).then(([workspace,user])=>({workspaceName:workspace.name,displayName:user.displayName})):undefined;
 const {salesContext,...payload}=result;
 return {...payload,...(definition.template==='SALES'?{...salesContext,identity}:{}),targets,qualityAssessment:policy.permissions.includes('datasets.read')?quality:redactSourceQuality(quality)};
}

export async function refreshWorkspaceDashboard(actor:VerifiedDashboardActor,workspaceId:string,viewId:string,expectedUpdatedAt:unknown){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');
 const time=z.string().datetime({offset:true}).safeParse(expectedUpdatedAt);if(!time.success)throw Error('INVALID_VIEW');
 const view=await authorizedView(actor,workspaceId,viewId,'EDIT');if(!view)throw Error('NOT_FOUND');
 const {readDatasetAnalysis}=await import('./service');
 const sales=(view.definition as {template?:string})?.template==='SALES';
 const source=sales?await dashboardDb.dashboardDataset.findFirst({where:{id:view.datasetId,workspaceId},include:{activeVersion:true}}):null;
 const summary=source?.activeVersion?.importSummary as Record<string,unknown>|null;const selectedSalesId=typeof summary?.salesLatestAnalysisId==='string'?summary.salesLatestAnalysisId:null;
 const salesRun=source?.activeVersion?await dashboardDb.dashboardAnalysisRun.findFirst({where:{workspaceId,datasetId:view.datasetId,versionId:source.activeVersion.id,semanticRevision:source.activeVersion.semanticRevision,engineVersion:{gte:1000000000},status:'READY',...(selectedSalesId?{id:selectedSalesId}:{})},orderBy:{createdAt:'desc'}}):null;
 const latest=salesRun??(await readDatasetAnalysis(actor,workspaceId,view.datasetId)).analysis;
 if(!latest||latest.status!=='READY')throw Error('ANALYSIS_REQUIRED');
 const input=await currentAnalysis(workspaceId,view.datasetId,latest.id);
 const refreshedDefinition=sales&&'salesProfile' in input?generateDashboardConfig('SALES',input.result.outcomes,view.name,false,false,false,input.result.dimensions.filter(d=>d.role!=='DATE'||Boolean(input.confirmation.metricRules.timezone))):null;
 if(!refreshedDefinition)validateGovernedDefinition(view.definition,input.result);
 return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await authorizedView(actor,workspaceId,viewId,'EDIT',tx);
  await assertCurrentAnalysis(tx,workspaceId,view.datasetId,input.version.id,input.version.semanticRevision);
  const changed=await tx.dashboardView.updateMany({where:{id:viewId,workspaceId,updatedAt:new Date(time.data)},data:{analysisId:latest.id,updatedAt:new Date(),...(refreshedDefinition?{definition:refreshedDefinition as Prisma.InputJsonValue}:{})}});
  if(changed.count!==1)throw Error('VERSION_CONFLICT');
  return tx.dashboardView.findFirstOrThrow({where:{id:viewId,workspaceId},select:{updatedAt:true}});
 });
}
