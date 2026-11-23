import {setAuditActor} from '../src/features/audit/context';
import {reconcileBilling} from '../src/features/billing/service';
import {reconcileErasureBilling} from '../src/features/account-erasure/administration';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {reviewAccountErasure} from '../src/features/account-erasure/review';
import {requestAccountErasure,erasureReceipt,retryErasureReceipt,privateErasureScope} from '../src/features/account-erasure/service';
import {processAccountErasureOnce} from '../src/features/account-erasure/worker';
import {readErasureDecisions} from '../src/features/account-erasure/ledger';
import {reconcileErasureLedger,assertErasureRecoveryState} from '../src/features/account-erasure/reconcile';
import {erasureSettings} from '../src/features/account-erasure/contracts';
import {dashboardStorageBackend} from '../src/features/storage/inventory';
import {dashboardWorkspaceArtifactKey,writeDashboardObject} from '../src/server/storage';
import {writeWorkspaceObject} from '../src/server/workspace-storage';
import {issueDashboardBrowserSession,verifyDashboardBrowserSession} from '../src/server/browser-session';
import {changeWorkspaceMemberRole} from '../src/features/workspaces/service';
import {updateAccount} from '../src/features/account/service';
import {POST as requestPost} from '../src/app/api/account/erasure/route';
import {GET as receiptGet,POST as receiptPost} from '../src/app/api/account-erasure/[requestId]/route';
import {requireWorkspaceRole} from '../src/server/workspace-access';
after(()=>db.$disconnect());
async function fixture(){
 const env={...process.env},root=await mkdtemp(path.join(tmpdir(),'dashboard-erasure-'));Object.assign(process.env,{DASHBOARD_STORAGE_ROOT:path.join(root,'objects'),DASHBOARD_ACCOUNT_ERASURE_ENABLED:'true',DASHBOARD_ACCOUNT_ERASURE_KEY:'27'.repeat(32),DASHBOARD_ACCOUNT_ERASURE_LEDGER_ROOT:path.join(root,'decisions'),DASHBOARD_RELEASE_MODE:'GENERAL',DASHBOARD_PUBLIC_ORIGIN:'https://dashboard.test',DASHBOARD_WORKER_ENABLED:'true'});delete process.env.DASHBOARD_ACCOUNT_ERASURE_FINANCIAL_RETENTION_DAYS;const f=await governedWorkspace();
 return {...f,root,async cleanup(){await db.$transaction(async tx=>{const rows=await tx.dashboardAccountErasure.findMany({where:{decision:{path:['userId'],equals:f.actor.userId}}});for(const r of rows){if(r.status==='COMPLETED')await tx.dashboardAccountErasure.update({where:{id:r.id},data:{status:'RUNNING'}});await privateErasureScope(tx,r.id);}await tx.dashboardBillingBinding.deleteMany({where:{workspaceId:{in:[f.workspace.id,f.foreign.id]}}});await tx.dashboardWorkspace.deleteMany({where:{id:{in:[f.workspace.id,f.foreign.id]}}});await tx.dashboardSupportCase.deleteMany({where:{requesterId:{in:[f.actor.userId,f.reader.userId]}}});await tx.dashboardUser.deleteMany({where:{id:{in:[f.actor.userId,f.reader.userId]}}});await tx.dashboardAccountErasure.deleteMany({where:{id:{in:rows.map(r=>r.id)}}});},{timeout:30000});await rm(root,{recursive:true,force:true});for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}};
}
async function request(f:Awaited<ReturnType<typeof fixture>>){const review=await reviewAccountErasure(f.actor);assert.deepEqual(review.blockers,[]);return requestAccountErasure(f.actor,{reviewToken:review.reviewToken,confirmation:'DELETE MY DASHBOARD ACCOUNT'});}
async function finish(id:string,backend=dashboardStorageBackend()){
 for(let n=0;n<40;n++){await db.dashboardAccountErasure.updateMany({where:{id,status:'PENDING'},data:{availableAt:new Date(0)}});const result=await processAccountErasureOnce(undefined,undefined,backend);if(result.status==='COMPLETED'||['BLOCKED','FAILED'].includes(result.status??''))return result;}
 throw Error('Erasure did not finish');
}
test('erasure is explicitly configured, rejects overlapping storage and has no invented financial retention',()=>{
 assert.equal(erasureSettings({}),null);assert.throws(()=>erasureSettings({DASHBOARD_ACCOUNT_ERASURE_ENABLED:'true'}));assert.throws(()=>erasureSettings({DASHBOARD_ACCOUNT_ERASURE_ENABLED:'true',DASHBOARD_ACCOUNT_ERASURE_KEY:'00'.repeat(32),DASHBOARD_ACCOUNT_ERASURE_LEDGER_ROOT:'/tmp/dashboard-files',DASHBOARD_STORAGE_ROOT:'/tmp/dashboard-files'}));
 assert.equal(erasureSettings({DASHBOARD_ACCOUNT_ERASURE_ENABLED:'true',DASHBOARD_ACCOUNT_ERASURE_KEY:'00'.repeat(32),DASHBOARD_ACCOUNT_ERASURE_LEDGER_ROOT:'/tmp/dashboard-decisions'})?.financialRetentionDays,null);
});
test('review blocks shared sole ownership, legal holds and financial retention without changing access',async()=>{
 const f=await fixture();try{
  let review=await reviewAccountErasure(f.actor);assert.ok(review.blockers.includes('WORKSPACE_OWNER_TRANSFER'));assert.ok(await requireWorkspaceRole(f.actor,f.workspace.id,'OWNER'));
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');
  await db.dashboardStoragePolicy.create({data:{workspaceId:f.foreign.id,legalHold:true}});review=await reviewAccountErasure(f.actor);assert.ok(review.blockers.includes('LEGAL_HOLD'));await assert.rejects(requestAccountErasure(f.actor,{reviewToken:review.reviewToken,confirmation:'DELETE MY DASHBOARD ACCOUNT'}),/ERASURE_BLOCKED/);assert.equal((await db.dashboardUser.findUniqueOrThrow({where:{id:f.actor.userId}})).erasureRequestedAt,null);
  await db.dashboardStoragePolicy.update({where:{workspaceId:f.foreign.id},data:{legalHold:false}});await db.dashboardBillingCustomer.create({data:{workspaceId:f.foreign.id,provider:'STRIPE',externalCustomerId:'cus_'+randomUUID().replaceAll('-','')}});review=await reviewAccountErasure(f.actor);assert.ok(review.blockers.includes('FINANCIAL_RETENTION'));assert.equal(await db.dashboardAccountErasure.count({where:{userId:f.actor.userId}}),0);
 }finally{await f.cleanup();}
});
test('review revisions, strict confirmation and same-origin auth gate acceptance',async()=>{
 const f=await fixture();try{
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');const review=await reviewAccountErasure(f.actor);await updateAccount(f.actor,{action:'PROFILE',displayName:'Changed after review',expectedDisplayName:null});await assert.rejects(requestAccountErasure(f.actor,{reviewToken:review.reviewToken,confirmation:'DELETE MY DASHBOARD ACCOUNT'}),/ERASURE_REVIEW_CHANGED/);
  await assert.rejects(requestAccountErasure(f.actor,{reviewToken:(await reviewAccountErasure(f.actor)).reviewToken,confirmation:'delete'}),/INVALID_ERASURE_REQUEST/);
  const token=await issueDashboardBrowserSession(f.actor),headers={cookie:'__Secure-averidi-dashboard='+token,origin:'https://evil.test','Content-Type':'application/json'},response=await requestPost(new Request('https://dashboard.test/dashboard/app/api/account/erasure',{method:'POST',headers,body:'{}'}));assert.equal(response.status,403);
 }finally{await f.cleanup();}
});
test('accepted erasure fences the account and owned workspaces while retaining a scoped secret receipt',async()=>{
 const f=await fixture();try{
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');const jwt=await issueDashboardBrowserSession(f.actor),review=await reviewAccountErasure(f.actor),response=await requestPost(new Request('https://dashboard.test/dashboard/app/api/account/erasure',{method:'POST',headers:{origin:'https://dashboard.test',cookie:'__Secure-averidi-dashboard='+jwt,'Content-Type':'application/json'},body:JSON.stringify({reviewToken:review.reviewToken,confirmation:'DELETE MY DASHBOARD ACCOUNT'})}));assert.equal(response.status,202);assert.match(response.headers.get('set-cookie')??'',/Max-Age=0/);const accepted=await response.json() as {requestId:string;receiptToken:string};const queued=await db.dashboardAccountErasure.findUniqueOrThrow({where:{id:accepted.requestId}});assert.ok(Math.abs(queued.availableAt.getTime()-Date.now())<5000,'New requests must be immediately available in UTC');assert.ok(Math.abs(queued.createdAt.getTime()-Date.now())<5000,'Request time must retain UTC meaning');assert.equal(await verifyDashboardBrowserSession(jwt),null);assert.equal(await requireWorkspaceRole(f.actor,f.workspace.id,'OWNER'),null);
  await assert.rejects(db.dashboardSession.create({data:{id:randomUUID(),userId:f.actor.userId,expiresAt:new Date(Date.now()+60000)}}),/ACCOUNT_ERASING/);await assert.rejects(db.dashboardDataset.create({data:{workspaceId:f.foreign.id,name:'Denied after fencing'}}),/WORKSPACE_ERASING/);
  await assert.rejects(writeWorkspaceObject(f.reader,f.foreign.id,dashboardWorkspaceArtifactKey('temporary',f.foreign.id,'denied'),Buffer.from('denied')),/FORBIDDEN/);
  const context={params:Promise.resolve({requestId:accepted.requestId})},url='https://dashboard.test/dashboard/app/api/account-erasure/'+accepted.requestId;assert.equal((await receiptGet(new Request(url),context)).status,401);assert.equal((await receiptGet(new Request(url,{headers:{Authorization:'Erasure '+accepted.receiptToken}}),context)).status,200);await assert.rejects(erasureReceipt(accepted.requestId,'ff'.repeat(32)),/ERASURE_RECEIPT_INVALID/);
  assert.equal((await receiptPost(new Request(url,{method:'POST',headers:{Authorization:'Erasure '+accepted.receiptToken,origin:'https://evil.test'}}),context)).status,403);
  const decisions=await readErasureDecisions();assert.equal(decisions.length,1);assert.ok(!JSON.stringify(decisions).includes(f.actor.subject));assert.ok(!JSON.stringify(decisions).includes(accepted.receiptToken));
 }finally{await f.cleanup();}
});
test('real files, solo workspaces and personal state are erased; other Owners retain their ready data and audit evidence',async()=>{
 const f=await fixture();try{
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');await updateAccount(f.actor,{action:'PROFILE',displayName:'Private erasure name',expectedDisplayName:null});const sourceKey=dashboardWorkspaceArtifactKey('temporary',f.foreign.id,'private');await writeDashboardObject(sourceKey,Buffer.from('owned private file'));
  await db.dashboardSupportCase.create({data:{workspaceId:f.workspace.id,requesterId:f.actor.userId,subject:'Private support',details:{message:'Remove these private messages'}}});
  const accepted=await request(f);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');assert.equal(await db.dashboardUser.count({where:{id:f.actor.userId}}),0);assert.equal(await db.dashboardWorkspace.count({where:{id:f.foreign.id}}),0);assert.deepEqual(await dashboardStorageBackend().list(f.foreign.id),[]);
  assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id:f.dataset.id}})).activeVersionId,f.versionId);assert.ok((await dashboardStorageBackend().list(f.workspace.id)).length);assert.ok(await requireWorkspaceRole(f.reader,f.workspace.id,'OWNER'));assert.equal(await db.dashboardSupportCase.count({where:{requesterId:f.actor.userId}}),0);
  assert.equal(await db.dashboardMutationAudit.count({where:{OR:[{userId:f.actor.userId},{actorUserId:f.actor.userId},{actorIssuer:f.actor.issuer,actorSubject:f.actor.subject}]}}),0);assert.ok(await db.dashboardMutationAudit.count({where:{actorIssuer:'erased-account',actorSubject:accepted.requestId}}));await assertErasureRecoveryState();assert.equal((await erasureReceipt(accepted.requestId,accepted.receiptToken)).status,'COMPLETED');
 }finally{await f.cleanup();}
});
test('all solo-owned file areas are deleted in bounded batches with durable retry after I/O failure',async()=>{
 const f=await fixture();try{
  await db.dashboardMembership.deleteMany({where:{workspaceId:f.workspace.id,userId:f.reader.userId}});for(let i=0;i<10;i++)await writeDashboardObject(dashboardWorkspaceArtifactKey(i%2?'reports':'temporary',f.foreign.id,'extra_'+i),Buffer.from('private '+i));
  const accepted=await request(f),backend=dashboardStorageBackend();let failed=false;const flaky={...backend,async remove(object:Parameters<typeof backend.remove>[0]){if(!failed){failed=true;throw Error('injected unavailable store');}return backend.remove(object);}};
  assert.equal((await processAccountErasureOnce(undefined,undefined,flaky)).status,'FAILED');assert.ok(await db.dashboardUser.count({where:{id:f.actor.userId}}));await retryErasureReceipt(accepted.requestId,accepted.receiptToken);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');assert.deepEqual(await backend.list(f.workspace.id),[]);assert.deepEqual(await backend.list(f.foreign.id),[]);
 }finally{await f.cleanup();}
});
test('a new legal hold pauses physical deletion and a retry cannot bypass it',async()=>{
 const f=await fixture();try{
  await db.dashboardMembership.deleteMany({where:{workspaceId:f.workspace.id,userId:f.reader.userId}});const key=dashboardWorkspaceArtifactKey('temporary',f.workspace.id,'held');await writeDashboardObject(key,Buffer.from('held data'));const accepted=await request(f);await db.dashboardStoragePolicy.create({data:{workspaceId:f.workspace.id,legalHold:true}});assert.equal((await processAccountErasureOnce()).status,'BLOCKED');assert.ok((await dashboardStorageBackend().list(f.workspace.id)).some(o=>o.key===key));await retryErasureReceipt(accepted.requestId,accepted.receiptToken);assert.equal((await processAccountErasureOnce()).status,'BLOCKED');
  await db.dashboardStoragePolicy.update({where:{workspaceId:f.workspace.id},data:{legalHold:false}});await retryErasureReceipt(accepted.requestId,accepted.receiptToken);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');
 }finally{await f.cleanup();}
});
test('sealed decisions reject tampering and restore reconciliation re-fences resurrected data before cleanup',async()=>{
 const f=await fixture();try{
  await db.dashboardMembership.deleteMany({where:{workspaceId:f.workspace.id,userId:f.reader.userId}});const user=await db.dashboardUser.findUniqueOrThrow({where:{id:f.actor.userId}}),workspaceId=f.foreign.id,accepted=await request(f);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');
  const file=path.join(f.root,'decisions',accepted.requestId+'.json'),original=await readFile(file);await writeFile(file,original.toString().replace('"version":1','"version":2'));await assert.rejects(readErasureDecisions());await writeFile(file,original);
  await db.dashboardUser.create({data:{id:user.id,externalSubject:user.externalSubject}});await db.dashboardWorkspace.create({data:{id:workspaceId,name:'Restored older data',memberships:{create:{userId:user.id,role:'OWNER'}}}});const key=dashboardWorkspaceArtifactKey('temporary',workspaceId,'restored');await writeDashboardObject(key,Buffer.from('old backup file'));await assert.rejects(assertErasureRecoveryState(),/ERASURE_RECONCILIATION_REQUIRED/);
  process.env.DASHBOARD_RELEASE_MODE='GENERAL';await assert.rejects(reconcileErasureLedger(),/REQUIRES_RELEASE_OFF/);process.env.DASHBOARD_RELEASE_MODE='OFF';assert.equal((await reconcileErasureLedger()).reconciled,1);assert.equal(await requireWorkspaceRole(f.actor,workspaceId,'OWNER'),null);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');assert.deepEqual(await dashboardStorageBackend().list(workspaceId),[]);assert.equal(await db.dashboardUser.count({where:{id:user.id}}),0);await assertErasureRecoveryState();
 }finally{await f.cleanup();}
});

