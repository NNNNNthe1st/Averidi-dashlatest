import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {dashboardDb as db} from '../src/server/db';
import {createOrganization,listOrganizations,readOrganization,mutateOrganization,acceptOrganizationInvitation} from '../src/features/organizations/service';
import {listTeams,mutateTeam} from '../src/features/teams/service';
import {onboardingProgress} from '../src/features/onboarding/progress';
import {requireWorkspaceRole} from '../src/server/workspace-access';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {POST as createOrganizationRoute} from '../src/app/api/organizations/route';
import {POST as mutateTeamRoute} from '../src/app/api/workspaces/[workspaceId]/teams/route';
import {proxy} from '../src/proxy';
import {verificationDatabases} from '../scripts/verification/contracts.mjs';
after(()=>db.$disconnect());
async function fixture(){
 verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
 const users=await Promise.all(['owner','member','outside'].map(async name=>{const subject=randomUUID(),user=await db.dashboardUser.create({data:{externalSubject:'accounts|'+subject}});return {userId:user.id,issuer:'accounts',subject,name};}));
 const [owner,member,outside]=users,workspace=await db.dashboardWorkspace.create({data:{name:'Collaboration fixture',memberships:{create:[{userId:owner.userId,role:'OWNER'},{userId:member.userId,role:'VIEWER'}]}}});
 const organization=await createOrganization(owner,{name:'Example organization'});
 const previous=process.env.DASHBOARD_RELEASE_MODE;process.env.DASHBOARD_RELEASE_MODE='GENERAL';
 return {owner,member,outside,workspace,organization,async cleanup(){await db.dashboardWorkspace.deleteMany({where:{id:workspace.id}});await db.dashboardOrganization.deleteMany({where:{id:organization.id}});await db.dashboardUser.deleteMany({where:{id:{in:users.map(u=>u.userId)}}});if(previous===undefined)delete process.env.DASHBOARD_RELEASE_MODE;else process.env.DASHBOARD_RELEASE_MODE=previous;}};
}
test('guided onboarding follows current saved source and governed analysis, invalidating stale dashboards',()=>{
 const dataset={id:'data',status:'READY',latestVersionId:'v2',confirmedMappings:[{sourceField:'sales',canonicalConcept:'REVENUE'}],metricRules:{grain:'RECORD'}},analysis={datasetId:'data',versionId:'v2',id:'a2',status:'READY',qualityPass:true,readyMetrics:true};
 assert.equal(onboardingProgress(undefined,null,[]).filter(s=>s.done).length,1);
 assert.equal(onboardingProgress(dataset,analysis,[{datasetId:'data',analysisId:'a2'}]).filter(s=>s.done).length,6);
 assert.equal(onboardingProgress(dataset,analysis,[{datasetId:'data',analysisId:'a1'}])[5].done,false);
 assert.equal(onboardingProgress(dataset,{...analysis,versionId:'v1'},[{datasetId:'data',analysisId:'a2'}])[4].done,false);
 assert.equal(onboardingProgress(dataset,{...analysis,qualityPass:false},[])[4].done,false);
 assert.equal(onboardingProgress(dataset,{...analysis,readyMetrics:false},[])[4].done,false);
 assert.equal(onboardingProgress({...dataset,confirmedMappings:[]},analysis,[])[3].done,false);
});
test('organizations enforce ownership, immutable workspace access, revisions and last-owner protection',async()=>{
 const f=await fixture();try{
  assert.equal((await listOrganizations(f.owner))[0].organization.id,f.organization.id);
  assert.deepEqual(await listOrganizations(f.outside),[]);
  await assert.rejects(readOrganization(f.outside,f.organization.id),/FORBIDDEN/);
  await assert.rejects(mutateOrganization(f.owner,f.organization.id,{action:'MEMBER',userId:f.owner.userId,role:'REMOVE'}),/LAST_OWNER/);
  await assert.rejects(mutateOrganization(f.owner,f.organization.id,{action:'RENAME',name:'Renamed',expectedUpdatedAt:'2000-01-01T00:00:00.000Z'}),/VERSION_CONFLICT/);
  await mutateOrganization(f.owner,f.organization.id,{action:'RENAME',name:'Renamed',expectedUpdatedAt:f.organization.updatedAt.toISOString()});
  await mutateOrganization(f.owner,f.organization.id,{action:'WORKSPACE',workspaceId:f.workspace.id,linked:true});
  const invited=await mutateOrganization(f.owner,f.organization.id,{action:'INVITE'});assert.ok('token' in invited);
  await acceptOrganizationInvitation(f.outside,{token:invited.token});
  assert.equal((await readOrganization(f.outside,f.organization.id)).workspaces.length,0);
  assert.equal(await requireWorkspaceRole(f.outside,f.workspace.id,'VIEWER'),null);
  await assert.rejects(mutateOrganization(f.outside,f.organization.id,{action:'MEMBER',userId:f.outside.userId,role:'OWNER'}),/FORBIDDEN/);
  await assert.rejects(mutateOrganization(f.owner,f.organization.id,{action:'DELETE',expectedUpdatedAt:(await readOrganization(f.owner,f.organization.id)).organization.updatedAt.toISOString()}),/ORGANIZATION_IN_USE/);
  process.env.DASHBOARD_RELEASE_MODE='BETA';process.env.DASHBOARD_BETA_WORKSPACE_IDS='another-workspace';
  assert.equal((await readOrganization(f.owner,f.organization.id)).workspaces.length,0);
  await assert.rejects(mutateOrganization(f.owner,f.organization.id,{action:'WORKSPACE',workspaceId:f.workspace.id,linked:false}),/FORBIDDEN/);
  process.env.DASHBOARD_RELEASE_MODE='GENERAL';delete process.env.DASHBOARD_BETA_WORKSPACE_IDS;
  await mutateOrganization(f.owner,f.organization.id,{action:'WORKSPACE',workspaceId:f.workspace.id,linked:false});
  const read=await readOrganization(f.owner,f.organization.id);assert.ok(read.events.some(e=>e.action==='ORGANIZATION_WORKSPACE'));
  await mutateOrganization(f.owner,f.organization.id,{action:'DELETE',expectedUpdatedAt:read.organization.updatedAt.toISOString()});
 }finally{delete process.env.DASHBOARD_BETA_WORKSPACE_IDS;await f.cleanup();}
});
test('organization invitations are hashed, single-use under races, expiring, revocable and never downgrade owners',async()=>{
 const f=await fixture();try{
  const invite=await mutateOrganization(f.owner,f.organization.id,{action:'INVITE'});assert.ok(invite.token);assert.match(invite.token,/^[\w-]{43}$/);
  assert.ok(!(JSON.stringify(await readOrganization(f.owner,f.organization.id))).includes(invite.token));
  const outcomes=await Promise.allSettled([f.member,f.outside].map(actor=>acceptOrganizationInvitation(actor,{token:invite.token})));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await db.dashboardOrganizationMember.count({where:{organizationId:f.organization.id}}),2);
  const own=await mutateOrganization(f.owner,f.organization.id,{action:'INVITE'});assert.ok('token' in own);await acceptOrganizationInvitation(f.owner,{token:own.token});assert.equal((await readOrganization(f.owner,f.organization.id)).role,'OWNER');
  const revoked=await mutateOrganization(f.owner,f.organization.id,{action:'INVITE'});assert.ok('token' in revoked);const pending=(await readOrganization(f.owner,f.organization.id)).invitations.find(i=>!i.acceptedAt&&!i.revokedAt)!;
  await mutateOrganization(f.owner,f.organization.id,{action:'REVOKE',invitationId:pending.id});await assert.rejects(acceptOrganizationInvitation(f.member,{token:revoked.token}),/INVALID_INVITATION/);
  const expired=await mutateOrganization(f.owner,f.organization.id,{action:'INVITE'});assert.ok('token' in expired);await db.dashboardOrganizationInvitation.updateMany({where:{organizationId:f.organization.id,acceptedAt:null,revokedAt:null},data:{expiresAt:new Date(0)}});await assert.rejects(acceptOrganizationInvitation(f.member,{token:expired.token}),/INVALID_INVITATION/);
  const winner=outcomes[0].status==='fulfilled'?f.member:f.outside;
  await mutateOrganization(f.owner,f.organization.id,{action:'MEMBER',userId:winner.userId,role:'OWNER'});
  const results=await Promise.allSettled([f.owner,winner].map(actor=>mutateOrganization(actor,f.organization.id,{action:'MEMBER',userId:actor.userId,role:'MEMBER'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.dashboardOrganizationMember.count({where:{organizationId:f.organization.id,role:'OWNER'}}),1);
 }finally{await f.cleanup();}
});
test('teams preserve tenant and workspace roles, reject stale edits and cascade revoked memberships',async()=>{
 const f=await fixture();try{
  await assert.rejects(mutateTeam(f.member,f.workspace.id,{action:'CREATE',name:'Forbidden'}),/FORBIDDEN/);await assert.rejects(listTeams(f.outside,f.workspace.id),/FORBIDDEN/);
  await mutateTeam(f.owner,f.workspace.id,{action:'CREATE',name:'Operations'});
  let team=(await listTeams(f.member,f.workspace.id)).teams[0];
  await mutateTeam(f.owner,f.workspace.id,{action:'MEMBERS',id:team.id,userIds:[f.member.userId],expectedUpdatedAt:team.updatedAt.toISOString()});
  await assert.rejects(mutateTeam(f.owner,f.workspace.id,{action:'RENAME',id:team.id,name:'Stale',expectedUpdatedAt:team.updatedAt.toISOString()}),/VERSION_CONFLICT/);
  team=(await listTeams(f.owner,f.workspace.id)).teams[0];
  await assert.rejects(mutateTeam(f.owner,f.workspace.id,{action:'MEMBERS',id:team.id,userIds:[f.outside.userId],expectedUpdatedAt:team.updatedAt.toISOString()}),/INVALID_MEMBER/);
  await assert.rejects(db.dashboardTeamMember.create({data:{workspaceId:f.workspace.id,teamId:team.id,userId:f.outside.userId}}));
  await db.dashboardMembership.delete({where:{userId_workspaceId:{userId:f.member.userId,workspaceId:f.workspace.id}}});assert.equal(await db.dashboardTeamMember.count({where:{teamId:team.id}}),0);
  await mutateTeam(f.owner,f.workspace.id,{action:'RENAME',id:team.id,name:'Updated team',expectedUpdatedAt:team.updatedAt.toISOString()});team=(await listTeams(f.owner,f.workspace.id)).teams[0];
  await mutateTeam(f.owner,f.workspace.id,{action:'DELETE',id:team.id,expectedUpdatedAt:team.updatedAt.toISOString()});assert.equal((await listTeams(f.owner,f.workspace.id)).teams.length,0);
  assert.equal(await db.dashboardAuditEvent.count({where:{workspaceId:f.workspace.id,resourceType:'TEAM'}}),4);
 }finally{await f.cleanup();}
});
test('collaboration HTTP routes verify identity, reject CSRF and untrusted actor fields; release OFF remains closed',async()=>{
 const f=await fixture(),previous=process.env.DASHBOARD_SESSION_SECRET;process.env.DASHBOARD_SESSION_SECRET='accounts-test-session-secret-'.repeat(3);
 try{
  const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.owner);
  const request=(body:unknown,origin='https://dashboard.test',authenticated=true)=>new Request('https://dashboard.test/dashboard/app/api/organizations',{method:'POST',headers:{origin,...(authenticated?{cookie}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await createOrganizationRoute(request({name:'No session'},undefined,false))).status,401);
  assert.equal((await createOrganizationRoute(request({name:'CSRF'},'https://foreign.invalid'))).status,403);
  assert.equal((await createOrganizationRoute(request({name:'Spoof',actor:{userId:f.outside.userId}}))).status,400);
  assert.equal((await mutateTeamRoute(request({action:'CREATE',name:'API Team'}),{params:Promise.resolve({workspaceId:f.workspace.id})})).status,200);
  assert.equal((await mutateTeamRoute(request({action:'CREATE',name:'x'.repeat(17000)}),{params:Promise.resolve({workspaceId:f.workspace.id})})).status,400);
  for(const path of ['/organizations','/settings','/api/account','/api/organizations','/api/organization-invitations/accept']){process.env.DASHBOARD_RELEASE_MODE='OFF';assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app'+path))).status,503);process.env.DASHBOARD_RELEASE_MODE='BETA';assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app'+path))).status,200);}
 }finally{if(previous===undefined)delete process.env.DASHBOARD_SESSION_SECRET;else process.env.DASHBOARD_SESSION_SECRET=previous;await f.cleanup();}
});

