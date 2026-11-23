import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {AdminActor} from '../billing/contracts';
import {billingLock,reconcileLocked} from '../billing/service';
import {stripeTransport,type BillingTransport} from '../billing/stripe';
import {setAuditActor} from '../audit/context';
import {erasureDecision,erasureId,requireErasureSettings} from './contracts';
import {privateErasureScope} from './service';
import {saveErasureDecision} from './ledger';
export async function reconcileErasureBilling(id:string,actor:AdminActor,reason:string,transport:BillingTransport=stripeTransport){
 requireErasureSettings();if(!erasureId.safeParse(id).success||reason.trim().length<8||reason.length>500)throw Error('INVALID_ERASURE_REQUEST');
 const decision=await db.$transaction(async tx=>{
  await setAuditActor(tx,actor);await tx.$queryRaw`SELECT id FROM "DashboardAccountErasure" WHERE id=${id} FOR UPDATE`;
  const row=await tx.dashboardAccountErasure.findUnique({where:{id}});if(!row||row.status==='COMPLETED')throw Error('NOT_FOUND');if(row.status==='RUNNING'&&row.leaseExpiresAt&&row.leaseExpiresAt>new Date())throw Error('ERASURE_PROCESSING');
  await tx.dashboardAccountErasure.update({where:{id},data:{status:'BLOCKED',leaseToken:null,leaseExpiresAt:null,errorCode:'ERASURE_ADMIN_RECONCILIATION'}});
  await tx.dashboardAdminAudit.create({data:{actorIssuer:actor.issuer,actorSubject:actor.subject,action:'ADMIN_ACCOUNT_ERASURE_BILLING_RECONCILIATION',details:JSON.stringify({requestId:id,reason})}});return erasureDecision.parse(row.decision);
 });await saveErasureDecision(decision);
 for(const wid of decision.workspaceIds){
  if(!await db.dashboardBillingBinding.count({where:{workspaceId:wid}}))continue;
  await db.$transaction(async tx=>{await setAuditActor(tx,actor);const row=await tx.dashboardAccountErasure.findFirst({where:{id,status:'BLOCKED',errorCode:'ERASURE_ADMIN_RECONCILIATION'}});if(!row)throw Error('ERASURE_PROCESSING');await privateErasureScope(tx,id);await billingLock(tx,wid);await reconcileLocked(tx,wid,actor,transport);},{timeout:25000,maxWait:10000});
 }
 await db.dashboardAccountErasure.updateMany({where:{id,status:'BLOCKED',errorCode:'ERASURE_ADMIN_RECONCILIATION'},data:{status:'PENDING',errorCode:null,availableAt:new Date()}});return {requestId:id,status:'PENDING'};
}
