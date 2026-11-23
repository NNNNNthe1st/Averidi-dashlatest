import {processConnectorRefresh} from './connectors';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {dashboardStorageKey,readDashboardObject} from '../../server/storage';
import {prepareDashboardFile,prepareDashboardRows,type DashboardRow} from '../../engines/ingestion/ingest';
import {loadAnalysisInput,prepareAnalysisInput,assertCurrentAnalysis} from '../../features/analysis/service';
import {analyzeDashboardData} from '../../engines/analysis/pipeline';
import {processDatasetProfileJob} from '../dataset-profile';
import {normalizeWorkerPayload} from '../contracts';
import {publishWorkerEffect,workerArtifactId,writeWorkerArtifact,assertWorkerLease} from '../effects';
import type {DashboardProcessorJob} from '../processors';

async function storedVersion(job:DashboardProcessorJob,datasetId:string,versionId:string){
 const version=await dashboardDb.dashboardDatasetVersion.findFirst({where:{id:versionId,datasetId,status:'READY',dataset:{workspaceId:job.workspaceId,status:'READY',activeVersionId:versionId}},include:{dataset:true}});
 if(!version)throw Error('DATASET_UNAVAILABLE');
 if(!['CSV','JSON','XLSX'].includes(version.sourceFormat))throw Error('SOURCE_FORMAT_UNAVAILABLE');
 if(version.storageKey!==dashboardStorageKey(job.workspaceId,datasetId,versionId))throw Error('SOURCE_INTEGRITY_FAILURE');
 const bytes=await readDashboardObject(version.storageKey);
 if(BigInt(bytes.length)!==version.fileSize||createHash('sha256').update(bytes).digest('hex')!==version.checksum)throw Error('SOURCE_INTEGRITY_FAILURE');
 return {version,prepared:await prepareDashboardFile({bytes,fileName:'source.'+version.sourceFormat.toLowerCase(),worksheetName:version.sourceWorksheetName??undefined,preserveAllText:true})};
}
export async function processDatasetValidation(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('DATASET_VALIDATE',job.payload);const {version,prepared}=await storedVersion(job,p.datasetId,p.versionId);
 let scope:'PROFILE'|'GOVERNED'='PROFILE';
 let quality:{status:string;issues:{code:string;message:string}[];sourceRows:number}={status:prepared.duplicateCount?'FAIL':'PASS',issues:prepared.duplicateCount?[{code:'DUPLICATE_ROWS',message:'Duplicate records require review.'}]:[],sourceRows:prepared.rows.length};
 try{const input=await loadAnalysisInput(job.workspaceId,p.datasetId,p.versionId);quality=analyzeDashboardData(await prepareAnalysisInput(input),p.versionId,input.confirmation).quality;scope='GOVERNED';}catch(error){if(!(error instanceof Error)||error.message!=='CONFIRMATION_REQUIRED')throw error;}
 const checkId=workerArtifactId(job.id,'validation');
 return publishWorkerEffect(job,async tx=>{
  await assertCurrentAnalysis(tx,job.workspaceId,p.datasetId,p.versionId,version.semanticRevision);
  await tx.dashboardQualityCheck.create({data:{id:checkId,workspaceId:job.workspaceId,datasetId:p.datasetId,versionId:p.versionId,kind:'DATASET_VALIDATION',rule:{version:1,semanticRevision:version.semanticRevision,sourceChecksum:version.checksum,scope},status:quality.status,summary:quality as Prisma.InputJsonValue,checkedAt:new Date()}});
  if(quality.issues.length)await tx.dashboardQualityIssue.createMany({data:quality.issues.map(issue=>({id:workerArtifactId(job.id,issue.code),workspaceId:job.workspaceId,checkId,code:issue.code,severity:'ERROR',details:{message:issue.message}}))});
  return {checkId,status:quality.status,rowCount:quality.sourceRows};
 },signal);
}
export async function processDatasetTransformation(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('DATASET_TRANSFORM',job.payload);const {version,prepared}=await storedVersion(job,p.datasetId,p.versionId);
 let rows=prepared.rows.map(row=>({...row}));const fields=new Set(prepared.columns.map(c=>c.name));
 for(const op of p.operations){
  signal?.throwIfAborted();
  if(op.type==='DROP_DUPLICATES'){const seen=new Set<string>();rows=rows.filter(row=>{const key=JSON.stringify([...fields].map(f=>row[f]??null));if(seen.has(key))return false;seen.add(key);return true;});continue;}
  if(!fields.has(op.field))throw Error('INVALID_TRANSFORMATION');
  if(op.type==='RENAME'){
   if(fields.has(op.to))throw Error('INVALID_TRANSFORMATION');
   rows=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key===op.field?op.to:key,value])) as DashboardRow);fields.delete(op.field);fields.add(op.to);
  }else if(op.type==='TRIM')rows=rows.map(row=>({...row,[op.field]:typeof row[op.field]==='string'?(row[op.field] as string).trim():row[op.field]}));
  else if(op.type==='FILL_EMPTY')rows=rows.map(row=>({...row,[op.field]:row[op.field]===null||String(row[op.field]).trim()===''?op.value:row[op.field]}));
  else if(op.type==='REPLACE_VALUE')rows=rows.map(row=>({...row,[op.field]:row[op.field]===op.from?op.value:row[op.field]}));
  else if(op.type==='FILTER_EQUALS')rows=rows.filter(row=>row[op.field]===op.value);
  else rows=rows.filter(row=>row[op.field]!==null&&String(row[op.field]).trim()!=='');
 }
 if(!rows.length)throw Error('EMPTY_TRANSFORMATION');
 const output=prepareDashboardRows(rows,[...fields]);const bytes=Buffer.from(JSON.stringify(output.rows));
 const versionId=workerArtifactId(job.id,'transform');const key=dashboardStorageKey(job.workspaceId,p.datasetId,versionId);
 signal?.throwIfAborted();await dashboardDb.$transaction(tx=>assertWorkerLease(tx,job,signal));await writeWorkerArtifact(key,bytes);
 return publishWorkerEffect(job,async tx=>{
  await assertCurrentAnalysis(tx,job.workspaceId,p.datasetId,p.versionId,version.semanticRevision);
  if(await tx.dashboardDatasetVersion.count({where:{datasetId:p.datasetId,status:'PENDING'}}))throw Error('IMPORT_IN_PROGRESS');
  const latest=await tx.dashboardDatasetVersion.findFirst({where:{datasetId:p.datasetId},orderBy:{version:'desc'},select:{version:true}});
  await tx.dashboardDatasetVersion.create({data:{id:versionId,datasetId:p.datasetId,version:(latest?.version??0)+1,status:'PENDING',sourceFormat:'JSON',importMode:'TRANSFORM',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex'),importSummary:{sourceVersionId:p.versionId,operations:p.operations}}});
  const followup=await tx.dashboardJob.create({data:{workspaceId:job.workspaceId,kind:'DATASET_PROFILE',idempotencyKey:'profile_'+versionId,payload:{datasetId:p.datasetId,versionId,format:'json'}}});
  return {versionId,profileJobId:followup.id,rowCount:output.rows.length};
 },signal);
}
export async function processSourceRefresh(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('SOURCE_REFRESH',job.payload);
 const source=await dashboardDb.dashboardDataSource.findFirst({where:{id:p.sourceId,workspaceId:job.workspaceId}});
 if(!source)throw Error('DATASET_UNAVAILABLE');if(source.kind!=='FILE'){if('versionId' in p)throw Error('INVALID_JOB_PAYLOAD');return processConnectorRefresh(job,signal);}
 if(!('versionId' in p))throw Error('INVALID_JOB_PAYLOAD');
 const version=await dashboardDb.dashboardDatasetVersion.findFirst({where:{id:p.versionId,datasetId:p.datasetId,dataset:{workspaceId:job.workspaceId,sourceId:source.id}}});
 if(!version)throw Error('DATASET_UNAVAILABLE');
 const executionId=workerArtifactId(job.id,'refresh');
 const {sourceId,...payload}=p;
 // The profile transaction records the common job receipt. Its refresh execution is
 // published in that same transaction through the profile completion hook.
 return processDatasetProfileJob({...job,payload},signal,{sourceId,executionId});
}
