import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {dashboardStorageKey} from '../../server/storage';
import {dashboardMaxFileBytes} from '../../engines/ingestion/ingest';
import {bindingSchema} from '../../features/data-model/contracts';
import {cardinalitySchema,joinDatasets} from '../../features/data-model/engine';
import {relationshipSource} from '../../features/data-model/source';
import {normalizeWorkerPayload} from '../contracts';
import {publishWorkerEffect,workerArtifactId,writeWorkerArtifact,assertWorkerLease} from '../effects';
import {assertCurrentAnalysis} from '../../features/analysis/service';
import type {DashboardProcessorJob} from '../processors';
export async function processDatasetJoin(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('DATASET_JOIN',job.payload);
 const relationship=await db.dashboardDataRelationship.findFirst({where:{id:p.relationshipId,workspaceId:job.workspaceId},include:{fromEntity:true,toEntity:true}});
 if(!relationship||relationship.updatedAt.toISOString()!==p.expectedUpdatedAt||!relationship.confirmedAt)throw Error('RELATIONSHIP_CONFLICT');
 const parsed=bindingSchema.safeParse(relationship.fieldMappings),cardinality=cardinalitySchema.safeParse(relationship.cardinality);
 if(!parsed.success||!cardinality.success)throw Error('INVALID_RELATIONSHIP');const b=parsed.data;
 if(b.leftDatasetId!==relationship.fromEntity.datasetId||b.rightDatasetId!==relationship.toEntity.datasetId||b.leftDatasetId===b.rightDatasetId)throw Error('INVALID_RELATIONSHIP');
 const [left,right]=await Promise.all([relationshipSource(job.workspaceId,b.leftDatasetId,b.leftVersionId),relationshipSource(job.workspaceId,b.rightDatasetId,b.rightVersionId)]);
 if(left.version.checksum!==b.leftChecksum||right.version.checksum!==b.rightChecksum)throw Error('SOURCE_INTEGRITY_FAILURE');
 const joined=joinDatasets(left.prepared,right.prepared,b.mappings,cardinality.data,b.joinType,true,signal);
 if(!joined.rows.length)throw Error('EMPTY_JOIN');const bytes=Buffer.from(JSON.stringify(joined.rows));if(bytes.length>dashboardMaxFileBytes())throw Error('JOIN_LIMIT_EXCEEDED');
 const datasetId=workerArtifactId(job.id,'joined-dataset'),versionId=workerArtifactId(job.id,'joined-version'),key=dashboardStorageKey(job.workspaceId,datasetId,versionId);
 await db.$transaction(tx=>assertWorkerLease(tx,job,signal));await writeWorkerArtifact(key,bytes);
 return publishWorkerEffect(job,async tx=>{
  await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${job.workspaceId} FOR UPDATE`;
  for(const input of [left,right].sort((a,b)=>a.dataset.id.localeCompare(b.dataset.id)))await assertCurrentAnalysis(tx,job.workspaceId,input.dataset.id,input.version.id,input.version.semanticRevision);
  const current=await tx.dashboardDataRelationship.findFirst({where:{id:p.relationshipId,workspaceId:job.workspaceId,updatedAt:relationship.updatedAt,confirmedAt:{not:null}}});if(!current)throw Error('RELATIONSHIP_CONFLICT');
  const source=await tx.dashboardDataSource.create({data:{id:workerArtifactId(job.id,'joined-source'),workspaceId:job.workspaceId,name:p.name,kind:'FILE',status:'CONNECTED'}});
  await tx.dashboardDataset.create({data:{id:datasetId,workspaceId:job.workspaceId,name:p.name,sourceId:source.id}});
  await tx.dashboardDatasetVersion.create({data:{id:versionId,datasetId,version:1,status:'PENDING',sourceFormat:'JSON',importMode:'JOIN',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex'),importSummary:{relationshipId:relationship.id,relationshipUpdatedAt:relationship.updatedAt.toISOString(),binding:b,summary:joined.summary} as Prisma.InputJsonValue}});
  const followup=await tx.dashboardJob.create({data:{workspaceId:job.workspaceId,kind:'DATASET_PROFILE',idempotencyKey:'profile_'+versionId,payload:{datasetId,versionId,format:'json'}}});
  await tx.dashboardAuditEvent.create({data:{workspaceId:job.workspaceId,actorIssuer:'dashboard-worker',actorSubject:job.id,action:'DATA_RELATIONSHIP_EXECUTED',resourceType:'DATASET',resourceId:datasetId,details:{relationshipId:relationship.id,versionId,summary:joined.summary}}});
  return {datasetId,versionId,profileJobId:followup.id,summary:joined.summary};
 },signal);
}
