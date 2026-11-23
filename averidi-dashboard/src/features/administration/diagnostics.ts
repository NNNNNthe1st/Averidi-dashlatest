import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {setAuditActor} from '../audit/context';
import {fieldConfirmationSchema} from '../datasets/field-confirmation';
import {storedFormulaSchema} from '../custom-metrics/contracts';
import {metricRulesSchema} from '../datasets/metric-rules';
import {ANALYSIS_ENGINE_VERSION,analysisConfirmationSchema} from '../../engines/analysis/pipeline';
import {workerErrorCode} from '../../worker/job-claim';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const field=z.object({sourceName:z.string().min(1).max(120),businessConcept:z.string().regex(/^[A-Z_]{1,64}$/),dataType:z.enum(['NUMBER','DATE','BOOLEAN','TEXT']),confidence:z.number().min(0).max(1)});
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function mappingDiagnostics(value:unknown,versionId:string){
 const raw=object(value),fields=Array.isArray(raw.fields)?raw.fields.slice(0,100).flatMap(entry=>{const p=field.safeParse(entry);return p.success?[p.data]:[];}):[];
 const mappings=fieldConfirmationSchema.safeParse({versionId,mappings:raw.confirmedMappings instanceof Array?raw.confirmedMappings.map(entry=>{const r=object(entry);return {sourceField:r.sourceField,canonicalConcept:r.canonicalConcept};}):[]});
 const confirmed=mappings.success?mappings.data.mappings:[];
 const names=new Set(fields.map(f=>f.sourceName));const rules=metricRulesSchema.safeParse(raw.metricRules);
 return {fields:fields.map(f=>({...f,confirmedConcept:confirmed.find(m=>m.sourceField===f.sourceName)?.canonicalConcept??null})),confirmedMappings:confirmed,
  problems:[...(!fields.length?['PROFILE_FIELDS_UNAVAILABLE']:[]),...(!mappings.success?['MAPPING_CONFIRMATION_REQUIRED']:[]),...(confirmed.some(m=>!names.has(m.sourceField))?['MAPPING_FIELD_NOT_IN_PROFILE']:[]),...(fields.some(f=>!confirmed.some(m=>m.sourceField===f.sourceName))?['UNMAPPED_FIELDS']:[]),...(!rules.success?['METRIC_RULES_REQUIRED']:rules.data.versionId!==versionId?['METRIC_RULES_VERSION_MISMATCH']:[])],
  multipleMappings:Object.entries(Object.groupBy(confirmed,m=>m.canonicalConcept)).filter(([concept,rows])=>concept!=='IGNORE'&&rows!.length>1).map(([concept,rows])=>({concept,fields:rows!.map(r=>r.sourceField)})),
  rules:rules.success&&rules.data.versionId===versionId?rules.data:null};
}
const outcome=z.object({key:z.string().regex(/^[A-Z_]{1,64}$/),status:z.enum(['READY','NEEDS_CONFIRMATION','UNAVAILABLE']),reason:z.string().max(1000).nullable(),definition:z.object({key:z.string().regex(/^[A-Z_]{1,64}$/),label:z.string().max(120),description:z.string().max(1000),formula:z.string().max(1000),requires:z.array(z.string().regex(/^[A-Z_]{1,64}$/)).max(100),format:z.enum(['CURRENCY','COUNT','PERCENT'])}),lineage:z.object({datasetVersionId:id,fields:z.array(z.string().max(120)).max(100),rowCount:z.number().int().nonnegative().max(50000),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),definitionVersion:z.string().max(128).optional()})});
export function diagnosticJobError(error:string|null){return error===null?null:['LEASE_EXPIRED','INGESTION_FAILED'].includes(error)?error:workerErrorCode(error);}
/** Privileged metadata inspection only. Never opens source bytes or returns preview, values, storage paths, payloads or credentials. */
export async function readDatasetDiagnostics(actor:{issuer:string;subject:string},workspaceId:string,datasetId:string,requestedVersion?:string){
 if(!id.safeParse(workspaceId).success||!id.safeParse(datasetId).success||requestedVersion!==undefined&&!id.safeParse(requestedVersion).success)throw Error('INVALID_DIAGNOSTIC_SCOPE');
 return db.$transaction(async tx=>{
  await setAuditActor(tx,actor);
  const dataset=await tx.dashboardDataset.findFirst({where:{id:datasetId,workspaceId},select:{id:true,status:true,activeVersionId:true,sourceId:true}});if(!dataset)throw Error('NOT_FOUND');
  const version=await tx.dashboardDatasetVersion.findFirst({where:{datasetId,...(requestedVersion?{id:requestedVersion}:dataset.activeVersionId?{id:dataset.activeVersionId}:{})},orderBy:{version:'desc'},select:{id:true,version:true,status:true,sourceFormat:true,rowCount:true,checksum:true,semanticRevision:true,profiledAt:true,semantics:true}});
  if(requestedVersion&&!version)throw Error('NOT_FOUND');
  const versions=await tx.dashboardDatasetVersion.findMany({where:{datasetId},orderBy:{version:'desc'},take:20,select:{id:true,version:true,status:true,createdAt:true}});
  const source=dataset.sourceId?await tx.dashboardDataSource.findFirst({where:{id:dataset.sourceId,workspaceId},select:{id:true,kind:true,status:true,lastCheckedAt:true,lastSyncedAt:true,lastErrorCode:true}}):null;
  const mapping=version?mappingDiagnostics(version.semantics,version.id):null;
  const analysis=version?await tx.dashboardAnalysisRun.findUnique({where:{versionId_semanticRevision_engineVersion:{versionId:version.id,semanticRevision:version.semanticRevision,engineVersion:ANALYSIS_ENGINE_VERSION}},select:{id:true,workspaceId:true,datasetId:true,status:true,sourceChecksum:true,result:true,createdAt:true}}):null;
  const raw=object(analysis?.result);
  const boundAnalysis=!!analysis&&analysis.workspaceId===workspaceId&&analysis.datasetId===datasetId&&analysis.sourceChecksum===version?.checksum&&raw.engineVersion===ANALYSIS_ENGINE_VERSION;
  const compatible=boundAnalysis&&analysis?.status==='READY';
  const parsed=boundAnalysis?z.array(outcome).min(1).max(64).safeParse(raw.outcomes):null;
  const metrics=parsed?.success?parsed.data.map(m=>({...m,requiredMappings:m.definition.requires.map(concept=>({concept,fields:mapping?.confirmedMappings.filter(x=>x.canonicalConcept===concept).map(x=>x.sourceField)??[]}))})):[];
  const formulaRecords=await tx.dashboardMetricDefinition.findMany({where:{workspaceId,key:{startsWith:'CUSTOM_FORMULA_'},definition:{path:['definition','datasetId'],equals:datasetId}},orderBy:{id:'asc'},take:100,select:{id:true,updatedAt:true,definition:true}});
  const customMetrics=formulaRecords.map(record=>{const p=storedFormulaSchema.safeParse(record.definition);if(!p.success)return {id:record.id,status:'DEFINITION_INVALID',current:false};const d=p.data;
   const inputs=d.preview.inputs.slice(0,16).flatMap(input=>{const p=outcome.pick({key:true,definition:true,lineage:true}).safeParse(input);return p.success?[p.data]:[];});
   return {id:record.id,updatedAt:record.updatedAt,status:'AVAILABLE',current:compatible&&!!parsed?.success&&parsed.data.every(m=>m.lineage.datasetVersionId===version?.id)&&!!mapping?.rules&&!mapping.problems.includes('MAPPING_FIELD_NOT_IN_PROFILE')&&dataset.status==='READY'&&version?.status==='READY'&&dataset.activeVersionId===version.id&&d.definition.analysisId===analysis?.id&&d.source.versionId===version.id&&d.source.semanticRevision===version.semanticRevision&&d.source.checksum===version.checksum&&d.source.engineVersion===ANALYSIS_ENGINE_VERSION&&analysisConfirmationSchema.safeParse(version.semantics).success,
    definition:{name:d.definition.name,description:d.definition.description,expression:d.definition.expression,format:d.definition.format,datasetId:d.definition.datasetId,analysisId:d.definition.analysisId,query:{filters:d.definition.query.filters.map(f=>({type:f.type,field:f.field})),filterValuesOmitted:true}},source:d.source,basis:d.basis,inputs,references:d.preview.references.slice(0,16),calculatedAt:d.calculatedAt};
  });
  const checks=await tx.dashboardQualityCheck.findMany({where:{workspaceId,datasetId,...(version?{versionId:version.id}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,select:{id:true,versionId:true,status:true,kind:true,checkedAt:true,rule:true,qualityIssueRecords:{take:100,orderBy:{id:'asc'},select:{id:true,code:true,severity:true,resolvedAt:true}}}});
  await tx.dashboardAdminAudit.create({data:{actorIssuer:actor.issuer,actorSubject:actor.subject,action:'DATASET_DIAGNOSTICS_READ',workspaceId,details:JSON.stringify({datasetId,versionId:version?.id??null,analysisId:analysis?.id??null})}});
  return {dataset,version:version?{...version,semantics:undefined}:null,versions,source:source?{...source,lastErrorCode:diagnosticJobError(source.lastErrorCode)}:null,mapping,analysis:analysis?{id:analysis.id,status:analysis.status,engineVersion:ANALYSIS_ENGINE_VERSION,createdAt:analysis.createdAt,current:compatible&&!!parsed?.success&&parsed.data.every(m=>m.lineage.datasetVersionId===version?.id)&&!!mapping?.rules&&!mapping.problems.includes('MAPPING_FIELD_NOT_IN_PROFILE')&&dataset.status==='READY'&&version?.status==='READY'&&dataset.activeVersionId===version.id&&analysisConfirmationSchema.safeParse(version.semantics).success,sourceBytesVerified:false,diagnosticStatus:parsed?.success?'AVAILABLE':'ANALYSIS_RESULT_INVALID',metrics}:null,
   customMetrics,quality:checks.map(({rule,qualityIssueRecords,...check})=>({...check,current:check.versionId===dataset.activeVersionId&&object(rule).semanticRevision===version?.semanticRevision&&object(rule).sourceChecksum===version?.checksum,issues:qualityIssueRecords.map(issue=>({...issue,code:/^[A-Z0-9_]{1,80}$/.test(issue.code)?issue.code:'QUALITY_ISSUE',severity:/^[A-Z_]{1,32}$/.test(issue.severity)?issue.severity:'UNKNOWN'}))})),limits:{versions:20,fields:100,metrics:64,qualityChecks:20,issuesPerCheck:100,customMetrics:100}};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:10000});
}
