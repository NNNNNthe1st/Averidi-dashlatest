import {recordWorkerEffect,workerArtifactId} from "./effects";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { dashboardDb } from "../server/db";
import { readDashboardObject,writeDashboardObject,dashboardStorageKey,dashboardWorkspaceArtifactKey } from "../server/storage";
import { prepareDashboardFile } from "../engines/ingestion/ingest";
import { understandPreparedDataset,safeObservedRecordRules } from "../features/datasets/understanding";

const payloadSchema=z.object({
  datasetId:z.string().min(1),
  versionId:z.string().min(1),
  format:z.enum(["csv","json","xlsx"]),
  worksheetName:z.string().min(1).max(120).optional(),
  csvDelimiter:z.enum([",",";","\t"]).optional(),
  preserveTextFields:z.array(z.string().min(1).max(120)).max(100).optional(),
}).strict();

export async function processDatasetProfileJob(job:{id:string;workspaceId:string;payload:unknown;leaseToken:string|null;deadlineAt?:number},signal?:AbortSignal,refresh?:{sourceId:string;executionId:string;connectorId?:string;connectorRevision?:Date}) {
  signal?.throwIfAborted();
  if(!job.leaseToken)throw new Error("Dataset profile requires a valid job lease.");
  const payload=payloadSchema.safeParse(job.payload);
  if(!payload.success)throw new Error("INVALID_JOB_PAYLOAD");
  const {datasetId,versionId}=payload.data;
  const version=await dashboardDb.dashboardDatasetVersion.findFirst({
    where:{id:versionId,datasetId,status:"PENDING",dataset:{workspaceId:job.workspaceId}},
    select:{importMode:true,sourceFormat:true,sourceWorksheetName:true,storageKey:true,fileSize:true,checksum:true,dataset:{select:{id:true,status:true,sourceId:true,source:{select:{kind:true}}}}},
  });
  if(!version || version.dataset.status==="ARCHIVED")throw new Error("DATASET_UNAVAILABLE");
  if(version.storageKey!==dashboardStorageKey(job.workspaceId,datasetId,versionId))throw new Error("DATASET_UNAVAILABLE");
  if(version.sourceFormat!==payload.data.format.toUpperCase())throw new Error("PROFILE_FORMAT_MISMATCH");
  if((version.sourceWorksheetName??undefined)!==payload.data.worksheetName)throw new Error("PROFILE_WORKSHEET_MISMATCH");
  const bytes=await readDashboardObject(version.storageKey);
  signal?.throwIfAborted();
  if(BigInt(bytes.length)!==version.fileSize)throw new Error("Dataset version size mismatch.");
  if(createHash("sha256").update(bytes).digest("hex")!==version.checksum)throw new Error("Dataset version checksum mismatch.");
  const fileName="dataset."+payload.data.format;
  const prepared=await prepareDashboardFile({bytes,fileName,worksheetName:payload.data.worksheetName,csvDelimiter:payload.data.csvDelimiter,preserveTextFields:payload.data.preserveTextFields});
  // Immutable, separately stored snapshots keep original parsed values and normalized
  // analysis values independently accessible without altering the uploaded source.
  const rawArtifactKey=dashboardWorkspaceArtifactKey("processed",job.workspaceId,versionId+"-raw");
  const processedArtifactKey=dashboardWorkspaceArtifactKey("processed",job.workspaceId,versionId+"-normalized");
  const rawBytes=Buffer.from(JSON.stringify(prepared.rawRows));
  const processedBytes=Buffer.from(JSON.stringify(prepared.rows));
  const artifacts={
    raw:{key:rawArtifactKey,checksum:createHash("sha256").update(rawBytes).digest("hex"),bytes:rawBytes.length},
    processed:{key:processedArtifactKey,checksum:createHash("sha256").update(processedBytes).digest("hex"),bytes:processedBytes.length},
  };
  const understanding=understandPreparedDataset(prepared);
  // Enable only definition-independent counts on a source-record basis.
  // Financial treatment, currency, timezone and document-line amounts remain unknown.
  const autoRules=safeObservedRecordRules(versionId,prepared,understanding.confirmedMappings);
  const result={rowCount:prepared.rows.length,profiled:true,requiresMetricConfirmation:true,...(refresh?{refreshExecutionId:refresh.executionId}:{})};
  if(!understanding.confirmationRequired)throw new Error("Unconfirmed semantic mappings must not be activated.");
  signal?.throwIfAborted();
  // Write before version activation. Abandoned artifacts remain unreferenced
  // and are handled by the existing grace-period storage lifecycle.
  for(const [key,value] of [[rawArtifactKey,rawBytes],[processedArtifactKey,processedBytes]] as const){
    try{await writeDashboardObject(key,value);}
    catch(error){
      // Immutable writes are retry-safe only when the existing artifact matches.
      const existing=await readDashboardObject(key).catch(()=>null);
      if(!existing||existing.length!==value.length||!createHash("sha256").update(existing).digest().equals(createHash("sha256").update(value).digest()))throw error;
    }
  }
  signal?.throwIfAborted();
  await dashboardDb.$transaction(async tx=>{
    const latest=await tx.dashboardDatasetVersion.findFirst({where:{datasetId},orderBy:{version:"desc"},select:{id:true}});
    if(latest?.id!==versionId)throw new Error("SUPERSEDED_VERSION");
    const pending=await tx.dashboardDatasetVersion.findFirst({where:{id:versionId,datasetId,status:"PENDING"},select:{id:true}});
    if(!pending)throw new Error("VERSION_NO_LONGER_PENDING");
    const lease=await tx.dashboardJob.updateMany({where:{id:job.id,workspaceId:job.workspaceId,leaseToken:job.leaseToken,status:"RUNNING",cancelRequestedAt:null,leaseExpiresAt:{gt:new Date()}},data:{leaseExpiresAt:new Date(Date.now()+5*60*1000)}});
    if(lease.count!==1)throw new Error("Job lease expired before profile commit.");
    if(refresh?.connectorId){
      await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${refresh.connectorId} FOR UPDATE`;
      if(!await tx.dashboardConnectorConfiguration.count({where:{id:refresh.connectorId,workspaceId:job.workspaceId,sourceId:refresh.sourceId,enabled:true,updatedAt:refresh.connectorRevision,activeRefreshJobId:job.id,activeRefreshLeaseToken:job.leaseToken}}))throw Error('CONNECTOR_CHANGED');
    }
    const webhook=await tx.dashboardWebhookRecord.findFirst({where:{workspaceId:job.workspaceId,versionId,datasetId}});
    if(webhook){
      if(webhook.jobId!==job.id||webhook.status!=='RECEIVED'||!webhook.connectorRevision)throw Error('CONNECTOR_WEBHOOK_REQUIRED');
      await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${webhook.connectorId} AND "workspaceId"=${job.workspaceId} FOR UPDATE`;
      if(!await tx.dashboardConnectorConfiguration.count({where:{id:webhook.connectorId,workspaceId:job.workspaceId,provider:'DATA_WEBHOOK',sourceId:version.dataset.sourceId??'',enabled:true,updatedAt:webhook.connectorRevision}}))throw Error('CONNECTOR_CHANGED');
      if(process.env.DASHBOARD_DATA_CONNECTORS_ENABLED!=='true'||process.env.DASHBOARD_CUSTOM_SOURCES_ENABLED!=='true')throw Error('CONNECTORS_DISABLED');
    }else if(version.dataset.source?.kind==='DATA_WEBHOOK'&&version.importMode!=='TRANSFORM')throw Error('CONNECTOR_WEBHOOK_REQUIRED');
    const updated=await tx.dashboardDataset.updateMany({
      where:{id:datasetId,workspaceId:job.workspaceId,status:{not:"ARCHIVED"},...(refresh?{sourceId:refresh.sourceId}:{})},
      data:{status:"READY",activeVersionId:versionId},
    });
    if(updated.count!==1)throw new Error("Dataset changed while profiling.");
    const versionUpdated=await tx.dashboardDatasetVersion.updateMany({
      where:{id:versionId,datasetId,status:"PENDING"},
      data:{sourceFormat:payload.data.format.toUpperCase(),sourceWorksheetName:payload.data.worksheetName??null,status:"READY",rowCount:prepared.rows.length,profile:{...prepared.profile,artifacts} as Prisma.InputJsonValue,semantics:JSON.parse(JSON.stringify({fields:understanding.fields,ontology:understanding.ontology,periodMode:understanding.periodMode,confirmedMappings:understanding.confirmedMappings,...(autoRules?{metricRules:autoRules,autoRuleScope:"OBSERVED_RECORD_COUNTS_ONLY"}:{}),confirmationRequired:true})) as Prisma.InputJsonValue,profiledAt:new Date()},
    });
    if(versionUpdated.count!==1)throw new Error("VERSION_NO_LONGER_PENDING");
    if(version.dataset.sourceId){
      await tx.dashboardDataSource.updateMany({where:{id:version.dataset.sourceId,workspaceId:job.workspaceId},data:{status:"CONNECTED",lastCheckedAt:new Date(),lastSyncedAt:new Date(),lastErrorCode:null}});
    }
    if(refresh)await tx.dashboardRefreshExecution.create({data:{id:refresh.executionId,workspaceId:job.workspaceId,sourceId:refresh.sourceId,jobId:job.id,status:"COMPLETED",startedAt:new Date(),finishedAt:new Date(),summary:{datasetId,versionId,rowCount:prepared.rows.length}}});
    if(webhook){
      await tx.dashboardWebhookRecord.update({where:{id:webhook.id},data:{status:'PROCESSED',processedAt:new Date(),lastErrorCode:null}});
      await tx.dashboardRefreshExecution.create({data:{id:workerArtifactId(job.id,'webhook-refresh'),workspaceId:job.workspaceId,sourceId:version.dataset.sourceId!,jobId:job.id,status:'COMPLETED',startedAt:new Date(),finishedAt:new Date(),summary:{datasetId,versionId,receiptId:webhook.id,eventId:webhook.externalEventId,sequence:webhook.sequence?.toString(),rowCount:prepared.rows.length}}});
    }
    await recordWorkerEffect(tx,job,result,signal);
    // Only exact, fully evidenced mappings and conservative record-count rules are preaccepted. Monetary definitions remain unknown.
  });
  return result;
}
