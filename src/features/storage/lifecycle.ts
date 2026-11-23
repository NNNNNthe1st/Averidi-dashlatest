import {setAuditActor} from '../audit/context';
import {z} from 'zod';
import {Prisma,type DashboardStoragePolicy} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {requireWorkspaceRole,type VerifiedDashboardActor} from '../../server/workspace-access';
import {dashboardStorageBackend,storageMaintenanceKey,type StoredObject,type StorageBackend} from './inventory';
import {storageMutationGuard,lockStoragePolicy} from './guard';
export const storagePolicySchema=z.object({inactiveVersionDays:z.number().int().min(1).max(3650).nullable(),archivedDatasetDays:z.number().int().min(1).max(3650).nullable(),orphanGraceHours:z.number().int().min(24).max(87600).default(168),quarantineHours:z.number().int().min(24).max(87600).default(24),legalHold:z.boolean().default(false)}).strict();
export async function requireStorageOwner(actor:VerifiedDashboardActor,workspaceId:string){if(!await requireWorkspaceRole(actor,workspaceId,'OWNER'))throw Error('FORBIDDEN');}
export async function saveStoragePolicy(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){await requireStorageOwner(actor,workspaceId);const parsed=storagePolicySchema.safeParse(input);if(!parsed.success)throw Error('INVALID_STORAGE_POLICY');return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await storageMutationGuard(tx);await lockStoragePolicy(tx,workspaceId);return tx.dashboardStoragePolicy.upsert({where:{workspaceId},create:{workspaceId,...parsed.data},update:parsed.data});});}
export async function archiveDatasetForRetention(actor:VerifiedDashboardActor,workspaceId:string,datasetId:string){
 await requireStorageOwner(actor,workspaceId);return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await storageMutationGuard(tx);await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${datasetId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const current=await tx.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:{not:'ARCHIVED'}}});if(!current)throw Error('DATASET_UNAVAILABLE');
  await tx.dashboardJob.updateMany({where:{workspaceId,payload:{path:['datasetId'],equals:datasetId},status:'QUEUED'},data:{status:'CANCELLED',cancelRequestedAt:new Date(),finishedAt:new Date()}});
  await tx.dashboardJob.updateMany({where:{workspaceId,payload:{path:['datasetId'],equals:datasetId},status:'RUNNING'},data:{cancelRequestedAt:new Date()}});
  await tx.dashboardDatasetVersion.updateMany({where:{datasetId,status:'PENDING'},data:{status:'CANCELLED'}});
  await tx.dashboardDataset.update({where:{id:datasetId},data:{status:'ARCHIVED',activeVersionId:null}});return {archived:true};
 });
}
export type StorageReference={kind:'VERSION'|'SNAPSHOT'|'REPORT';id:string;workspaceId:string;key:string;size:string;checksum:string};
export async function storageReferences(tx:Prisma.TransactionClient,workspaceId?:string):Promise<StorageReference[]>{
 const [versions,snapshots,reports]=await Promise.all([
  tx.dashboardDatasetVersion.findMany({where:{status:{notIn:['PURGED','PURGE_PENDING']},dataset:workspaceId?{workspaceId}:{}},select:{id:true,storageKey:true,fileSize:true,checksum:true,dataset:{select:{workspaceId:true}}}}),
  tx.dashboardDatasetSnapshot.findMany({where:{...(workspaceId?{workspaceId}:{}),purgedAt:null}}),
  tx.dashboardReportExport.findMany({where:{...(workspaceId?{workspaceId}:{}),storageKey:{not:null},status:{notIn:['EXPIRED','CLEANUP_PENDING']}}}),
 ]);
 return [...versions.map(v=>({kind:'VERSION' as const,id:v.id,workspaceId:v.dataset.workspaceId,key:v.storageKey,size:String(v.fileSize),checksum:v.checksum})),...snapshots.map(v=>({kind:'SNAPSHOT' as const,id:v.id,workspaceId:v.workspaceId,key:v.storageKey,size:String(v.fileSize),checksum:v.checksum})),...reports.map(v=>({kind:'REPORT' as const,id:v.id,workspaceId:v.workspaceId,key:v.storageKey!,size:String(v.fileSize),checksum:v.checksum??''}))].sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id));
}
const cutoff=(now:Date,days:number)=>new Date(now.getTime()-days*86400000);
async function reasonFor(tx:Prisma.TransactionClient,workspaceId:string,object:StoredObject,policy:DashboardStoragePolicy,now:Date,jobId?:string){
 if(policy.legalHold)return null;
 if(await tx.dashboardJob.count({where:{workspaceId,...(jobId?{id:{not:jobId}}:{}),status:{in:['QUEUED','RUNNING']},effectCommittedAt:null}}))return null;
 const versions=await tx.dashboardDatasetVersion.findMany({where:{storageKey:object.key,dataset:{workspaceId}},include:{dataset:true,_count:{select:{activeFor:true,analyses:true,datasetSnapshotRecords:{where:{purgedAt:null}}}}}});
 const snapshots=await tx.dashboardDatasetSnapshot.findMany({where:{workspaceId,storageKey:object.key,purgedAt:null},include:{dataset:true}});
 const reports=await tx.dashboardReportExport.findMany({where:{workspaceId,storageKey:object.key,status:{not:'EXPIRED'}}});
 if(reports.length)return null; // Existing report cleanup owns report expiry; never guess retention here.
 // Version-linked raw and normalized artifacts must follow their parent version's
 // lifecycle rather than being mistaken for abandoned objects.
 if(object.key.startsWith('processed/')){
  const linked=await tx.dashboardDatasetVersion.findMany({
   where:{dataset:{workspaceId},status:{notIn:['PURGED','PURGE_PENDING']}},
   select:{profile:true,dataset:{select:{status:true,activeVersionId:true}},id:true},
  });
  for(const version of linked){
   const profile=version.profile;
   if(!profile||typeof profile!=='object'||Array.isArray(profile))continue;
   const artifacts=(profile as Record<string,unknown>).artifacts;
   if(!artifacts||typeof artifacts!=='object'||Array.isArray(artifacts))continue;
   const values=Object.values(artifacts as Record<string,unknown>);
   if(values.some(item=>item&&typeof item==='object'&&!Array.isArray(item)&&(item as Record<string,unknown>).key===object.key))return null;
  }
 }
 if(versions.length||snapshots.length){
  for(const version of versions){
   if(version._count.activeFor||!['READY','FAILED','CANCELLED','PURGE_PENDING','PURGED'].includes(version.status))return null;
   if(version.dataset.status==='ARCHIVED'){
    if(!policy.archivedDatasetDays||version.dataset.updatedAt>cutoff(now,policy.archivedDatasetDays))return null;
   }else if(!policy.inactiveVersionDays||version.createdAt>cutoff(now,policy.inactiveVersionDays)||version._count.analyses||version._count.datasetSnapshotRecords)return null;
  }
  if(snapshots.some(s=>s.dataset.status!=='ARCHIVED'||!policy.archivedDatasetDays||s.dataset.updatedAt>cutoff(now,policy.archivedDatasetDays)))return null;
  return {reason:'RETENTION',entityKind:versions[0]?'VERSION':'SNAPSHOT',entityId:versions[0]?.id??snapshots[0].id};
 }
 if(object.modifiedAt>new Date(now.getTime()-policy.orphanGraceHours*3600000))return null;
 return {reason:object.partial?'ABANDONED_WRITE':'ORPHAN',entityKind:null,entityId:null};
}
type Guard=(tx:Prisma.TransactionClient)=>Promise<unknown>;
export async function planStorageCleanup(workspaceId:string,guard:Guard,jobId?:string,backend:StorageBackend=dashboardStorageBackend(),now=new Date()){
 const policy=await dashboardDb.dashboardStoragePolicy.findUnique({where:{workspaceId}});if(!policy)throw Error('STORAGE_POLICY_REQUIRED');if(policy.legalHold)throw Error('STORAGE_LEGAL_HOLD');
 const objects=await backend.list(workspaceId);let planned=0;
 for(const object of objects){if(planned>=100)break;
  if(!storageMaintenanceKey(object.key)||object.key.split('/')[1]!==workspaceId)throw Error('INVALID_STORAGE_SCOPE');
  await dashboardDb.$transaction(async tx=>{
   await guard(tx);await storageMutationGuard(tx);
   await lockStoragePolicy(tx,workspaceId);await tx.$queryRaw`SELECT "workspaceId" FROM "DashboardStoragePolicy" WHERE "workspaceId"=${workspaceId} FOR UPDATE`;
   const current=await tx.dashboardStoragePolicy.findUniqueOrThrow({where:{workspaceId}});const reason=await reasonFor(tx,workspaceId,object,current,now,jobId);if(!reason)return;
   const previous=await tx.dashboardStorageDeletion.findUnique({where:{workspaceId_storageKey:{workspaceId,storageKey:object.key}}});
   if(previous&&['PLANNED','DELETING','DELETED'].includes(previous.status))return;
   const data={fingerprint:object.fingerprint,fileSize:object.size,...reason,status:'PLANNED',observedAt:now,eligibleAfter:new Date(now.getTime()+current.quarantineHours*3600000),deletedAt:null,lastErrorCode:null};
   await tx.dashboardStorageDeletion.upsert({where:{workspaceId_storageKey:{workspaceId,storageKey:object.key}},create:{workspaceId,storageKey:object.key,...data},update:data});planned++;
  });
 }return {planned};
}
export async function applyStorageCleanup(workspaceId:string,guard:Guard,jobId?:string,backend:StorageBackend=dashboardStorageBackend(),now=new Date()){
 const candidates=await dashboardDb.dashboardStorageDeletion.findMany({where:{workspaceId,status:{in:['PLANNED','DELETING']},eligibleAfter:{lte:now}},orderBy:{eligibleAfter:'asc'},take:100});let deleted=0,cancelled=0;
 for(const candidate of candidates){
  const object=await backend.stat(candidate.storageKey);
  if(object&&object.fingerprint!==candidate.fingerprint){await dashboardDb.dashboardStorageDeletion.updateMany({where:{id:candidate.id,status:'PLANNED'},data:{status:'CONFLICT',lastErrorCode:'STORAGE_OBJECT_CHANGED'}});continue;}
  const approved=await dashboardDb.$transaction(async tx=>{
   await guard(tx);await storageMutationGuard(tx);
   await lockStoragePolicy(tx,workspaceId);await tx.$queryRaw`SELECT "workspaceId" FROM "DashboardStoragePolicy" WHERE "workspaceId"=${workspaceId} FOR UPDATE`;
   const policy=await tx.dashboardStoragePolicy.findUnique({where:{workspaceId}});if(!policy||policy.legalHold)throw Error('STORAGE_LEGAL_HOLD');
   await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'dashboard-storage-object:'+workspaceId+':'+candidate.storageKey},0))`;
   const held=await tx.dashboardStorageDeletion.findFirst({where:{id:candidate.id,workspaceId,status:{in:['PLANNED','DELETING']},eligibleAfter:{lte:now}}});if(!held)return false;
   const descriptor=object??{key:candidate.storageKey,size:candidate.fileSize,modifiedAt:candidate.observedAt,fingerprint:candidate.fingerprint,partial:!candidate.storageKey.endsWith('.bin')};
   if(held.status==='PLANNED'&&!await reasonFor(tx,workspaceId,descriptor,policy,now,jobId)){await tx.dashboardStorageDeletion.update({where:{id:candidate.id},data:{status:'CANCELLED',lastErrorCode:'STORAGE_REFERENCE_PROTECTED'}});cancelled++;return false;}
   await tx.dashboardStorageDeletion.update({where:{id:candidate.id},data:{status:'DELETING',attempts:{increment:1},lastErrorCode:null}});
   await tx.dashboardDatasetVersion.updateMany({where:{storageKey:candidate.storageKey,dataset:{workspaceId},status:{not:'PURGED'}},data:{status:'PURGE_PENDING'}});
   await tx.dashboardDatasetSnapshot.updateMany({where:{workspaceId,storageKey:candidate.storageKey,purgedAt:null},data:{purgedAt:now}});
   return true;
  },{timeout:25000});
  if(!approved)continue;
  try{
   // Keep the policy row locked across physical I/O. A committed legal hold or
   // maintenance lease cannot race deletion; the earlier tombstone survives a crash.
   await dashboardDb.$transaction(async tx=>{
    await guard(tx);await storageMutationGuard(tx);
    await lockStoragePolicy(tx,workspaceId);await tx.$queryRaw`SELECT "workspaceId" FROM "DashboardStoragePolicy" WHERE "workspaceId"=${workspaceId} FOR UPDATE`;
    const policy=await tx.dashboardStoragePolicy.findUnique({where:{workspaceId}});if(!policy||policy.legalHold)throw Error('STORAGE_LEGAL_HOLD');
    if(object)await backend.remove(object);
    await tx.dashboardDatasetVersion.updateMany({where:{storageKey:candidate.storageKey,dataset:{workspaceId},status:'PURGE_PENDING'},data:{status:'PURGED'}});
    await tx.dashboardStorageDeletion.updateMany({where:{id:candidate.id,status:'DELETING'},data:{status:'DELETED',deletedAt:new Date(),lastErrorCode:null}});
   },{timeout:25000});deleted++;
  }catch(error){await dashboardDb.dashboardStorageDeletion.updateMany({where:{id:candidate.id,status:'DELETING'},data:{lastErrorCode:error instanceof Error&&['STORAGE_OBJECT_CHANGED','STORAGE_LEGAL_HOLD','STORAGE_MAINTENANCE'].includes(error.message)?error.message:'STORAGE_DELETE_FAILED'}});throw error;}
 }return {deleted,cancelled};
}
