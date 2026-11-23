import {salesAvailability} from '../../engines/sales/availability';
import {calculateSalesCustomMeasures,salesDocumentMeasures} from '../../engines/sales/custom-measures';
import {dashboardBusinessDay} from '../../engines/metrics/business-period';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {auditedWrite} from '../audit/service';
import {assertCustomPermission} from '../permissions/policy';
import {requireAnalysisAccess,prepareAnalysisInput,assertCurrentAnalysis} from '../analysis/service';
import type {VerifiedDashboardActor} from '../../server/workspace-access';
import {interpretSales,projectSalesData,identifySalesFields} from '../../engines/sales/interpret';
import {SALES_ENGINE_BASE,salesAnswersSchema,salesSnapshotSchema,type SalesSnapshot} from '../../engines/sales/contracts';
import {analyzeDashboardData,type AnalysisConfirmation} from '../../engines/analysis/pipeline';
import {columnarEnabled,publishColumnarFrame} from '../../engines/columnar/engine';
import {workspacePresentationSchema} from '../workspaces/presentation-contracts';

/** Sales snapshots never overwrite shared field confirmations or their revision. */
export async function salesAnalysisInput(workspaceId:string,datasetId:string,versionId?:string,confirmation?:AnalysisConfirmation){
 const dataset=await dashboardDb.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:'READY'},include:{activeVersion:true}});
 const version=dataset?.activeVersion;
 if(!dataset||!version||version.status!=='READY'||!version.profiledAt)throw Error('DATASET_UNAVAILABLE');
 if(versionId&&version.id!==versionId)throw Error('VERSION_CONFLICT');
 // This temporary mapping is used only to read and integrity-check the stored source.
 const placeholder:AnalysisConfirmation={confirmedMappings:[],metricRules:{versionId:version.id,grain:'RECORD',currency:null,currencyMode:'UNSPECIFIED',revenueBasis:'UNKNOWN',costBasis:'UNKNOWN',refundsIncluded:null,discountsIncluded:null,taxIncluded:null,shippingIncluded:null,cancellationTreatment:'UNKNOWN',returnTreatment:'UNKNOWN'}};
 return {dataset,version,confirmation:confirmation??placeholder};
}
export async function prepareSales(actor:VerifiedDashboardActor,workspaceId:string,datasetId:string,input:{versionId:string;answers?:unknown;clearAnswers?:string[];previousAnalysisId?:string}){
 await requireAnalysisAccess(actor,workspaceId,'EDITOR');
 await assertCustomPermission(actor,workspaceId,'analysis.manage');await assertCustomPermission(actor,workspaceId,'datasets.read');
 const base=await salesAnalysisInput(workspaceId,datasetId,input.versionId);
 let retained:import('../../engines/sales/contracts').SalesAnswers={};let hasCurrentAnswers=false;
 if(input.previousAnalysisId){const previous=await dashboardDb.dashboardAnalysisRun.findFirst({where:{id:input.previousAnalysisId,workspaceId,datasetId,versionId:base.version.id,semanticRevision:base.version.semanticRevision,engineVersion:{gte:SALES_ENGINE_BASE}}});
  if(!previous)throw Error('STALE_ANALYSIS');
  const snapshot=salesSnapshotSchema.safeParse((previous.result as Record<string,unknown>)?.salesProfile);
  if(!snapshot.success)throw Error('STALE_ANALYSIS');retained=snapshot.data.answers;
 }
 if(!input.previousAnalysisId){const summary=base.version.importSummary as Record<string,unknown>|null;const selected=typeof summary?.salesLatestAnalysisId==='string'?summary.salesLatestAnalysisId:null;const current=await dashboardDb.dashboardAnalysisRun.findFirst({where:{workspaceId,datasetId,versionId:base.version.id,semanticRevision:base.version.semanticRevision,sourceChecksum:base.version.checksum,engineVersion:{gte:SALES_ENGINE_BASE},...(selected?{id:selected}:{})},orderBy:{createdAt:'desc'},select:{result:true}});const snapshot=salesSnapshotSchema.safeParse((current?.result as Record<string,unknown>|undefined)?.salesProfile);if(snapshot.success){retained=snapshot.data.answers;hasCurrentAnswers=true;}}
 for(const key of input.clearAnswers??[]){if(!Object.hasOwn(salesAnswersSchema.shape,key))throw Error('INVALID_SALES_ANSWERS');delete retained[key as keyof typeof retained];}
 const incoming=(input.answers??{}) as Record<string,unknown>;
 const prepared=await prepareAnalysisInput(base);
 const incomingParsed=salesAnswersSchema.safeParse(incoming);if(!incomingParsed.success)throw Error('INVALID_SALES_ANSWERS');
 // On a new version of the same source, reuse only explicit column corrections.
 // Accounting answers are deliberately version-bound and must be established again.
 if(!input.previousAnalysisId&&!hasCurrentAnswers){
  const priorVersion=await dashboardDb.dashboardDatasetVersion.findFirst({where:{datasetId,id:{not:base.version.id},status:'READY'},orderBy:{version:'desc'},select:{id:true,importSummary:true}});
  const priorId=(priorVersion?.importSummary as Record<string,unknown>|null)?.salesLatestAnalysisId;
  const previous=priorVersion?await dashboardDb.dashboardAnalysisRun.findFirst({where:{workspaceId,datasetId,versionId:priorVersion.id,engineVersion:{gte:SALES_ENGINE_BASE},...(typeof priorId==='string'?{id:priorId}:{})},orderBy:{createdAt:'desc'},select:{result:true}}):null;
  const snapshot=salesSnapshotSchema.safeParse((previous?.result as Record<string,unknown>|undefined)?.salesProfile);
  if(snapshot.success){const numeric=new Set(['REVENUE','GROSS','COST','UNIT_COST','PRICE','PROFIT','QUANTITY','DISCOUNT','DISCOUNT_RATE','REFUND','RETURN_QUANTITY','TAX','SHIPPING','REFUND_ELIGIBLE_SALES','GROSS_SOLD_QUANTITY','SALES_OPEN_PIPELINE_VALUE']);
   const overrides=Object.fromEntries(Object.entries(snapshot.data.answers.overrides??{}).filter(([name,role])=>prepared.columns.some(c=>c.name===name&&(!numeric.has(role)||c.dataType==='NUMBER'))));
   retained={overrides};
  }
 }

 if(incomingParsed.data.overrides){
  incomingParsed.data.overrides={...retained.overrides,...incomingParsed.data.overrides};
  const oldFields=identifySalesFields(prepared,retained),newFields=identifySalesFields(prepared,{...retained,...incomingParsed.data});
  const changes=oldFields.flatMap((f,i)=>f.role!==newFields[i].role?[f.role,newFields[i].role]:[]);
  if(changes.some(r=>['REVENUE','GROSS','DISCOUNT','DISCOUNT_RATE','REFUND','TAX','SHIPPING','PRICE','QUANTITY'].includes(r))){
   // The UI submits its whole answer draft. None of the old accounting facts
   // may be rebound to another monetary field in that same correction request.
   for(const key of ['recordedNet','deriveNet','discountsAlreadyApplied','refundsAlreadyApplied','taxExcluded','deliveryExcluded'] as const){delete retained[key];delete incomingParsed.data[key];}
  }
  if(changes.some(r=>['COST','UNIT_COST','QUANTITY'].includes(r))){retained={...retained,costIsProductCost:undefined};delete incomingParsed.data.costIsProductCost;}
  if(changes.includes('PROFIT')){retained={...retained,profitIsGross:undefined};delete incomingParsed.data.profitIsGross;}
 }
 const parsed=salesAnswersSchema.safeParse({...retained,...incomingParsed.data});if(!parsed.success)throw Error('INVALID_SALES_ANSWERS');
 if(Object.keys(parsed.data.overrides??{}).some(name=>!prepared.columns.some(c=>c.name===name)))throw Error('INVALID_SALES_ANSWERS');
 const workspace=await dashboardDb.dashboardWorkspace.findUniqueOrThrow({where:{id:workspaceId},select:{presentation:true}});
 const prefs=workspacePresentationSchema.safeParse(workspace.presentation);
 const interpretation=interpretSales(prepared,base.version.id,parsed.data,prefs.success?prefs.data:{});
 const salesProfile:SalesSnapshot={version:1,confirmation:interpretation.confirmation,projection:interpretation.projection,answers:parsed.data,model:{version:2,...interpretation.schema},diagnostics:{fields:interpretation.fields.map(f=>({name:f.name,role:f.role,type:f.type,valid:!['REVENUE','COST','UNIT_COST','PRICE','PROFIT','QUANTITY','DISCOUNT','REFUND','TAX','SHIPPING','GROSS'].includes(f.role)||prepared.rows.every(r=>typeof r[f.name]==='number'&&Number.isFinite(r[f.name]))})),questions:interpretation.questions}};
 const projected=projectSalesData(prepared,salesProfile.projection);
 if(parsed.data.customMeasures?.some(m=>!prepared.columns.some(c=>c.name===m.field)))throw Error('INVALID_SALES_ANSWERS');
 let customMeasures=calculateSalesCustomMeasures(projected,[...salesDocumentMeasures(interpretation.confirmation),...(parsed.data.customMeasures??[])],interpretation.confirmation.metricRules.currency);
 if(salesProfile.projection.rowSelection&&!salesProfile.projection.rowSelection.confirmed)customMeasures=customMeasures.map(m=>({...m,status:'UNAVAILABLE',value:null,reason:'Confirm the detail-versus-summary row population before calculating this measure.'}));
 for(const f of salesProfile.diagnostics!.fields)if(['REVENUE','COST','UNIT_COST','PRICE','PROFIT','QUANTITY','DISCOUNT','REFUND','TAX','SHIPPING','GROSS'].includes(f.role))f.valid=projected.rows.every(r=>typeof r[f.name]==='number'&&Number.isFinite(r[f.name]));
 const result=analyzeDashboardData(projected,base.version.id,salesProfile.confirmation);
 const fingerprint=createHash('sha256').update(JSON.stringify({salesProfile,source:base.version.checksum,baseEngine:result.engineVersion})).digest('hex');
 const engineVersion=SALES_ENGINE_BASE+parseInt(fingerprint.slice(0,7),16);
 // Sales uses its own engine-version identity; the frame contains the already
 // interpreted and selected Sales rows, not the unprojected source records.
 // Publish before the guarded transaction so only a current run acquires a pointer.
 const frame=columnarEnabled()?await publishColumnarFrame({
  workspaceId,datasetId,versionId:base.version.id,semanticRevision:base.version.semanticRevision,
  sourceChecksum:base.version.checksum,engineVersion,projection:'SALES_PROJECTED',
  prepared:projected,confirmation:salesProfile.confirmation
 }):undefined;
 const persisted={...result,salesProfile,salesFingerprint:fingerprint,...(frame?{frame}:{})};
 const run=await auditedWrite(actor,async tx=>{
  await assertCurrentAnalysis(tx,workspaceId,datasetId,base.version.id,base.version.semanticRevision);
  const found=await tx.dashboardAnalysisRun.upsert({where:{versionId_semanticRevision_engineVersion:{versionId:base.version.id,semanticRevision:base.version.semanticRevision,engineVersion}},update:frame?{result:JSON.parse(JSON.stringify(persisted)) as Prisma.InputJsonValue}:{},create:{workspaceId,datasetId,versionId:base.version.id,semanticRevision:base.version.semanticRevision,engineVersion,sourceChecksum:base.version.checksum,status:result.quality.status==='PASS'?'READY':'BLOCKED',result:JSON.parse(JSON.stringify(persisted)) as Prisma.InputJsonValue}});
  if((found.result as Record<string,unknown>).salesFingerprint!==fingerprint)throw Error('VERSION_CONFLICT');
  const currentVersion=await tx.dashboardDatasetVersion.findUniqueOrThrow({where:{id:base.version.id},select:{importSummary:true}});
  await tx.dashboardDatasetVersion.update({where:{id:base.version.id},data:{importSummary:{...(currentVersion.importSummary as Prisma.JsonObject??{}),salesLatestAnalysisId:found.id}}});
  return found;
 });
 const dateFields=interpretation.confirmation.confirmedMappings.filter(f=>f.canonicalConcept==='TIME');
 const dates=dateFields.length===1&&interpretation.confirmation.metricRules.timezone?projected.rows.map(row=>dashboardBusinessDay(row[dateFields[0].sourceField],interpretation.confirmation.metricRules.timezone!)).filter((day):day is string=>!!day).sort():[];
 const availability=Object.fromEntries(result.outcomes.map(m=>[m.key,salesAvailability(m,interpretation.confirmation,interpretation.questions,salesProfile.diagnostics!.fields,{quality:result.quality.status,rows:projected.rows.length,answers:parsed.data})]));
 return {availability,eligibleRows:projected.rows.length,answers:parsed.data,customMeasures,analysisId:run.id,calculatedAt:run.createdAt.toISOString(),source:{fileName:typeof (base.version.importSummary as Record<string,unknown>)?.salesFileName==='string'?(base.version.importSummary as Record<string,unknown>).salesFileName as string:null,datasetId,datasetName:base.dataset.name,versionId:base.version.id,version:base.version.version,rows:prepared.rows.length,uploadedAt:base.version.createdAt.toISOString(),start:dates[0]??null,end:dates.at(-1)??null},interpretation,analysis:result,currency:interpretation.confirmation.metricRules.currency,timezone:interpretation.confirmation.metricRules.timezone};
}