test('in-flight actor writes cannot race acceptance, and the last active Owner cannot disappear',async()=>{
 const f=await fixture();let release:()=>void=()=>{};try{
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');let entered!:()=>void;const ready=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);const mutation=db.$transaction(async tx=>{await setAuditActor(tx,f.actor);entered();await hold;},{timeout:10000});await ready;
  await assert.rejects(request(f),/ACCOUNT_ERASURE_BUSY/);release();await mutation;assert.equal(await db.dashboardAccountErasure.count({where:{userId:f.actor.userId}}),0);
  const accepted=await request(f);const result=await changeWorkspaceMemberRole(f.reader,f.workspace.id,f.reader.userId,'VIEWER');assert.equal(result.ok,false);assert.ok(!result.ok&&result.error==='LAST_OWNER');assert.equal((await finish(accepted.requestId)).status,'COMPLETED');assert.ok(await requireWorkspaceRole(f.reader,f.workspace.id,'OWNER'));
 }finally{release();await f.cleanup();}
});
test('an erasure privacy context cannot change historical operations or transaction evidence',async()=>{
 const f=await fixture();try{
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');const accepted=await request(f),row=await db.dashboardMutationAudit.findFirstOrThrow({where:{actorUserId:f.actor.userId}});await db.dashboardAccountErasure.update({where:{id:accepted.requestId},data:{status:'RUNNING',leaseToken:'synthetic-expired-lease',leaseExpiresAt:new Date(0)}});
  await assert.rejects(db.$transaction(async tx=>{await privateErasureScope(tx,accepted.requestId);await tx.$queryRaw`SELECT set_config('dashboard.erasure_subjects',${JSON.stringify([{issuer:f.actor.issuer,subject:f.actor.subject}])},true)`;await tx.dashboardMutationAudit.update({where:{id:row.id},data:{operation:'DELETE'}});}),/AUDIT_APPEND_ONLY/);
  assert.equal((await db.dashboardMutationAudit.findUniqueOrThrow({where:{id:row.id}})).operation,row.operation);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');
 }finally{await f.cleanup();}
});
test('retired plans do not obscure terminal provider proof; admin reconciliation can recover fenced billing',async()=>{
 const f=await fixture();let planId:string|undefined;try{
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');const tag=randomUUID().replaceAll('-',''),old=new Date(Date.now()-10*86400000),now=Math.floor(Date.now()/1000),price='price_'+tag,customerId='cus_'+tag,subId='sub_'+tag;
  Object.assign(process.env,{DASHBOARD_BILLING_ENABLED:'true',DASHBOARD_BILLING_STRIPE_MODE:'test',DASHBOARD_BILLING_STRIPE_SECRET_KEY:'sk_test_fixtureBillingAccount123456',DASHBOARD_BILLING_STRIPE_WEBHOOK_SECRET:'whsec_fixtureBillingSecret123456789',DASHBOARD_ACCOUNT_ERASURE_FINANCIAL_RETENTION_DAYS:'1'});
  const plan=await db.dashboardBillingPlan.create({data:{code:'ERASURE_'+tag.slice(0,25).toUpperCase(),name:'Retired synthetic plan',active:false,entitlements:{dashboardAccess:true},externalPriceId:price,currency:'USD',amountMinor:2500,billingInterval:'month'}});planId=plan.id;
  const customer=await db.dashboardBillingCustomer.create({data:{workspaceId:f.foreign.id,provider:'STRIPE',externalCustomerId:customerId,createdAt:old}});await db.dashboardBillingBinding.create({data:{workspaceId:f.foreign.id,customerId:customer.id,externalSubscriptionId:subId,createdAt:old}});
  const transport=async(path:string)=>{assert.equal(path,'/subscriptions/'+subId);return {id:subId,object:'subscription',customer:customerId,livemode:false,status:'canceled',cancel_at_period_end:false,pause_collection:null,items:{has_more:false,data:[{quantity:1,current_period_start:now-20*86400,current_period_end:now-10*86400,price:{id:price,currency:'usd',unit_amount:2500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]},latest_invoice:null};};
  assert.ok((await reviewAccountErasure(f.actor)).blockers.includes('BILLING_ACTIVE'));const admin={issuer:'erasure-admin',subject:'operator'};await reconcileBilling(f.foreign.id,admin,transport);assert.equal((await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId:f.foreign.id}})).status,'INACTIVE');assert.equal((await db.dashboardBillingBinding.findUniqueOrThrow({where:{workspaceId:f.foreign.id}})).providerStatus,'canceled');
  const accepted=await request(f);await db.$transaction(async tx=>{await privateErasureScope(tx,accepted.requestId);await tx.dashboardBillingBinding.update({where:{workspaceId:f.foreign.id},data:{providerStatus:null}});});assert.equal((await processAccountErasureOnce()).status,'BLOCKED');await reconcileErasureBilling(accepted.requestId,admin,'Reviewed restored billing against the provider.',transport);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');
 }finally{await f.cleanup();if(planId)await db.dashboardBillingPlan.delete({where:{id:planId}});}
});

