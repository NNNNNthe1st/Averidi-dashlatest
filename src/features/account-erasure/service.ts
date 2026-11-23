import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {setAuditActor} from '../audit/context';
import {storageMutationGuard} from '../storage/guard';
import {billingLock} from '../billing/service';
import {reviewAccountErasure} from './review';
import {erasureId,erasureDecision,requireErasureSettings,type ErasureDecision} from './contracts';
import {identityDigest,saveErasureDecision} from './ledger';
export const requestErasureSchema=z.object({reviewToken:z.string().regex(/^[a-f0-9]{64}$/),confirmation:z.literal('DELETE MY DASHBOARD ACCOUNT')}).strict();
export async function privateErasureScope(tx:Prisma.TransactionClient,id:string){await tx.$queryRaw`SELECT set_config('dashboard.erasure_request',${id},true)`;}
export async function exclusiveErasureLock(tx:Prisma.TransactionClient,kind:'user'|'workspace'|'organization',id:string){const [lock]=await tx.$queryRaw<{allowed:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${'dashboard-erasure-'+kind+':'+id},0)) AS allowed`;if(!lock.allowed)throw Error('ACCOUNT_ERASURE_BUSY');}
export async function prepareErasureScopes(tx:Prisma.TransactionClient,decision:ErasureDecision){
 await privateErasureScope(tx,decision.requestId);
 if(await tx.dashboardUser.count({where:{id:decision.userId}}))await tx.dashboardUser.update({where:{id:decision.userId},data:{erasureRequestedAt:new Date(decision.requestedAt)}});
 await tx.dashboardSession.updateMany({where:{userId:decision.userId,revokedAt:null},data:{revokedAt:new Date()}});
 for(const wid of [...decision.workspaceIds].sort()){
  await exclusiveErasureLock(tx,'workspace',wid);await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${wid} FOR UPDATE`;
  if(!await tx.dashboardWorkspace.count({where:{id:wid}}))continue;
  await tx.dashboardWorkspace.update({where:{id:wid},data:{erasureRequestId:decision.requestId}});
  await tx.dashboardWorkspaceInvitation.updateMany({where:{workspaceId:wid,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
  await tx.dashboardConnectorConfiguration.updateMany({where:{workspaceId:wid},data:{enabled:false,oauthAttemptId:null}});
  await tx.dashboardJobSchedule.updateMany({where:{workspaceId:wid},data:{enabled:false}});await tx.dashboardReportSchedule.updateMany({where:{workspaceId:wid},data:{enabled:false}});
  await tx.dashboardJob.updateMany({where:{workspaceId:wid,status:'QUEUED'},data:{status:'CANCELLED',cancelRequestedAt:new Date(),finishedAt:new Date()}});await tx.dashboardJob.updateMany({where:{workspaceId:wid,status:'RUNNING'},data:{cancelRequestedAt:new Date()}});
 }
 for(const oid of [...decision.organizationIds].sort()){await exclusiveErasureLock(tx,'organization',oid);await tx.$queryRaw`SELECT id FROM "DashboardOrganization" WHERE id=${oid} FOR UPDATE`;if(await tx.dashboardOrganization.count({where:{id:oid}})){await tx.dashboardOrganization.update({where:{id:oid},data:{erasureRequestId:decision.requestId}});await tx.dashboardOrganizationInvitation.updateMany({where:{organizationId:oid,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});}}
}
export async function requestAccountErasure(actor:Actor,input:unknown){
 requireErasureSettings();const p=requestErasureSchema.safeParse(input);if(!p.success)throw Error('INVALID_ERASURE_REQUEST');const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),id=randomUUID();
 const decision=await db.$transaction(async tx=>{
  await storageMutationGuard(tx);await setAuditActor(tx,actor);await exclusiveErasureLock(tx,'user',actor.userId);
  const initial=await reviewAccountErasure(actor,tx);for(const wid of [...initial.workspaceIds].sort())await billingLock(tx,wid);
  for(const wid of initial.workspaces.map(w=>w.id).sort()){await exclusiveErasureLock(tx,'workspace',wid);await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${wid} FOR UPDATE`;}
  for(const oid of initial.organizations.map(o=>o.id).sort()){await exclusiveErasureLock(tx,'organization',oid);await tx.$queryRaw`SELECT id FROM "DashboardOrganization" WHERE id=${oid} FOR UPDATE`;}
  const current=await reviewAccountErasure(actor,tx);if(current.reviewToken!==p.data.reviewToken)throw Error('ERASURE_REVIEW_CHANGED');if(current.blockers.length)throw Error('ERASURE_BLOCKED');
  const user=await tx.dashboardUser.findUniqueOrThrow({where:{id:actor.userId}}),decision:ErasureDecision={version:1,requestId:id,userId:actor.userId,identityDigest:identityDigest(user.externalSubject),workspaceIds:current.workspaceIds,organizationIds:current.organizationIds,receiptHash:hash,requestedAt:new Date().toISOString()};
  await tx.dashboardAccountErasure.create({data:{id,userId:actor.userId,receiptHash:hash,decision:decision as unknown as Prisma.InputJsonValue}});await prepareErasureScopes(tx,decision);return decision;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
 // The worker retries ledger persistence before any destructive step if the host is unavailable.
 await saveErasureDecision(decision).catch(()=>{});return {requestId:id,receiptToken:token,status:'PENDING'};
}
export async function erasureReceipt(id:string,token:string){
 if(!erasureId.safeParse(id).success||!/^[a-f0-9]{64}$/.test(token))throw Error('ERASURE_RECEIPT_INVALID');
 const row=await db.dashboardAccountErasure.findUnique({where:{id}}),digest=createHash('sha256').update(token).digest();if(!row||!/^[a-f0-9]{64}$/.test(row.receiptHash)||!timingSafeEqual(digest,Buffer.from(row.receiptHash,'hex')))throw Error('ERASURE_RECEIPT_INVALID');
 return {requestId:row.id,status:row.status,deletedObjects:row.deletedObjects,errorCode:row.errorCode,completedAt:row.completedAt};
}
export async function retryErasureReceipt(id:string,token:string){requireErasureSettings();await erasureReceipt(id,token);await db.dashboardAccountErasure.updateMany({where:{id,status:{in:['BLOCKED','FAILED']}},data:{status:'PENDING',errorCode:null,leaseToken:null,leaseExpiresAt:null,availableAt:new Date()}});return erasureReceipt(id,token);}
