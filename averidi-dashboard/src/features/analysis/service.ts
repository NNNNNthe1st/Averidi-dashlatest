import {SALES_ENGINE_BASE,salesSnapshotSchema,type SalesSnapshot} from '../../engines/sales/contracts';
import {projectSalesData} from '../../engines/sales/interpret';
import {workspacePolicy} from '../permissions/policy';
import {currentSourceQuality} from '../data-model/source-quality-status';
import {redactSourceQuality} from '../data-model/source-quality';
import {auditedWrite} from '../audit/service';
import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {dashboardDb} from '../../server/db';
import {readDashboardObject,dashboardStorageKey} from '../../server/storage';
import {requireWorkspaceRole,type VerifiedDashboardActor} from '../../server/workspace-access';
import {requireDashboardEntitlement} from '../subscriptions/entitlements';
import {prepareDashboardFile} from '../../engines/ingestion/ingest';
import {ANALYSIS_ENGINE_VERSION,analysisConfirmationSchema,analyzeDashboardData,retainedTextFields,type AnalysisQuery,type DashboardAnalysis} from '../../engines/analysis/pipeline';
import {columnarEnabled,readColumnarFrame,columnarMetricAnalysis} from '../../engines/columnar/engine';

export async function requireAnalysisAccess(actor:VerifiedDashboardActor,workspaceId:string,role:'EDITOR'|'VIEWER'){
 if(!await requireWorkspaceRole(actor,workspaceId,role))throw Error('FORBIDDEN');
 if(!await requireDashboardEntitlement(actor,workspaceId))throw Error('SUBSCRIPTION_REQUIRED');
}
export async function loadAnalysisInput(workspaceId:string,datasetId:string,versionId?:string){
 const dataset=await dashboardDb.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:'READY'},include:{activeVersion:true}});
 const version=dataset?.activeVersion;
 if(!version||version.status!=='READY'||!version.profiledAt)throw Error('DATASET_UNAVAILABLE');
 if(versionId&&versionId!==version.id)throw Error('VERSION_CONFLICT');
 const parsed=analysisConfirmationSchema.safeParse(version.semantics);
 if(!parsed.success||parsed.data.metricRules.versionId!==version.id)throw Error('CONFIRMATION_REQUIRED');
 return {dataset,version,confirmation:parsed.data};
}
export async function prepareAnalysisInput(input:Awaited<ReturnType<typeof loadAnalysisInput>>&{salesProfile?:SalesSnapshot;result?:DashboardAnalysis;run?:{engineVersion:number}}){
 const {version,dataset,confirmation}=input;
 if(columnarEnabled()&&input.result?.frame?.formatVersion===3){
  const frame=input.result.frame;
  const expectedProjection=input.salesProfile?'SALES_PROJECTED':'SOURCE';
  if(frame.projection!==expectedProjection)throw Error('STALE_ANALYSIS');
  // Bind this frame to the selected analysis run, including its Sales engine id.
  // Source frames and Sales-projected frames must never share an object identity.
  const prepared=await readColumnarFrame(frame,{workspaceId:dataset.workspaceId,datasetId:dataset.id,
   versionId:version.id,semanticRevision:version.semanticRevision,sourceChecksum:version.checksum,
   engineVersion:input.run?.engineVersion??ANALYSIS_ENGINE_VERSION,projection:expectedProjection});
  return prepared;
 }
 if(version.storageKey!==dashboardStorageKey(dataset.workspaceId,dataset.id,version.id))throw Error('SOURCE_INTEGRITY_FAILURE');
 if(!['CSV','JSON','XLSX'].includes(version.sourceFormat))throw Error('SOURCE_FORMAT_UNAVAILABLE');
 const bytes=await readDashboardObject(version.storageKey);
 if(BigInt(bytes.length)!==version.fileSize||createHash('sha256').update(bytes).digest('hex')!==version.checksum)throw Error('SOURCE_INTEGRITY_FAILURE');
 const settings=version.importSummary&&typeof version.importSummary==='object'&&!Array.isArray(version.importSummary)?version.importSummary as Record<string,unknown>:{};
 const chosenDelimiter=settings.csvDelimiter;
 const originalTextFields=Array.isArray(settings.preserveTextFields)?settings.preserveTextFields.filter((value):value is string=>typeof value==='string'):[];
 const preservation=[...new Set([...originalTextFields,...retainedTextFields(confirmation)])].filter(name=>name!==input.salesProfile?.projection.lineKey?.field);
 const prepared=await prepareDashboardFile({bytes,fileName:'source.'+version.sourceFormat.toLowerCase(),worksheetName:version.sourceWorksheetName??undefined,
  ...(chosenDelimiter===','||chosenDelimiter===';'||chosenDelimiter==='\t'?{csvDelimiter:chosenDelimiter}:{}),
  preserveTextFields:preservation});
 return input.salesProfile?projectSalesData(prepared,input.salesProfile.projection):prepared;
}
function requireDashboardTemplate(value:string){const allowed=['SALES','EXECUTIVE','CUSTOMER','FINANCIAL','PRODUCT','MARKETING','OPERATIONS','INVENTORY','CUSTOM'] as const;if(!allowed.some(v=>v===value))throw Error('INVALID_VIEW');return value as typeof allowed[number];}
export async function requestDatasetAnalysis(actor:VerifiedDashboardActor,workspaceId:string,datasetId:string,versionId:string,template?:string){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');
 const {version}=await loadAnalysisInput(workspaceId,datasetId,versionId);
 const selected=template?requireDashboardTemplate(template):undefined;
 if(selected){const {assertCustomPermission}=await import('../permissions/policy');await assertCustomPermission(actor,workspaceId,'views.manage');}
 const payload={datasetId,versionId:version.id,semanticRevision:version.semanticRevision,...(selected?{template:selected}:{})};
 const key=`analysis_${version.id}_${version.semanticRevision}_${ANALYSIS_ENGINE_VERSION}${selected?'_auto_'+selected:''}`;
 const job=await auditedWrite(actor,tx=>tx.dashboardJob.upsert({where:{workspaceId_idempotencyKey:{workspaceId,idempotencyKey:key}},update:{},create:{workspaceId,kind:'DATASET_ANALYZE',payload,idempotencyKey:key}}));
 if(['FAILED','CANCELLED'].includes(job.status))await auditedWrite(actor,tx=>tx.dashboardJob.updateMany({where:{id:job.id,workspaceId,status:job.status},data:{status:'QUEUED',attempts:0,cancelRequestedAt:null,finishedAt:null,availableAt:new Date(),lastError:null}}));
 return {jobId:job.id,status:job.status};
}
export async function readDatasetAnalysis(actor:VerifiedDashboardActor,workspaceId:string,datasetId:string){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 const dataset=await dashboardDb.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:'READY'},include:{activeVersion:true}});
 if(!dataset?.activeVersion)throw Error('DATASET_UNAVAILABLE');
 const v=dataset.activeVersion;
 const run=await dashboardDb.dashboardAnalysisRun.findUnique({where:{versionId_semanticRevision_engineVersion:{versionId:v.id,semanticRevision:v.semanticRevision,engineVersion:ANALYSIS_ENGINE_VERSION}}});
 const job=await dashboardDb.dashboardJob.findFirst({where:{workspaceId,idempotencyKey:{startsWith:`analysis_${v.id}_${v.semanticRevision}_${ANALYSIS_ENGINE_VERSION}`}},select:{id:true,status:true,progress:true,result:true,payload:true},orderBy:{createdAt:'desc'}});
 const quality=await currentSourceQuality({workspaceId,datasetId,versionId:v.id,status:v.status,profile:v.profile,semanticRevision:v.semanticRevision,checksum:v.checksum,analysisStatus:run?.status});
 const publicResult=run?{...run.result as unknown as DashboardAnalysis}:null;
 if(publicResult)delete publicResult.frame;
 return {qualityAssessment:(await workspacePolicy(actor.userId,workspaceId))?.permissions.includes('datasets.read')?quality:redactSourceQuality(quality),analysis:run?{id:run.id,versionId:run.versionId,status:run.status,createdAt:run.createdAt,...publicResult}:null,job};
}
export async function currentAnalysis(workspaceId:string,datasetId:string,analysisId:string){
 const run=await dashboardDb.dashboardAnalysisRun.findFirst({where:{id:analysisId,workspaceId,datasetId,status:'READY'}});
 if(!run)throw Error('STALE_ANALYSIS');
 if(run.engineVersion>=SALES_ENGINE_BASE){
  const profile=salesSnapshotSchema.safeParse((run.result as Record<string,unknown>)?.salesProfile);
  if(!profile.success)throw Error('STALE_ANALYSIS');
  const {salesAnalysisInput}=await import('../sales/preparation');
  const input=await salesAnalysisInput(workspaceId,datasetId,run.versionId,profile.data.confirmation);
  if(run.semanticRevision!==input.version.semanticRevision||run.sourceChecksum!==input.version.checksum||profile.data.confirmation.metricRules.versionId!==run.versionId)throw Error('STALE_ANALYSIS');
  return {...input,salesProfile:profile.data,run,result:run.result as unknown as DashboardAnalysis};
 }
 const input=await loadAnalysisInput(workspaceId,datasetId);
 if(run.engineVersion!==ANALYSIS_ENGINE_VERSION||run.versionId!==input.version.id||run.semanticRevision!==input.version.semanticRevision||run.sourceChecksum!==input.version.checksum)throw Error('STALE_ANALYSIS');
 return {...input,run,result:run.result as unknown as DashboardAnalysis};
}
export async function calculateAnalysisQuery(actor:VerifiedDashboardActor,workspaceId:string,datasetId:string,analysisId:string,query:AnalysisQuery){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');
 const input=await currentAnalysis(workspaceId,datasetId,analysisId);
 const prepared=await prepareAnalysisInput(input);
 // The persisted result is the governed unfiltered analysis of this exact
 // version and confirmation. Do not recompute it from row arrays for each
 // read: DuckDB owns the derived core expression values.
 const reuseUnfiltered=columnarEnabled()&&input.result.frame?.formatVersion===3&&
  query.filters.length===0&&!query.compare&&!query.comparison;
 const reference=reuseUnfiltered
  ?{...input.result,frame:undefined}
  :analyzeDashboardData(prepared,input.version.id,input.confirmation,query);
 const result=await columnarMetricAnalysis(input.result.frame,{
  workspaceId,datasetId,versionId:input.version.id,
  semanticRevision:input.version.semanticRevision,sourceChecksum:input.version.checksum,
  engineVersion:input.run.engineVersion,projection:'salesProfile' in input?'SALES_PROJECTED':'SOURCE'
 },input.confirmation,query,reference);
 return {...input,prepared,result};
}
export async function assertCurrentAnalysis(tx:Prisma.TransactionClient,workspaceId:string,datasetId:string,versionId:string,revision:number){
 // A confirmation write, new active version or archive cannot race a published run/view.
 await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${datasetId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "DashboardDatasetVersion" WHERE id=${versionId} FOR UPDATE`;
 const current=await tx.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:'READY',activeVersionId:versionId}});
 const version=await tx.dashboardDatasetVersion.findFirst({where:{id:versionId,datasetId,status:'READY',semanticRevision:revision}});
 if(!current||!version)throw Error('SUPERSEDED_ANALYSIS');
}