test('account settings isolate profiles and sessions, reject stale updates and invalidate only the owned session',async()=>{
 const {readAccount,updateAccount}=await import('../src/features/account/service');
 const {verifyDashboardBrowserSession}=await import('../src/server/browser-session');
 const {POST,GET}=await import('../src/app/api/account/route');
 const {decodeJwt}=await import('jose');
 const f=await fixture(),previous=process.env.DASHBOARD_SESSION_SECRET;process.env.DASHBOARD_SESSION_SECRET='account-security-test-secret-'.repeat(3);
 try{
  const token=await issueDashboardBrowserSession(f.owner),other=await issueDashboardBrowserSession(f.member),jti=decodeJwt(token).jti!,otherId=decodeJwt(other).jti!;
  assert.equal((await readAccount(f.owner,jti)).sessions[0].current,true);
  await updateAccount(f.owner,{action:'PROFILE',displayName:'佐藤',expectedDisplayName:null});assert.equal((await readAccount(f.owner)).profile.displayName,'佐藤');assert.equal((await readAccount(f.member)).profile.displayName,null);
  await assert.rejects(updateAccount(f.owner,{action:'PROFILE',displayName:'Stale',expectedDisplayName:null}),/VERSION_CONFLICT/);
  await assert.rejects(updateAccount(f.owner,{action:'REVOKE_SESSION',id:otherId}),/NOT_FOUND/);assert.ok(await verifyDashboardBrowserSession(other));
  const request=(origin='https://dashboard.test')=>new Request('https://dashboard.test/dashboard/app/api/account',{method:'POST',headers:{origin,cookie:'__Secure-averidi-dashboard='+token,'Content-Type':'application/json'},body:JSON.stringify({action:'REVOKE_SESSION',id:jti})});
  assert.equal((await POST(request('https://foreign.invalid'))).status,403);
  const response=await POST(request());assert.equal(response.status,200);assert.equal((await response.json()).signedOut,true);assert.match(response.headers.get('set-cookie')??'',/Max-Age=0/);
  assert.equal(await verifyDashboardBrowserSession(token),null);assert.ok(await verifyDashboardBrowserSession(other));assert.equal((await GET(new Request('https://dashboard.test/dashboard/app/api/account',{headers:{cookie:'__Secure-averidi-dashboard='+token}}))).status,401);
 }finally{if(previous===undefined)delete process.env.DASHBOARD_SESSION_SECRET;else process.env.DASHBOARD_SESSION_SECRET=previous;await f.cleanup();}
});
