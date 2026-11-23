import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {setAuditActor} from '../audit/context';
import {storageMutationGuard} from '../storage/guard';
import {readErasureDecisions,identityDigest} from './ledger';
import {prepareErasureScopes,exclusiveErasureLock} from './service';
import {erasureDecision,requireErasureSettings} from './contracts';
/** Explicit restore step; never run against a serving customer release. */
export async function reconcileErasureLedger(){
 requireErasureSettings();if((process.env.DASHBOARD_RELEASE_MODE??'OFF')!=='OFF')throw Error('ERASURE_RECONCILIATION_REQUIRES_RELEASE_OFF');const decisions=await readErasureDecisions();let reconciled=0;
 for(const decision of decisions){
  await db.$transaction(async tx=>{
   await storageMutationGuard(tx);await setAuditActor(tx,{issuer:'dashboard-erasure-recovery',subject:decision.requestId},'WORKER');await exclusiveErasureLock(tx,'user',decision.userId);
   const user=await tx.dashboardUser.findUnique({where:{id:decision.userId}});if(user&&identityDigest(user.externalSubject)!==decision.identityDigest)throw Error('ERASURE_IDENTITY_MISMATCH');
   const previous=await tx.dashboardAccountErasure.findUnique({where:{id:decision.requestId}});if(previous&&JSON.stringify(erasureDecision.parse(previous.decision))!==JSON.stringify(decision))throw Error('ERASURE_LEDGER_CONFLICT');
   if(previous?.status==='RUNNING'&&previous.leaseExpiresAt&&previous.leaseExpiresAt>new Date())throw Error('ERASURE_PROCESSING');
   await tx.dashboardAccountErasure.upsert({where:{id:decision.requestId},create:{id:decision.requestId,userId:user?.id??null,receiptHash:decision.receiptHash,decision:decision as unknown as Prisma.InputJsonValue},update:{userId:user?.id??null,status:'PENDING',errorCode:null,completedAt:null,leaseToken:null,leaseExpiresAt:null,availableAt:new Date()}});
   await prepareErasureScopes(tx,decision);reconciled++;
  },{timeout:30000});
 }return {reconciled};
}

/** Fail worker startup after a restore until the retained decisions have been reconciled. */
export async function assertErasureRecoveryState(){
 const decisions=await readErasureDecisions();const {dashboardStorageBackend}=await import('../storage/inventory');const backend=dashboardStorageBackend();
 for(const decision of decisions){
  const request=await db.dashboardAccountErasure.findUnique({where:{id:decision.requestId}});if(!request||JSON.stringify(erasureDecision.parse(request.decision))!==JSON.stringify(decision))throw Error('ERASURE_RECONCILIATION_REQUIRED');
  const user=await db.dashboardUser.findUnique({where:{id:decision.userId},select:{erasureRequestedAt:true,externalSubject:true}});if(user&&identityDigest(user.externalSubject)!==decision.identityDigest)throw Error('ERASURE_IDENTITY_MISMATCH');
  if(request.status==='COMPLETED'){
   if(user||await db.dashboardWorkspace.count({where:{id:{in:decision.workspaceIds}}})||await db.dashboardOrganization.count({where:{id:{in:decision.organizationIds}}}))throw Error('ERASURE_RECONCILIATION_REQUIRED');
   for(const wid of decision.workspaceIds)if((await backend.list(wid)).length)throw Error('ERASURE_RECONCILIATION_REQUIRED');
  }else{
   if(user&&!user.erasureRequestedAt)throw Error('ERASURE_RECONCILIATION_REQUIRED');
   if(await db.dashboardWorkspace.count({where:{id:{in:decision.workspaceIds},OR:[{erasureRequestId:null},{erasureRequestId:{not:decision.requestId}}]}}))throw Error('ERASURE_RECONCILIATION_REQUIRED');
   if(await db.dashboardOrganization.count({where:{id:{in:decision.organizationIds},OR:[{erasureRequestId:null},{erasureRequestId:{not:decision.requestId}}]}}))throw Error('ERASURE_RECONCILIATION_REQUIRED');
  }
 }
}
