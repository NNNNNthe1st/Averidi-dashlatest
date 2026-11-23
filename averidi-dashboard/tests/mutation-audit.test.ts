import {NextRequest} from 'next/server';
import {proxy} from '../src/proxy';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {setAuditActor} from '../src/features/audit/context';
import {readMutationAudit,workspaceMutationAudit,accountMutationAudit} from '../src/features/audit/service';
import {updateAccount} from '../src/features/account/service';
import {createActorWorkspace,renameWorkspace} from '../src/features/workspaces/service';
import {issueDashboardBrowserSession,rotateDashboardBrowserSession} from '../src/server/browser-session';
import {governedWorkspace} from './fixtures/governed-workspace';
import {GET as workspaceGet} from '../src/app/api/workspaces/[workspaceId]/activity/route';
import {GET as adminGet} from '../src/app/api/admin/v1/mutations/route';
after(()=>db.$disconnect());
test('every persistent Dashboard resource has an atomic evidence trigger, excluding only anonymous operational/liveness/rate counters and the journal',async()=>{
 const rows=await db.$queryRaw<{tablename:string}[]>`SELECT t.relname tablename FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE g.tgname='dashboard_mutation_evidence' AND n.nspname=current_schema()`;
 const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'Dashboard%'`;
 assert.deepEqual(rows.map(r=>r.tablename).sort(),tables.map(t=>t.tablename).filter(t=>!['DashboardMutationAudit','DashboardWorkerHeartbeat','DashboardRequestBucket','DashboardObservationBucket'].includes(t)).sort());
});
test('committed mutations retain only metadata, rollback evidence atomically and reject historical edits',async()=>{
 const f=await governedWorkspace();try{
  const secret='private-profile-'+randomUUID();await updateAccount(f.actor,{action:'PROFILE',displayName:secret,expectedDisplayName:null});
  const event=await db.dashboardMutationAudit.findFirstOrThrow({where:{resourceType:'DashboardUser',resourceId:f.actor.userId,operation:'UPDATE'},orderBy:{createdAt:'desc'}});assert.equal(event.actorSubject,f.actor.subject);assert.equal(event.actorSource,'APPLICATION');assert.ok(event.changedFields.includes('displayName'));assert.ok(!JSON.stringify(event).includes(secret));
  const id=randomUUID();await assert.rejects(db.$transaction(async tx=>{await setAuditActor(tx,f.actor);await tx.dashboardTeam.create({data:{id,workspaceId:f.workspace.id,name:'Must roll back'}});throw Error('ROLLBACK');}),/ROLLBACK/);assert.equal(await db.dashboardMutationAudit.count({where:{resourceId:id}}),0);
  await assert.rejects(db.dashboardMutationAudit.update({where:{id:event.id},data:{operation:'DELETE'}}),/AUDIT_APPEND_ONLY/);await assert.rejects(db.dashboardMutationAudit.delete({where:{id:event.id}}),/AUDIT_APPEND_ONLY/);
  const raw=await db.dashboardTeam.create({data:{workspaceId:f.workspace.id,name:'Background write'}});const background=await db.dashboardMutationAudit.findFirstOrThrow({where:{resourceId:raw.id}});assert.equal(background.actorSource,'DATABASE_ROLE');assert.equal(background.actorUserId,null);
 }finally{await f.cleanup();}
});
test('resource changes, existing domain events and worker output can be correlated without copying values',async()=>{
 const f=await governedWorkspace();try{
  const transactions=await db.dashboardMutationAudit.findMany({where:{workspaceId:f.workspace.id,actorSource:'WORKER'}});assert.ok(transactions.length);assert.ok(transactions.some(e=>e.actorSubject.length>10));
  await db.$transaction(async tx=>{await setAuditActor(tx,f.actor);const team=await tx.dashboardTeam.create({data:{workspaceId:f.workspace.id,name:'Do not copy this title'}});await tx.dashboardAuditEvent.create({data:{workspaceId:f.workspace.id,actorIssuer:f.actor.issuer,actorSubject:f.actor.subject,action:'TEAM_CREATED',resourceType:'TEAM',resourceId:team.id,details:{secret:'NEVER-JOURNAL-THIS'}}});});
  const event=await db.dashboardMutationAudit.findFirstOrThrow({where:{workspaceId:f.workspace.id,action:'TEAM_CREATED'}});const group=await db.dashboardMutationAudit.findMany({where:{transactionId:event.transactionId}});assert.ok(group.some(e=>e.resourceType==='DashboardTeam'));assert.ok(group.some(e=>e.actorSource==='DOMAIN_EVENT'));assert.ok(!JSON.stringify(group).includes('NEVER-JOURNAL-THIS'));assert.ok(!JSON.stringify(group).includes('Do not copy this title'));
  const background=await db.$transaction(async tx=>{await setAuditActor(tx,f.actor);return tx.dashboardAuditEvent.create({data:{workspaceId:f.workspace.id,actorIssuer:'verified-provider',actorSubject:'provider-operation',action:'PROVIDER_RECONCILED',resourceType:'BILLING',resourceId:'synthetic'}});});const evidence=await db.dashboardMutationAudit.findFirstOrThrow({where:{resourceId:background.id}});assert.equal(evidence.actorSubject,'provider-operation');assert.equal(evidence.actorUserId,null);
 }finally{await f.cleanup();}
});
test('account and Owner histories are scoped, paginated and reject foreign cursors and untrusted filters',async()=>{
 const f=await governedWorkspace();try{
  await renameWorkspace(f.actor,f.workspace.id,{name:'Audited rename'});await updateAccount(f.actor,{action:'PROFILE',displayName:'Account history',expectedDisplayName:null});
  const request=new Request('https://dashboard.test/activity?limit=2'),first=await workspaceMutationAudit(f.actor,f.workspace.id,request);assert.equal(first.items.length,2);assert.ok(first.nextCursor);const next=await workspaceMutationAudit(f.actor,f.workspace.id,new Request('https://dashboard.test/activity?limit=2&cursor='+first.nextCursor));assert.ok(next.items.every(e=>!first.items.some(old=>old.id===e.id)));
  await assert.rejects(workspaceMutationAudit(f.reader,f.workspace.id,request),/FORBIDDEN/);await assert.rejects(workspaceMutationAudit(f.actor,'foreign-workspace',request),/FORBIDDEN/);
  const own=await accountMutationAudit(f.actor,new Request('https://dashboard.test/activity'));assert.ok(own.items.some(e=>e.resourceType==='DashboardUser'));assert.ok(own.items.every(e=>!e.workspaceId&&!e.organizationId));
  const foreign=await db.dashboardMutationAudit.findFirstOrThrow({where:{workspaceId:f.foreign.id}});await assert.rejects(workspaceMutationAudit(f.actor,f.workspace.id,new Request('https://dashboard.test/activity?cursor='+foreign.id)),/INVALID_QUERY/);
  for(const query of ['limit=101','operation=EXECUTE','workspaceId=other','limit=1&limit=2'])await assert.rejects(readMutationAudit(new Request('https://dashboard.test/activity?'+query)),/INVALID_QUERY/);
 }finally{await f.cleanup();}
});
test('session creation/rotation and deletion preserve scoped evidence without leaking browser tokens',async()=>{
 const f=await governedWorkspace();try{
  const token=await issueDashboardBrowserSession(f.actor),replacement=await rotateDashboardBrowserSession(token);assert.ok(replacement);const events=await db.dashboardMutationAudit.findMany({where:{userId:f.actor.userId,resourceType:'DashboardSession'}});assert.ok(events.some(e=>e.operation==='INSERT'&&e.actorSubject===f.actor.subject));assert.ok(!JSON.stringify(events).includes(token));
  const cookie='__Secure-averidi-dashboard='+replacement,context={params:Promise.resolve({workspaceId:f.workspace.id})};assert.equal((await workspaceGet(new Request('https://dashboard.test/activity',{headers:{cookie}}),context)).status,200);assert.equal((await adminGet(new Request('https://dashboard.test/admin'))).status,403);
  const created=await createActorWorkspace(f.actor,{name:'Deleted scope evidence'});assert.ok(created.ok);if(created.ok){await db.dashboardWorkspace.delete({where:{id:created.workspace.id}});assert.ok(await db.dashboardMutationAudit.count({where:{workspaceId:created.workspace.id,operation:'DELETE'}}));}
 }finally{await f.cleanup();}
});

test('account activity follows release OFF and exact BETA routes without releasing other workspaces',async()=>{
 const mode=process.env.DASHBOARD_RELEASE_MODE,ids=process.env.DASHBOARD_BETA_WORKSPACE_IDS;
 try{
  process.env.DASHBOARD_RELEASE_MODE='BETA';process.env.DASHBOARD_BETA_WORKSPACE_IDS='allowed-workspace';
  for(const path of ['/activity','/api/account/activity'])assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app'+path))).headers.get('x-middleware-next'),'1');
  assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/api/account/activity',{method:'POST'}))).status,403);
  assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/api/workspaces/unlisted/activity'))).status,403);
  process.env.DASHBOARD_RELEASE_MODE='OFF';
  for(const path of ['/activity','/api/account/activity'])assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app'+path))).status,503);
 }finally{if(mode===undefined)delete process.env.DASHBOARD_RELEASE_MODE;else process.env.DASHBOARD_RELEASE_MODE=mode;if(ids===undefined)delete process.env.DASHBOARD_BETA_WORKSPACE_IDS;else process.env.DASHBOARD_BETA_WORKSPACE_IDS=ids;}
});
