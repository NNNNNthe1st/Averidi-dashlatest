import {bindingSchema} from '../features/data-model/contracts';
import type {Prisma} from '@prisma/client';
import {normalizeWorkerPayload,deliveryRecipientsSchema} from './contracts';
/** Shared enqueue/schedule/dispatch authorization of tenant-owned references. */
export async function assertWorkerResourceScope(tx:Prisma.TransactionClient,workspaceId:string,kind:string,payload:unknown){
 const p=normalizeWorkerPayload(kind,payload) as Record<string,unknown>;
 if(typeof p.datasetId==='string'){
  if(!await tx.dashboardDataset.count({where:{id:p.datasetId,workspaceId,status:{not:'ARCHIVED'}}}))throw Error('DATASET_UNAVAILABLE');
  if(typeof p.versionId==='string'&&!await tx.dashboardDatasetVersion.count({where:{id:p.versionId,datasetId:p.datasetId}}))throw Error('DATASET_UNAVAILABLE');
 }
 if(kind==='DATASET_JOIN'){
  const relation=await tx.dashboardDataRelationship.findFirst({where:{id:String(p.relationshipId),workspaceId,updatedAt:new Date(String(p.expectedUpdatedAt)),confirmedAt:{not:null}},include:{fromEntity:{include:{dataset:{include:{activeVersion:true}}}},toEntity:{include:{dataset:{include:{activeVersion:true}}}}}});
  if(!relation)throw Error('RELATIONSHIP_CONFLICT');const binding=bindingSchema.safeParse(relation.fieldMappings);if(!binding.success)throw Error('RELATIONSHIP_CONFLICT');const b=binding.data,left=relation.fromEntity.dataset,right=relation.toEntity.dataset;
  if(left.id!==b.leftDatasetId||right.id!==b.rightDatasetId||left.id===right.id||left.status!=='READY'||right.status!=='READY'||left.activeVersionId!==b.leftVersionId||right.activeVersionId!==b.rightVersionId||left.activeVersion?.checksum!==b.leftChecksum||right.activeVersion?.checksum!==b.rightChecksum)throw Error('RELATIONSHIP_CONFLICT');
 }
 if(typeof p.versionId==='string'&&await tx.dashboardWebhookRecord.count({where:{workspaceId,versionId:p.versionId}}))throw Error('INVALID_JOB_PAYLOAD');
 if(kind==='SOURCE_REFRESH'&&typeof p.sourceId==='string'&&await tx.dashboardDataSource.count({where:{id:p.sourceId,workspaceId,kind:'DATA_WEBHOOK'}}))throw Error('INVALID_JOB_PAYLOAD');
 if(typeof p.sourceId==='string'&&!await tx.dashboardDataSource.count({where:{id:p.sourceId,workspaceId,datasets:{some:{id:String(p.datasetId)}}}}))throw Error('DATASET_UNAVAILABLE');
 if(typeof p.analysisId==='string'&&!await tx.dashboardAnalysisRun.count({where:{id:p.analysisId,workspaceId,...(typeof p.datasetId==='string'?{datasetId:p.datasetId}:{})}}))throw Error('DATASET_UNAVAILABLE');
 if(typeof p.ruleId==='string'&&!await tx.dashboardAlertRule.count({where:{id:p.ruleId,workspaceId}}))throw Error('ALERT_UNAVAILABLE');
 if(typeof p.reportId==='string'&&!await tx.dashboardReportDefinition.count({where:{id:p.reportId,workspaceId}}))throw Error('REPORT_UNAVAILABLE');
 if(typeof p.scheduleId==='string'&&!await tx.dashboardReportSchedule.count({where:{id:p.scheduleId,workspaceId,reportId:String(p.reportId)}}))throw Error('SCHEDULE_UNAVAILABLE');
 if(typeof p.deliveryId==='string'&&!await tx.dashboardReportDelivery.count({where:{id:p.deliveryId,workspaceId}}))throw Error('DELIVERY_UNAVAILABLE');
 if(kind==='DATA_CLEANUP'&&(p.temporaryKeys as string[]).some(key=>!key.startsWith('temporary/'+workspaceId+'/')))throw Error('INVALID_STORAGE_SCOPE');
 return p as Prisma.InputJsonObject;
}
export async function assertReportScheduleRecipients(tx:Prisma.TransactionClient,workspaceId:string,recipients:unknown){
 const parsed=deliveryRecipientsSchema.safeParse(recipients);if(!parsed.success)throw Error('INVALID_RECIPIENTS');
 const count=await tx.dashboardMembership.count({where:{workspaceId,userId:{in:parsed.data.map(r=>r.userId)},role:{in:['OWNER','EDITOR','VIEWER']}}});
 if(count!==parsed.data.length)throw Error('RECIPIENT_UNAVAILABLE');return parsed.data;
}
