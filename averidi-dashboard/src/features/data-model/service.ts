import {setAuditActor} from '../audit/context';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {type VerifiedDashboardActor as Actor,requireWorkspaceRole} from '../../server/workspace-access';
import {requireDashboardEntitlement} from '../subscriptions/entitlements';
import {assertCustomPermission} from '../permissions/policy';
import {relationshipSource} from './source';
import {mappingSchema,cardinalitySchema,joinTypeSchema,joinDatasets,suggestRelationships} from './engine';
import {enqueueActorDashboardJob} from '../../worker/queue';
import {id,bindingSchema} from './contracts';
const definition=z.object({name:z.string().trim().min(1).max(120),leftDatasetId:id,rightDatasetId:id,leftVersionId:id,rightVersionId:id,mappings:mappingSchema,cardinality:cardinalitySchema,joinType:joinTypeSchema,confirmed:z.literal(true)}).strict().refine(v=>v.leftDatasetId!==v.rightDatasetId);
const commandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('PREVIEW'),definition}).strict(),z.object({action:z.literal('CREATE'),definition}).strict(),
 z.object({action:z.literal('UPDATE'),id,expectedUpdatedAt:z.iso.datetime(),definition}).strict(),
 z.object({action:z.literal('DELETE'),id,expectedUpdatedAt:z.iso.datetime()}).strict(),
 z.object({action:z.literal('EXECUTE'),id,expectedUpdatedAt:z.iso.datetime(),name:z.string().trim().min(1).max(120),requestId:z.uuid()}).strict(),
]);
export async function dataAccess(actor:Actor,workspaceId:string,write=false){
 if(!await requireWorkspaceRole(actor,workspaceId,write?'EDITOR':'VIEWER'))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,write?'datasets.write':'datasets.read');
 if(!await requireDashboardEntitlement(actor,workspaceId))throw Error('SUBSCRIPTION_REQUIRED');
}
export async function readDataModel(actor:Actor,workspaceId:string,leftId?:string,rightId?:string){
 await dataAccess(actor,workspaceId);
 if(leftId||rightId){if(!id.safeParse(leftId).success||!id.safeParse(rightId).success||leftId===rightId)throw Error('INVALID_RELATIONSHIP');const [left,right]=await Promise.all([relationshipSource(workspaceId,leftId!),relationshipSource(workspaceId,rightId!)]);return {leftVersionId:left.version.id,rightVersionId:right.version.id,suggestions:suggestRelationships(left.prepared,right.prepared)};}
 const datasets=await db.dashboardDataset.findMany({where:{workspaceId,status:'READY'},orderBy:{id:'asc'},take:100,select:{id:true,name:true,activeVersion:{select:{id:true,profile:true,status:true,checksum:true}}}});
 const relationships=await db.dashboardDataRelationship.findMany({where:{workspaceId},orderBy:{createdAt:'asc'},take:100,include:{fromEntity:{select:{datasetId:true}},toEntity:{select:{datasetId:true}}}});
 return {datasets:datasets.map(d=>({id:d.id,name:d.name,versionId:d.activeVersion?.id,fields:Object.keys((d.activeVersion?.profile as {fields?:object}|null)?.fields??{})})),relationships:relationships.map(r=>{const parsed=bindingSchema.safeParse(r.fieldMappings),binding=parsed.success?parsed.data:null;return {id:r.id,name:r.name,cardinality:r.cardinality,updatedAt:r.updatedAt,binding,current:!!binding&&r.fromEntity.datasetId===binding.leftDatasetId&&r.toEntity.datasetId===binding.rightDatasetId&&r.confirmedAt!==null&&datasets.some(d=>d.id===binding.leftDatasetId&&d.activeVersion?.id===binding.leftVersionId&&d.activeVersion.status==='READY'&&d.activeVersion.checksum===binding.leftChecksum)&&datasets.some(d=>d.id===binding.rightDatasetId&&d.activeVersion?.id===binding.rightVersionId&&d.activeVersion.status==='READY'&&d.activeVersion.checksum===binding.rightChecksum)};})};
}
export async function mutateDataModel(actor:Actor,workspaceId:string,input:unknown){
 const parsed=commandSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_RELATIONSHIP');const c=parsed.data;
 await dataAccess(actor,workspaceId,c.action!=='PREVIEW');
 if(c.action==='EXECUTE')return enqueueActorDashboardJob(actor,workspaceId,'DATASET_JOIN',{relationshipId:c.id,expectedUpdatedAt:c.expectedUpdatedAt,name:c.name},'join_'+c.requestId);
 let binding:z.infer<typeof bindingSchema>|undefined,summary:ReturnType<typeof joinDatasets>['summary']|undefined;
 if('definition' in c){const d=c.definition;const [a,b]=await Promise.all([relationshipSource(workspaceId,d.leftDatasetId,d.leftVersionId),relationshipSource(workspaceId,d.rightDatasetId,d.rightVersionId)]);summary=joinDatasets(a.prepared,b.prepared,d.mappings,d.cardinality,d.joinType,false).summary;binding={version:1,leftDatasetId:d.leftDatasetId,rightDatasetId:d.rightDatasetId,leftVersionId:a.version.id,rightVersionId:b.version.id,leftChecksum:a.version.checksum,rightChecksum:b.version.checksum,mappings:d.mappings,joinType:d.joinType};if(c.action==='PREVIEW')return {summary};}
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${workspaceId} FOR UPDATE`;
  const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}});if(!member||!['OWNER','EDITOR'].includes(member.role))throw Error('FORBIDDEN');await assertCustomPermission(actor,workspaceId,'datasets.write',tx);
  if(binding)for(const datasetId of [binding.leftDatasetId,binding.rightDatasetId].sort()){await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${datasetId} AND "workspaceId"=${workspaceId} FOR UPDATE`;const left=datasetId===binding.leftDatasetId;if(!await tx.dashboardDataset.count({where:{id:datasetId,workspaceId,status:'READY',activeVersionId:left?binding.leftVersionId:binding.rightVersionId}}))throw Error('VERSION_CONFLICT');}
  const previous='id' in c?await tx.dashboardDataRelationship.findFirst({where:{id:c.id,workspaceId}}):null;
  if('id' in c&&(!previous||previous.updatedAt.toISOString()!==c.expectedUpdatedAt))throw Error(previous?'RELATIONSHIP_CONFLICT':'NOT_FOUND');
  let resultId=previous?.id;
  if(c.action==='DELETE'){await tx.dashboardDataRelationship.delete({where:{id:c.id}});}
  else if(c.action==='CREATE'||c.action==='UPDATE'){
   if(c.action==='CREATE'&&await tx.dashboardDataRelationship.count({where:{workspaceId}})>=100)throw Error('RELATIONSHIP_LIMIT');
   const d=c.definition;
   const entities=await Promise.all([d.leftDatasetId,d.rightDatasetId].map(datasetId=>tx.dashboardBusinessEntity.upsert({where:{workspaceId_datasetId_key:{workspaceId,datasetId,key:'dataset'}},create:{workspaceId,datasetId,key:'dataset',fields:{kind:'DATASET'}},update:{}})));
   const data={name:d.name,cardinality:d.cardinality,fieldMappings:binding as Prisma.InputJsonValue,fromEntityId:entities[0].id,toEntityId:entities[1].id,confirmedAt:new Date()};
   const row=previous?await tx.dashboardDataRelationship.update({where:{id:previous.id},data:{...data,updatedAt:new Date(Math.max(Date.now(),previous.updatedAt.getTime()+1))}}):await tx.dashboardDataRelationship.create({data:{...data,workspaceId}});resultId=row.id;
  }
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'DATA_RELATIONSHIP_'+c.action,resourceType:'RELATIONSHIP',resourceId:resultId!,details:{previous:previous?{name:previous.name,cardinality:previous.cardinality,fieldMappings:previous.fieldMappings}:null,...(binding?{binding,summary}:{})} as Prisma.InputJsonValue}});
  return {id:resultId,summary};
 },{timeout:30000});
}
