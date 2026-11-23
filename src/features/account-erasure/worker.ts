import {randomUUID} from 'node:crypto';
import {Prisma,type DashboardAccountErasure} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {setAuditActor} from '../audit/context';
import {storageMutationGuard,lockStoragePolicy} from '../storage/guard';
import {dashboardStorageBackend,type StorageBackend} from '../storage/inventory';
import {billingLock} from '../billing/service';
import {erasureSettings,erasureDecision,type ErasureDecision} from './contracts';
import {saveErasureDecision,identityDigest} from './ledger';
import {erasureBlockers} from './review';
import {privateErasureScope,exclusiveErasureLock} from './service';
import {redactAccountEvidence} from './privacy';
const LEASE=300000;
async function held(tx:Prisma.TransactionClient,request:DashboardAccountErasure){
 const current=await tx.dashboardAccountErasure.findFirst({where:{id:request.id,status:'RUNNING',leaseToken:request.leaseToken,leaseExpiresAt:{gt:new Date()}}});if(!current)throw Error('ERASURE_LEASE_LOST');
 await tx.$queryRaw`SELECT id FROM "DashboardAccountErasure" WHERE id=${request.id} FOR UPDATE`;
 const valid=await tx.dashboardAccountErasure.count({where:{id:request.id,status:'RUNNING',leaseToken:request.leaseToken,leaseExpiresAt:{gt:new Date()}}});if(!valid)throw Error('ERASURE_LEASE_LOST');
 await setAuditActor(tx,{issuer:'dashboard-erasure-worker',subject:request.id},'WORKER');await privateErasureScope(tx,request.id);await storageMutationGuard(tx);
}
async function protectWorkspace(tx:Prisma.TransactionClient,request:DashboardAccountErasure,decision:ErasureDecision,wid:string){
 await held(tx,request);const user=await tx.dashboardUser.findUnique({where:{id:decision.userId},select:{externalSubject:true}});if(user&&identityDigest(user.externalSubject)!==decision.identityDigest)throw Error('ERASURE_IDENTITY_MISMATCH');await billingLock(tx,wid);await lockStoragePolicy(tx,wid);await tx.$queryRaw`SELECT "workspaceId" FROM "DashboardStoragePolicy" WHERE "workspaceId"=${wid} FOR UPDATE`;
 const blockers=await erasureBlockers(tx,[wid]);if(blockers.length)throw Error('ERASURE_'+blockers[0]);
 const workspace=await tx.dashboardWorkspace.findUnique({where:{id:wid},select:{erasureRequestId:true}});if(workspace&&workspace.erasureRequestId!==decision.requestId)throw Error('ERASURE_SCOPE_CHANGED');
}
async function checkRemainingOwnership(tx:Prisma.TransactionClient,decision:ErasureDecision){
 const memberships=await tx.dashboardMembership.findMany({where:{userId:decision.userId,role:'OWNER',workspaceId:{notIn:decision.workspaceIds}},select:{workspaceId:true}});
 for(const m of memberships){await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${m.workspaceId} FOR UPDATE`;if(!await tx.dashboardMembership.count({where:{workspaceId:m.workspaceId,role:'OWNER',userId:{not:decision.userId},user:{erasureRequestedAt:null}}}))throw Error('ERASURE_OWNERSHIP_CHANGED');}
 const orgs=await tx.dashboardOrganizationMember.findMany({where:{userId:decision.userId,role:'OWNER',organizationId:{notIn:decision.organizationIds}},select:{organizationId:true}});
 for(const m of orgs){await tx.$queryRaw`SELECT id FROM "DashboardOrganization" WHERE id=${m.organizationId} FOR UPDATE`;if(!await tx.dashboardOrganizationMember.count({where:{organizationId:m.organizationId,role:'OWNER',userId:{not:decision.userId},user:{erasureRequestedAt:null}}}))throw Error('ERASURE_OWNERSHIP_CHANGED');}
}
async function finishErasure(request:DashboardAccountErasure,decision:ErasureDecision){
 return db.$transaction(async tx=>{
  await held(tx,request);await exclusiveErasureLock(tx,'user',decision.userId);
  const cases=await tx.dashboardSupportCase.findMany({where:{requesterId:decision.userId},select:{workspaceId:true}});for(const wid of [...new Set(cases.map(c=>c.workspaceId))].sort())await lockStoragePolicy(tx,wid);
  await checkRemainingOwnership(tx,decision);
  const user=await tx.dashboardUser.findUnique({where:{id:decision.userId}});if(user&&identityDigest(user.externalSubject)!==decision.identityDigest)throw Error('ERASURE_IDENTITY_MISMATCH');
  const identities=await tx.dashboardExternalIdentity.findMany({where:{userId:decision.userId},select:{issuer:true,subject:true}});
  if(user){const at=user.externalSubject.indexOf('|');if(at>=0)identities.push({issuer:user.externalSubject.slice(0,at),subject:user.externalSubject.slice(at+1)});}
  if((await erasureBlockers(tx,[],cases.map(c=>c.workspaceId))).length)throw Error('ERASURE_LEGAL_HOLD');
  if(await tx.dashboardWorkspace.count({where:{id:{in:decision.workspaceIds}}}))throw Error('ERASURE_SCOPE_PENDING');
  for(const oid of decision.organizationIds){const org=await tx.dashboardOrganization.findUnique({where:{id:oid},select:{erasureRequestId:true}});if(org&&org.erasureRequestId!==request.id)throw Error('ERASURE_SCOPE_CHANGED');if(await tx.dashboardWorkspace.count({where:{organizationId:oid}}))throw Error('ERASURE_OWNERSHIP_CHANGED');if(await tx.dashboardOrganizationMember.count({where:{organizationId:oid,userId:{not:decision.userId}}}))throw Error('ERASURE_OWNERSHIP_CHANGED');await tx.dashboardOrganization.deleteMany({where:{id:oid,erasureRequestId:request.id}});}
  await tx.dashboardSupportCase.deleteMany({where:{requesterId:decision.userId}});await tx.dashboardWorkspaceInvitation.updateMany({where:{acceptedById:decision.userId},data:{acceptedById:null}});
  await tx.dashboardUser.deleteMany({where:{id:decision.userId}});
  await redactAccountEvidence(tx,decision,identities);
  const updated=await tx.dashboardAccountErasure.updateMany({where:{id:request.id,status:'RUNNING',leaseToken:request.leaseToken},data:{userId:null,status:'COMPLETED',completedAt:new Date(),leaseToken:null,leaseExpiresAt:null,errorCode:null}});if(!updated.count)throw Error('ERASURE_LEASE_LOST');
 },{timeout:30000});
}
export async function processAccountErasureOnce(signal?:AbortSignal,onClaim?:(id:string)=>Promise<void>,backend:StorageBackend=dashboardStorageBackend(signal)){
 if(!erasureSettings()||process.env.DASHBOARD_WORKER_ENABLED!=='true')return {claimed:false};signal?.throwIfAborted();const now=new Date(),token=randomUUID();
 const rows=await db.$queryRaw<DashboardAccountErasure[]>(Prisma.sql`WITH candidate AS (SELECT id FROM "DashboardAccountErasure" WHERE (status='PENDING' AND "availableAt"<=${now.toISOString()}::timestamp) OR (status='RUNNING' AND "leaseExpiresAt"<${now.toISOString()}::timestamp) ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE "DashboardAccountErasure" e SET status='RUNNING',"leaseToken"=${token},"leaseExpiresAt"=${new Date(now.getTime()+LEASE).toISOString()}::timestamp,attempts=e.attempts+1,"updatedAt"=${now.toISOString()}::timestamp FROM candidate WHERE e.id=candidate.id RETURNING e.*`);
 const request=rows[0];if(!request)return {claimed:false};await onClaim?.(request.id);
 try{
  const decision=erasureDecision.parse(request.decision);if(decision.requestId!==request.id||request.receiptHash!==decision.receiptHash||request.userId!==null&&request.userId!==decision.userId)throw Error('ERASURE_SCOPE_CHANGED');await saveErasureDecision(decision);
  let deleted=0;
  for(const wid of decision.workspaceIds){
   signal?.throwIfAborted();const objects=await backend.list(wid);
   for(const object of objects.slice(0,8-deleted)){
    signal?.throwIfAborted();if(object.key.split('/')[1]!==wid)throw Error('ERASURE_SCOPE_CHANGED');
    await db.$transaction(async tx=>{await protectWorkspace(tx,request,decision,wid);await backend.remove(object);await tx.dashboardAccountErasure.update({where:{id:request.id},data:{deletedObjects:{increment:1}}});},{timeout:25000});deleted++;
   }
   if(objects.length>deleted||deleted>=8){await db.dashboardAccountErasure.updateMany({where:{id:request.id,status:'RUNNING',leaseToken:token},data:{status:'PENDING',availableAt:new Date(Date.now()+1000),leaseToken:null,leaseExpiresAt:null,errorCode:null}});return {claimed:true,id:request.id,status:'PENDING'};}
   // Normal writes are fenced. An empty fresh inventory is required before metadata deletion.
   if((await backend.list(wid)).length)throw Error('ERASURE_SCOPE_PENDING');
   await db.$transaction(async tx=>{await protectWorkspace(tx,request,decision,wid);await tx.dashboardBillingBinding.deleteMany({where:{workspaceId:wid}});await tx.dashboardWorkspace.deleteMany({where:{id:wid,erasureRequestId:request.id}});},{timeout:30000});
  }
  await finishErasure(request,decision);return {claimed:true,id:request.id,status:'COMPLETED'};
 }catch(error){
  const code=error instanceof Error?error.message:'';if(code==='ERASURE_LEASE_LOST')return {claimed:true,id:request.id,status:'LEASE_LOST'};
  const blocked=['ERASURE_LEGAL_HOLD','ERASURE_FINANCIAL_RETENTION','ERASURE_BILLING_ACTIVE','ERASURE_CHECKOUT_PENDING','ERASURE_OWNERSHIP_CHANGED','ERASURE_IDENTITY_MISMATCH','ERASURE_SCOPE_CHANGED'].includes(code),retry=signal?.aborted||['ACCOUNT_ERASURE_BUSY','STORAGE_MAINTENANCE','ERASURE_SCOPE_PENDING'].includes(code);
  await db.dashboardAccountErasure.updateMany({where:{id:request.id,status:'RUNNING',leaseToken:token},data:{status:retry?'PENDING':blocked?'BLOCKED':'FAILED',availableAt:new Date(Date.now()+5000),leaseToken:null,leaseExpiresAt:null,errorCode:blocked||retry||['STORAGE_INVENTORY_LIMIT','ERASURE_LEDGER_LIMIT','ERASURE_LEDGER_INVALID','ERASURE_LEDGER_CONFLICT','ERASURE_LEDGER_UNAVAILABLE'].includes(code)?code:'ERASURE_PROCESSING_FAILED'}});return {claimed:true,id:request.id,status:retry?'PENDING':blocked?'BLOCKED':'FAILED'};
 }
}