test('solo organizations are deleted while shared organizations retain their other Owner',async()=>{
 const f=await fixture();let solo:string|undefined,shared:string|undefined;try{
  await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');const a=await db.dashboardOrganization.create({data:{name:'Solo erasure organization',organizationMemberRecords:{create:{userId:f.actor.userId,role:'OWNER'}}}});solo=a.id;const b=await db.dashboardOrganization.create({data:{name:'Shared retained organization',organizationMemberRecords:{create:[{userId:f.actor.userId,role:'OWNER'},{userId:f.reader.userId,role:'VIEWER'}]}}});shared=b.id;
  await db.dashboardWorkspace.update({where:{id:f.foreign.id},data:{organizationId:solo}});assert.ok((await reviewAccountErasure(f.actor)).blockers.includes('ORGANIZATION_OWNER_TRANSFER'));await db.dashboardOrganizationMember.update({where:{organizationId_userId:{organizationId:shared,userId:f.reader.userId}},data:{role:'OWNER'}});
  const accepted=await request(f);await db.$transaction(async tx=>{await privateErasureScope(tx,accepted.requestId);await tx.dashboardOrganization.update({where:{id:solo},data:{erasureRequestId:null}});});await assert.rejects(assertErasureRecoveryState(),/ERASURE_RECONCILIATION_REQUIRED/);assert.equal((await finish(accepted.requestId)).status,'BLOCKED');assert.equal((await erasureReceipt(accepted.requestId,accepted.receiptToken)).errorCode,'ERASURE_SCOPE_CHANGED');assert.equal(await db.dashboardOrganization.count({where:{id:solo}}),1);process.env.DASHBOARD_RELEASE_MODE='OFF';await reconcileErasureLedger();assert.equal((await finish(accepted.requestId)).status,'COMPLETED');assert.equal(await db.dashboardOrganization.count({where:{id:solo}}),0);assert.equal(await db.dashboardOrganizationMember.count({where:{organizationId:shared,userId:f.reader.userId,role:'OWNER'}}),1);assert.equal(await db.dashboardOrganizationMember.count({where:{userId:f.actor.userId}}),0);
 }finally{await f.cleanup();if(shared)await db.dashboardOrganization.deleteMany({where:{id:shared}});if(solo)await db.dashboardOrganization.deleteMany({where:{id:solo}});}
});
test('file-only backup restore automatically requeues erasure and requires a closed release',async()=>{
 const f=await fixture();try{
  const {createStorageBackup,restoreStorageBackup}=await import('../src/features/storage/backup');await changeWorkspaceMemberRole(f.actor,f.workspace.id,f.reader.userId,'OWNER');const key=dashboardWorkspaceArtifactKey('temporary',f.foreign.id,'backup-private'),backup=path.join(f.root,'backup'),secret='84'.repeat(32);await writeDashboardObject(key,Buffer.from('old private backup'));await createStorageBackup(backup,secret,f.foreign.id);
  const accepted=await request(f);assert.equal((await finish(accepted.requestId)).status,'COMPLETED');await assert.rejects(restoreStorageBackup(backup,secret),/REQUIRES_RELEASE_OFF/);process.env.DASHBOARD_RELEASE_MODE='OFF';const restored=await restoreStorageBackup(backup,secret);assert.equal(restored.restored,1);assert.equal((await erasureReceipt(accepted.requestId,accepted.receiptToken)).status,'PENDING');assert.equal((await finish(accepted.requestId)).status,'COMPLETED');assert.deepEqual(await dashboardStorageBackend().list(f.foreign.id),[]);
 }finally{await f.cleanup();}
});
