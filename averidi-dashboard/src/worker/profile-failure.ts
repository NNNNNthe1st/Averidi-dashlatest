import {workerArtifactId} from "./effects";
import {Prisma} from "@prisma/client";
import {dashboardDb} from "../server/db";

type ProfileJob={id:string;workspaceId:string;kind:string;payload:unknown};
/**
 * Convert terminal jobs into terminal dataset-version states. Unverified versions
 * never replace the last-good active version, even after a crash or cancellation.
 */
export async function markFailedDashboardProfile(job:ProfileJob):Promise<void>{
 if(!["DATASET_PROFILE","DATASET_INGEST","SOURCE_REFRESH"].includes(job.kind)||!job.payload||typeof job.payload!=="object"||Array.isArray(job.payload))return;
 const payload=job.payload as Record<string,unknown>;
 const datasetId=payload.datasetId,versionId=payload.versionId??(job.kind==='SOURCE_REFRESH'?workerArtifactId(job.id,'connector-version'):undefined);
 if(typeof datasetId!=="string"||typeof versionId!=="string")return;
 await dashboardDb.$transaction(async tx=>{
  const outcome=await tx.dashboardJob.findFirst({
   where:{id:job.id,workspaceId:job.workspaceId,kind:job.kind,status:{in:["FAILED","CANCELLED"]}},
   select:{id:true,status:true,lastError:true},
  });
  if(!outcome)return;
  const receipt=await tx.dashboardWebhookRecord.findFirst({where:{workspaceId:job.workspaceId,versionId,datasetId}});if(receipt&&receipt.jobId!==job.id)return;
  if(receipt&&receipt.status==='RECEIVED')await tx.dashboardWebhookRecord.update({where:{id:receipt.id},data:{status:outcome.status,processedAt:new Date(),lastErrorCode:outcome.lastError??'INGESTION_NOT_COMPLETED'}});
  const current=await tx.dashboardDataset.findFirst({
   where:{id:datasetId,workspaceId:job.workspaceId,status:{not:"ARCHIVED"}},
   select:{activeVersionId:true,sourceId:true},
  });
  if(!current)return;
  if(job.kind==="SOURCE_REFRESH"&&current.sourceId===payload.sourceId){
   await tx.dashboardRefreshExecution.upsert({where:{id:workerArtifactId(job.id,'refresh')},update:{},create:{id:workerArtifactId(job.id,'refresh'),workspaceId:job.workspaceId,sourceId:current.sourceId!,jobId:job.id,status:outcome.status,finishedAt:new Date(),summary:{datasetId,versionId,errorCode:'INGESTION_NOT_COMPLETED'}}});
  }
  const version=await tx.dashboardDatasetVersion.updateMany({
   where:{id:versionId,datasetId,status:"PENDING"},
   data:{status:outcome.status==="CANCELLED"?"CANCELLED":"FAILED"},
  });
  if(version.count!==1)return;
  if(current.sourceId&&outcome.status==="FAILED")
   await tx.dashboardDataSource.updateMany({
    where:{id:current.sourceId,workspaceId:job.workspaceId,status:{notIn:["DISCONNECTED","EXPIRED","DELAYED"]}},
    data:{status:"FAILED",lastCheckedAt:new Date(),lastErrorCode:"INGESTION_FAILED"},
   });
  if(!current.activeVersionId)
   await tx.dashboardDataset.updateMany({
    where:{id:datasetId,workspaceId:job.workspaceId,activeVersionId:null,status:"INGESTING"},
    data:{status:"FAILED"},
   });
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}

/** Catch up after a process crash or exhausted retry; bounded for each worker poll. */
export async function reconcileTerminalDashboardProfiles():Promise<number>{
 const pending=await dashboardDb.dashboardDatasetVersion.findMany({
  where:{status:"PENDING"},select:{id:true,importSummary:true,dataset:{select:{workspaceId:true}}},take:100,
 });
 let processed=0;
 const receipts=await dashboardDb.dashboardWebhookRecord.findMany({where:{status:'RECEIVED',job:{status:{in:['FAILED','CANCELLED']}}},include:{job:{select:{id:true,workspaceId:true,kind:true,payload:true}}},take:100});
 for(const receipt of receipts)if(receipt.job){await markFailedDashboardProfile(receipt.job);processed++;}
 for(const version of pending){
  const job=await dashboardDb.dashboardJob.findFirst({
   where:{workspaceId:version.dataset.workspaceId,kind:{in:["DATASET_PROFILE","DATASET_INGEST","SOURCE_REFRESH"]},
    status:{in:["FAILED","CANCELLED"]},OR:[{payload:{path:["versionId"],equals:version.id}},...(version.importSummary&&typeof version.importSummary==='object'&&!Array.isArray(version.importSummary)&&typeof version.importSummary.jobId==='string'?[{id:version.importSummary.jobId}]:[])]},
   select:{id:true,kind:true,workspaceId:true,payload:true},
  });
  if(job){await markFailedDashboardProfile(job);processed++;}
 }
 const remote=await dashboardDb.dashboardJob.findMany({where:{kind:'SOURCE_REFRESH',status:{in:['FAILED','CANCELLED']},reconciledAt:null},take:100});
 for(const job of remote){await markFailedDashboardProfile(job);await dashboardDb.dashboardJob.updateMany({where:{id:job.id,status:{in:['FAILED','CANCELLED']}},data:{reconciledAt:new Date()}});processed++;}
 return processed;
}
