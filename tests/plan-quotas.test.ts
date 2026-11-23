import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {planSchema} from '../src/features/billing/contracts';
import {savePlan} from '../src/features/billing/service';
import {quotaSchema,quotaFailure} from '../src/features/quotas/contracts';
import {workspaceQuotaUsage,readWorkspaceQuotaUsage,assertStorageQuota} from '../src/features/quotas/service';
import {workerErrorCode,finishDashboardJob} from '../src/worker/job-claim';
import {POST as datasetPost} from '../src/app/api/workspaces/[workspaceId]/datasets/route';
import {GET as usageGet} from '../src/app/api/workspaces/[workspaceId]/usage/route';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {createWorkspaceInvitation,acceptWorkspaceInvitation} from '../src/features/workspaces/invitations';
import {writeWorkspaceObject} from '../src/server/workspace-storage';
import {readDashboardObject,dashboardStorageKey} from '../src/server/storage';
import type {VerifiedDashboardActor as Actor} from '../src/server/workspace-access';
import type {Prisma} from '@prisma/client';
after(()=>db.$disconnect());
const admin={issuer:'quota-test',subject:'administrator'};
const definition=(code:string,quotas:unknown)=>({code,name:'Explicit quota plan',active:true,entitlements:{dashboardAccess:true,quotas},externalPriceId:null,currency:null,amountMinor:null,billingInterval:null});
async function fixture(quotas:unknown={}){
 const subject=randomUUID(),otherSubject=randomUUID(),user=await db.dashboardUser.create({data:{externalSubject:'quota-test|'+subject}}),other=await db.dashboardUser.create({data:{externalSubject:'quota-test|'+otherSubject}});
 const actor:Actor={userId:user.id,issuer:'quota-test',subject},outside:Actor={userId:other.id,issuer:'quota-test',subject:otherSubject};
 const plan=await savePlan(definition('QUOTA_'+randomUUID().replaceAll('-','').toUpperCase(),quotas),admin);
 const workspace=await db.dashboardWorkspace.create({data:{name:'Quota test workspace',memberships:{create:{userId:user.id,role:'OWNER'}}}});
 await db.dashboardSubscription.create({data:{workspaceId:workspace.id,planCode:plan.code,billingPlanId:plan.id,status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}});
 const env={mode:process.env.DASHBOARD_RELEASE_MODE,secret:process.env.DASHBOARD_SESSION_SECRET};process.env.DASHBOARD_RELEASE_MODE='GENERAL';process.env.DASHBOARD_SESSION_SECRET='synthetic-quota-session-key-'.repeat(3);
 return {workspace,plan,actor,outside,async policy(value:unknown){await savePlan(definition(plan.code,value),admin);},async cleanup(){await db.dashboardWorkspace.delete({where:{id:workspace.id}});await db.dashboardBillingPlan.delete({where:{id:plan.id}});await db.dashboardUser.deleteMany({where:{id:{in:[user.id,other.id]}}});if(env.mode===undefined)delete process.env.DASHBOARD_RELEASE_MODE;else process.env.DASHBOARD_RELEASE_MODE=env.mode;if(env.secret===undefined)delete process.env.DASHBOARD_SESSION_SECRET;else process.env.DASHBOARD_SESSION_SECRET=env.secret;}};
}
function resource(result:Awaited<ReturnType<typeof workspaceQuotaUsage>>,key:string){return result.resources.find(r=>r.key===key)!;}
async function limited(promise:Promise<unknown>,key:string){try{await promise;assert.fail('Expected quota rejection');}catch(error){assert.equal(quotaFailure(error),key);assert.equal(workerErrorCode(error),'QUOTA_EXCEEDED');}}
test('plan quotas are explicit, strict, safe integers and preserve unlimited legacy plans',()=>{
 assert.equal(planSchema.safeParse({...definition('LEGACY',{}),entitlements:{dashboardAccess:true}}).success,true);
 assert.equal(quotaSchema.safeParse({seats:0,storedBytes:null}).success,true);
 for(const policy of [{seats:-1},{seats:1.5},{storedBytes:Number.MAX_SAFE_INTEGER+1},{unknown:2},{datasets:'10'}])assert.equal(quotaSchema.safeParse(policy).success,false);
 assert.equal(quotaFailure(Error('other private SQL message')),null);
});
test('native admission serializes racing inserts and permits downgrade reads, edits and removal',async()=>{
 const f=await fixture({teams:1});try{
  const race=await Promise.allSettled([db.dashboardTeam.create({data:{workspaceId:f.workspace.id,name:'First'}}),db.dashboardTeam.create({data:{workspaceId:f.workspace.id,name:'Second'}})]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(quotaFailure((race.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),'teams');
  const team=await db.dashboardTeam.findFirstOrThrow({where:{workspaceId:f.workspace.id}});await f.policy({teams:0});
  assert.equal(resource(await workspaceQuotaUsage(f.workspace.id),'teams').overLimit,true);
  await db.dashboardTeam.update({where:{id:team.id},data:{name:'Retained'}});await limited(db.dashboardTeam.create({data:{workspaceId:f.workspace.id,name:'Denied'}}),'teams');
  await db.dashboardTeam.delete({where:{id:team.id}});await f.policy({teams:null});await db.dashboardTeam.create({data:{workspaceId:f.workspace.id,name:'Allowed'}});
  assert.ok(await db.dashboardAdminAudit.count({where:{action:'ADMIN_BILLING_PLAN',details:{contains:f.plan.code}}}));
 }finally{await f.cleanup();}
});
test('seat acceptance enforces current capacity atomically and leaves rejected invitations reusable',async()=>{
 const f=await fixture({seats:1});try{
  const invitation=await createWorkspaceInvitation(f.actor,f.workspace.id,'VIEWER');assert.equal(invitation.ok,true);if(!invitation.ok)return;
  await limited(acceptWorkspaceInvitation(f.outside,invitation.token),'seats');assert.equal((await db.dashboardWorkspaceInvitation.findUniqueOrThrow({where:{id:invitation.invitation.id}})).acceptedAt,null);
  await f.policy({seats:2});assert.equal((await acceptWorkspaceInvitation(f.outside,invitation.token)).ok,true);
  assert.equal(resource(await workspaceQuotaUsage(f.workspace.id),'seats').used,'2');
 }finally{await f.cleanup();}
});
test('source, dashboard, report and definition quotas cannot be bypassed with direct runtime writes',async()=>{
 const f=await fixture({datasets:1,dashboards:0,connectors:0,reports:0,customMetrics:0,relationships:0,targets:0,customRoles:0,shares:0});try{
  const data=await db.dashboardDataset.create({data:{workspaceId:f.workspace.id,name:'Retained'}});await limited(db.dashboardDataset.create({data:{workspaceId:f.workspace.id,name:'Extra'}}),'datasets');
  await db.dashboardDataset.update({where:{id:data.id},data:{status:'ARCHIVED'}});const active=await db.dashboardDataset.create({data:{workspaceId:f.workspace.id,name:'Capacity reused'}});await limited(db.dashboardDataset.update({where:{id:data.id},data:{status:'READY'}}),'datasets');
  await limited(db.dashboardView.create({data:{workspaceId:f.workspace.id,datasetId:active.id,name:'View',definition:{}}}),'dashboards');
  const source=await db.dashboardDataSource.create({data:{workspaceId:f.workspace.id,name:'source',kind:'CUSTOM_API'}});await limited(db.dashboardConnectorConfiguration.create({data:{workspaceId:f.workspace.id,sourceId:source.id,provider:'CUSTOM_API',configuration:{}}}),'connectors');
  await limited(db.dashboardReportDefinition.create({data:{workspaceId:f.workspace.id,name:'Report',definition:{},format:'CSV'}}),'reports');
  const built=await db.dashboardMetricDefinition.create({data:{workspaceId:f.workspace.id,key:'REVENUE',name:'Built in',definition:{}}});
  await limited(db.dashboardMetricDefinition.create({data:{workspaceId:f.workspace.id,key:'CUSTOM_FORMULA_'+randomUUID(),name:'Formula',definition:{}}}),'customMetrics');
  const entities=await Promise.all([active,data].map((d,i)=>db.dashboardBusinessEntity.create({data:{workspaceId:f.workspace.id,datasetId:d.id,key:'entity_'+i,fields:[]}})));
  await limited(db.dashboardDataRelationship.create({data:{workspaceId:f.workspace.id,name:'Relationship',cardinality:'ONE_TO_ONE',fromEntityId:entities[0].id,toEntityId:entities[1].id,fieldMappings:[]}}),'relationships');
  await limited(db.dashboardTarget.create({data:{workspaceId:f.workspace.id,metricId:built.id,name:'Target',value:1,periodStart:new Date('2026-01-01'),periodEnd:new Date('2026-02-01')}}),'targets');
  await limited(db.dashboardWorkspaceRole.create({data:{workspaceId:f.workspace.id,name:'Restricted',key:'ROLE',permissions:[]}}),'customRoles');
  await f.policy({shares:0});const view=await db.dashboardView.create({data:{workspaceId:f.workspace.id,datasetId:active.id,name:'Sharing fixture',definition:{}}});await limited(db.dashboardShare.create({data:{workspaceId:f.workspace.id,viewId:view.id,kind:'LINK',tokenHash:randomUUID(),permission:'VIEW',expiresAt:new Date(Date.now()+60000)}}),'shares');
  await db.dashboardShare.create({data:{workspaceId:f.workspace.id,viewId:view.id,kind:'LINK',tokenHash:randomUUID(),permission:'VIEW',expiresAt:new Date(0)}});
  const direct=await db.dashboardShare.create({data:{workspaceId:f.workspace.id,viewId:view.id,kind:'DIRECT',tokenHash:randomUUID(),permission:'VIEW',expiresAt:new Date(Date.now()+60000)}}),membership=await db.dashboardMembership.findUniqueOrThrow({where:{userId_workspaceId:{userId:f.actor.userId,workspaceId:f.workspace.id}}}),grant={workspaceId:f.workspace.id,userId:f.actor.userId,membershipId:membership.id,shareId:direct.id,permission:'VIEW'};await limited(db.dashboardAccessGrant.create({data:grant}),'shares');await f.policy({shares:1});const granted=await db.dashboardAccessGrant.create({data:grant});assert.equal(resource(await workspaceQuotaUsage(f.workspace.id),'shares').used,'1');await db.dashboardAccessGrant.update({where:{id:granted.id},data:{revokedAt:new Date()}});assert.equal(resource(await workspaceQuotaUsage(f.workspace.id),'shares').used,'0');
 }finally{await f.cleanup();}
});
test('enabled schedules and alerts count transitions across both schedule models',async()=>{
 const f=await fixture({schedules:1,alerts:1});try{
  const schedule=await db.dashboardJobSchedule.create({data:{workspaceId:f.workspace.id,kind:'STORAGE_CLEANUP',payload:{},intervalSeconds:3600,nextRunAt:new Date(),enabled:false}});
  await db.dashboardJobSchedule.update({where:{id:schedule.id},data:{enabled:true}});
  const report=await db.dashboardReportDefinition.create({data:{workspaceId:f.workspace.id,name:'Report',format:'CSV',definition:{}}});
  const second=await db.dashboardReportSchedule.create({data:{workspaceId:f.workspace.id,reportId:report.id,enabled:false,intervalSeconds:3600,nextRunAt:new Date(),recipients:[]}});
  await limited(db.dashboardReportSchedule.update({where:{id:second.id},data:{enabled:true}}),'schedules');await db.dashboardJobSchedule.update({where:{id:schedule.id},data:{enabled:false}});await db.dashboardReportSchedule.update({where:{id:second.id},data:{enabled:true}});
  const metric=await db.dashboardMetricDefinition.create({data:{workspaceId:f.workspace.id,key:'REVENUE',name:'Revenue',definition:{}}});
  await db.dashboardAlertRule.create({data:{workspaceId:f.workspace.id,metricId:metric.id,name:'Alert',condition:{},enabled:true}});await limited(db.dashboardAlertRule.create({data:{workspaceId:f.workspace.id,metricId:metric.id,name:'Extra',condition:{},enabled:true}}),'alerts');
  assert.equal(resource(await workspaceQuotaUsage(f.workspace.id),'schedules').used,'1');
 }finally{await f.cleanup();}
});
test('storage preflight and publication count retained source, snapshot and report bytes until deletion',async()=>{
 const f=await fixture({storedBytes:20});try{
  const dataset=await db.dashboardDataset.create({data:{workspaceId:f.workspace.id,name:'Data'}}),id=randomUUID(),key=dashboardStorageKey(f.workspace.id,dataset.id,id);
  const version=await db.dashboardDatasetVersion.create({data:{id,datasetId:dataset.id,version:1,storageKey:key,fileSize:BigInt(10),checksum:'fixture'}});
  await db.$transaction(tx=>assertStorageQuota(tx,key,10));await limited(db.$transaction(tx=>assertStorageQuota(tx,'snapshots/'+f.workspace.id+'/large.bin',11)),'storedBytes');
  await db.dashboardDatasetSnapshot.create({data:{workspaceId:f.workspace.id,datasetId:dataset.id,versionId:version.id,storageKey:'snapshots/'+f.workspace.id+'/small.bin',fileSize:BigInt(5),checksum:'snapshot',rowCount:1}});
  const report=await db.dashboardReportDefinition.create({data:{workspaceId:f.workspace.id,name:'Report',definition:{},format:'CSV'}}),output=await db.dashboardReportExport.create({data:{workspaceId:f.workspace.id,reportId:report.id}});
  await limited(db.dashboardReportExport.update({where:{id:output.id},data:{fileSize:BigInt(6),storageKey:'reports/'+f.workspace.id+'/report.bin',status:'READY',checksum:'fixture',completedAt:new Date()}}),'storedBytes');
  await db.dashboardReportExport.update({where:{id:output.id},data:{fileSize:BigInt(5),storageKey:'reports/'+f.workspace.id+'/report.bin',status:'READY',checksum:'fixture',completedAt:new Date()}});
  assert.equal(resource(await workspaceQuotaUsage(f.workspace.id),'storedBytes').used,'20');
  await db.dashboardStorageDeletion.create({data:{workspaceId:f.workspace.id,storageKey:key,fingerprint:'fixture',fileSize:BigInt(10),reason:'ORPHAN',status:'DELETED',observedAt:new Date(),eligibleAfter:new Date(),deletedAt:new Date()}});
  assert.equal(resource(await workspaceQuotaUsage(f.workspace.id),'storedBytes').used,'10');
  await limited(writeWorkspaceObject(f.actor,f.workspace.id,dashboardStorageKey(f.workspace.id,dataset.id,'too-large'),Buffer.alloc(11)),'storedBytes');await assert.rejects(readDashboardObject(dashboardStorageKey(f.workspace.id,dataset.id,'too-large')));
 }finally{await f.cleanup();}
});
test('quota HTTP results are safe, tenant scoped and readable after subscription expiry',async()=>{
 const f=await fixture({datasets:0});try{
  const cookie=await issueDashboardBrowserSession(f.actor),base='https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id,headers={origin:'https://dashboard.test',cookie:'__Secure-averidi-dashboard='+cookie,'Content-Type':'application/json'},context={params:Promise.resolve({workspaceId:f.workspace.id})};
  const response=await datasetPost(new Request(base+'/datasets',{method:'POST',headers,body:JSON.stringify({name:'Denied dataset'})}),context);assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'QUOTA_EXCEEDED',resource:'datasets'});
  await db.dashboardSubscription.update({where:{workspaceId:f.workspace.id},data:{currentPeriodEnd:new Date(0)}});
  assert.equal((await usageGet(new Request(base+'/usage',{headers}),context)).status,200);await assert.rejects(readWorkspaceQuotaUsage(f.outside,f.workspace.id),/FORBIDDEN/);
  const job=await db.dashboardJob.create({data:{workspaceId:f.workspace.id,kind:'DATASET_JOIN',status:'RUNNING',idempotencyKey:randomUUID(),payload:{},leaseToken:'lease',leaseExpiresAt:new Date(Date.now()+60000),attempts:1}});
  await finishDashboardJob(job.id,'lease',false,'QUOTA_EXCEEDED');assert.equal((await db.dashboardJob.findUniqueOrThrow({where:{id:job.id}})).status,'FAILED');
 }finally{await f.cleanup();}
});
