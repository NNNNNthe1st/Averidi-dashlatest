import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {dashboardDb as db} from '../src/server/db';
import {configurationChangeSchema,admissionSettingKeys} from '../src/contracts/configuration';
import {dashboardConfiguration,updateDashboardConfiguration,assertDashboardAdmission} from '../src/features/administration/configuration';
import {createActorWorkspace} from '../src/features/workspaces/service';
import {createWorkspaceInvitation,acceptWorkspaceInvitation,revokeWorkspaceInvitation} from '../src/features/workspaces/invitations';
import {createOrganization,mutateOrganization,acceptOrganizationInvitation} from '../src/features/organizations/service';
import {mutateSharing} from '../src/features/sharing/service';
import {scheduleDashboardJob} from '../src/worker/queue';
import {governedWorkspace} from './fixtures/governed-workspace';
import {GET,PUT} from '../src/app/api/admin/v1/configuration/route';
after(()=>db.$disconnect());
const admin={issuer:'configuration-fixture',subject:'operator'},reason='Reviewed independent customer admission policy.';
async function set(key:typeof admissionSettingKeys[number],value:boolean){const previous=await db.dashboardConfiguration.findUnique({where:{key}});return updateDashboardConfiguration({key,value,reason,expectedUpdatedAt:previous?.updatedAt.toISOString()??null},admin);}
async function clear(){await db.dashboardConfiguration.deleteMany({where:{key:{in:[...admissionSettingKeys]}}});}
test('protected configuration is discoverable, bounded, strictly typed and rejects stale edits',async()=>{
 await clear();try{
  const before=await dashboardConfiguration();assert.equal(before.catalog.length,8);assert.ok(before.catalog.every(c=>c.updatedAt===null||c.updatedAt));
  for(const key of ['DASHBOARD_RELEASE_MODE','DASHBOARD_SESSION_SECRET','DASHBOARD_CUSTOM_API_ORIGINS','DATABASE_URL'])assert.equal(configurationChangeSchema.safeParse({key,value:true,reason,expectedUpdatedAt:null}).success,false);
  assert.equal(configurationChangeSchema.safeParse({key:'WORKSPACE_CREATION_ENABLED',value:false,reason}).success,false);
  assert.equal(configurationChangeSchema.safeParse({key:'WORKSPACE_CREATION_ENABLED',value:'false',reason,expectedUpdatedAt:null}).success,false);
  const command={key:'WORKSPACE_CREATION_ENABLED',value:false,reason,expectedUpdatedAt:null},race=await Promise.allSettled([updateDashboardConfiguration(command,admin),updateDashboardConfiguration(command,admin)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(updateDashboardConfiguration(command,admin),/CONFIGURATION_CONFLICT/);
  const previous=await db.dashboardConfiguration.findUniqueOrThrow({where:{key:command.key}});const changed=await set('WORKSPACE_CREATION_ENABLED',true);assert.ok(changed.updatedAt>previous.updatedAt);
  const audit=await db.dashboardAdminAudit.findFirstOrThrow({where:{actorSubject:admin.subject,action:'ADMIN_CONFIGURATION'},orderBy:{createdAt:'desc'}});const details=JSON.parse(audit.details!);assert.equal(details.previous,false);assert.equal(details.next,true);assert.equal(details.previousRevision,previous.updatedAt.toISOString());assert.equal(details.revision,changed.updatedAt.toISOString());
 }finally{await clear();}
});
test('configuration gates actual workspace, organization, invite, link and schedule admission without blocking removal',async()=>{
 await clear();const f=await governedWorkspace();let organizationId:string|undefined;try{
  await set('WORKSPACE_CREATION_ENABLED',false);await assert.rejects(createActorWorkspace(f.actor,{name:'Blocked workspace'}),/CONFIGURATION_ACTION_DISABLED/);
  await set('ORGANIZATION_CREATION_ENABLED',false);await assert.rejects(createOrganization(f.actor,{name:'Blocked organization'}),/CONFIGURATION_ACTION_DISABLED/);await set('ORGANIZATION_CREATION_ENABLED',true);const organization=await createOrganization(f.actor,{name:'Existing organization'});organizationId=organization.id;
  const invitation=await createWorkspaceInvitation(f.actor,f.workspace.id,'VIEWER');assert.equal(invitation.ok,true);if(!invitation.ok)return;
  await set('WORKSPACE_INVITATIONS_ENABLED',false);await assert.rejects(createWorkspaceInvitation(f.actor,f.workspace.id,'VIEWER'),/CONFIGURATION_ACTION_DISABLED/);await assert.rejects(acceptWorkspaceInvitation(f.reader,invitation.token),/CONFIGURATION_ACTION_DISABLED/);assert.equal((await revokeWorkspaceInvitation(f.actor,f.workspace.id,invitation.invitation.id)).ok,true);
  await set('ORGANIZATION_INVITATIONS_ENABLED',false);await assert.rejects(mutateOrganization(f.actor,organization.id,{action:'INVITE'}),/CONFIGURATION_ACTION_DISABLED/);await assert.rejects(acceptOrganizationInvitation(f.reader,{token:'a'.repeat(43)}),/CONFIGURATION_ACTION_DISABLED/);
  await set('SCHEDULE_CREATION_ENABLED',false);await assert.rejects(scheduleDashboardJob(f.workspace.id,'SOURCE_REFRESH',{sourceId:'missing',datasetId:f.dataset.id},3600,new Date()),/CONFIGURATION_ACTION_DISABLED/);
  await set('SHARE_LINK_CREATION_ENABLED',false);const view=await db.dashboardView.findUniqueOrThrow({where:{id:f.viewId}});await assert.rejects(mutateSharing(f.actor,f.workspace.id,f.viewId,{action:'LINK',expiresAt:new Date(Date.now()+60000).toISOString(),expectedUpdatedAt:view.updatedAt.toISOString()}),/CONFIGURATION_ACTION_DISABLED/);
 }finally{await clear();if(organizationId)await db.dashboardOrganization.delete({where:{id:organizationId}});await f.cleanup();}
});
test('configuration edits serialize with admitted effects and malformed stored admission values fail closed',async()=>{
 await clear();try{
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);
  const admission=db.$transaction(async tx=>{await assertDashboardAdmission(tx,'WORKSPACE_CREATION_ENABLED');entered();await hold;},{timeout:10000});await ready;
  let completed=false;const edit=set('WORKSPACE_CREATION_ENABLED',false).then(()=>{completed=true});await new Promise(r=>setTimeout(r,50));assert.equal(completed,false);release();await admission;await edit;
  await assert.rejects(db.$transaction(tx=>assertDashboardAdmission(tx,'WORKSPACE_CREATION_ENABLED')),/CONFIGURATION_ACTION_DISABLED/);
  await db.dashboardConfiguration.update({where:{key:'WORKSPACE_CREATION_ENABLED'},data:{value:'invalid'}});await assert.rejects(db.$transaction(tx=>assertDashboardAdmission(tx,'WORKSPACE_CREATION_ENABLED')),/CONFIGURATION_ACTION_DISABLED/);
 }finally{await clear();}
});
test('configuration API requires verified administrative JWT, separates read/manage and rejects foreign origins',async()=>{
 const env={...process.env};await clear();const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'configuration-fixture',alg:'RS256'};
 const server=https.createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const issuer='https://127.0.0.1:'+(server.address() as {port:number}).port;
 Object.assign(process.env,{DASHBOARD_ADMIN_OIDC_ISSUER:issuer,DASHBOARD_ADMIN_OIDC_JWKS_URL:issuer+'/jwks',DASHBOARD_ADMIN_OIDC_AUDIENCE:'configuration-fixture',DASHBOARD_ADMIN_BRIDGE_ENABLED:'false'});
 async function token(permission:string){return new SignJWT({token_use:'access',dashboard_permissions:[permission]}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('configuration-fixture').setSubject('operator').setIssuedAt().setExpirationTime('5m').sign(privateKey);}
 try{
  const read=await token('dashboard:read'),manage=await token('dashboard:manage'),body={key:'SCHEDULE_CREATION_ENABLED',value:false,reason,expectedUpdatedAt:null},url='https://dashboard.test/dashboard/app/api/admin/v1/configuration';
  const request=(jwt:string,origin='https://dashboard.test',value:unknown=body)=>new Request(url,{method:'PUT',headers:{authorization:'Bearer '+jwt,origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
  assert.equal((await GET(new Request(url))).status,403);assert.equal((await GET(new Request(url,{headers:{authorization:'Bearer '+read}}))).status,200);assert.equal((await PUT(request(read))).status,403);assert.equal((await PUT(request(manage,'https://evil.test'))).status,403);assert.equal((await PUT(request(manage))).status,200);assert.equal((await PUT(request(manage))).status,409);
  const response=await GET(new Request(url,{headers:{authorization:'Bearer '+read}}));assert.equal((await response.json()).catalog.find((c:{key:string})=>c.key==='SCHEDULE_CREATION_ENABLED').value,false);
 }finally{await clear();await new Promise<void>(r=>server.close(()=>r()));for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
