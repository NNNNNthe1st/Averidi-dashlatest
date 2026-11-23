import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {dashboardDb as db} from '../src/server/db';
import {createEcosystemApi} from '../src/features/ecosystem/api';
import {createEcosystemTokenVerifier} from '../src/features/ecosystem/identity';
import {createDashboardContractClient,IntegrationClientError} from '../src/features/ecosystem/client';
import {readIntegrationSubscription,readIntegrationNavigation} from '../src/features/ecosystem/service';
import {createDashboardAdminBridgeVerifier} from '../src/server/admin-bridge';
import {signDashboardEvent,createDashboardEventVerifier,consumeDashboardEvent} from '../src/features/ecosystem/events';
import {workspaceDashboardEntitlement} from '../src/features/subscriptions/entitlements';
import type {EcosystemClaims} from '../src/contracts/integration';

test('future contracts conform over verified HTTPS without connecting any Averidi application',async t=>{
 const key=await generateKeyPair('RS256'),jwk={...await exportJWK(key.publicKey),kid:'ecosystem-fixture',alg:'RS256'},tag=randomUUID();
 let issuer='',active=true,mode='valid',requests=0,credentialHeaders=false;
 let api:ReturnType<typeof createEcosystemApi>;
 const server=createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},async(req,res)=>{
  try{
   if(req.url==='/jwks'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));return;}
   requests++;credentialHeaders ||= !!req.headers.cookie;
   if(mode==='outage'){res.writeHead(503,{'retry-after':'2'});res.end('{}');return;}
   const match=/^\/dashboard\/app\/api\/integrations\/v1\/workspaces\/([^/]+)\/(subscription|navigation)$/.exec(req.url??'');if(!match){res.writeHead(404);res.end();return;}
   const response=await api(new Request(issuer+req.url,{method:req.method,headers:req.headers as Record<string,string>}),match[1],match[2] as 'subscription'|'navigation');
   if(mode==='oversize'){res.writeHead(200,{'content-type':'application/json','x-dashboard-contract-version':'1.0'});res.end(' '.repeat(65537));return;}
   const body=await response.json();if(mode==='foreign-workspace')body.workspaceId='foreign_workspace';
   res.writeHead(response.status,{...Object.fromEntries(response.headers),...(mode==='wrong-version'?{'x-dashboard-contract-version':'2.0'}:{})});res.end(JSON.stringify(body));
  }catch{res.writeHead(503);res.end('{}');}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));issuer=`https://127.0.0.1:${(server.address() as {port:number}).port}`;
 const config={issuer,audience:'dashboard-ecosystem-fixture',jwksUrl:issuer+'/jwks'},verify=createEcosystemTokenVerifier(config);
 api=createEcosystemApi({active:()=>active,verify,released:()=>true,subscription:readIntegrationSubscription,navigation:readIntegrationNavigation});
 const workspace=await db.dashboardWorkspace.create({data:{name:'Ecosystem contract fixture'}}),other=await db.dashboardWorkspace.create({data:{name:'Separate customer fixture'}}),user=await db.dashboardUser.create({data:{externalSubject:issuer+'|'+tag}});
 const actor={userId:user.id,issuer,subject:tag};
 await db.dashboardMembership.create({data:{workspaceId:workspace.id,userId:user.id,role:'OWNER'}});
 await db.dashboardSubscription.create({data:{workspaceId:workspace.id,planCode:'DASHBOARD_FIXTURE',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}});
 const now=Math.floor(Date.now()/1000);
 const claims:EcosystemClaims={iss:issuer,sub:tag,aud:config.audience,iat:now,exp:now+300,jti:randomUUID(),token_use:'access',integration:'averidi-dashboard-ecosystem-v1',dashboard_permissions:['dashboard:subscription:read','dashboard:navigation:read'],workspace_ids:[workspace.id]};
 const signed=(value:Record<string,unknown>,privateKey=key.privateKey)=>new SignJWT(value).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(privateKey);
 let access=await signed(claims);
 const client=createDashboardContractClient({origin:issuer,token:async()=>access,active:()=>true});
 try{
  await t.test('scoped customer identity resolves current Dashboard membership and owned entitlements',async()=>{
   const response=await client.subscription(workspace.id);assert.equal(response.subscription.active,true);assert.equal(response.workspaceId,workspace.id);assert.equal((response as any).externalCustomerId,undefined);
   const navigation=await client.navigation(workspace.id);assert.equal(navigation.links.studio,`/dashboard/app/workspaces/${workspace.id}/studio`);assert.ok(navigation.links.members);assert.equal(credentialHeaders,false);
   await db.dashboardMembership.update({where:{userId_workspaceId:{userId:user.id,workspaceId:workspace.id}},data:{role:'VIEWER'}});assert.equal((await client.navigation(workspace.id)).links.members,undefined);
   await db.dashboardSubscription.update({where:{workspaceId:workspace.id},data:{currentPeriodEnd:new Date(0)}});assert.equal((await client.subscription(workspace.id)).subscription.active,false);
   await db.dashboardSubscription.update({where:{workspaceId:workspace.id},data:{currentPeriodEnd:new Date(Date.now()+86400000)}});
  });
  await t.test('issuer, audience, purpose, lifetime, signature and explicit scope fail closed',async()=>{
   const noExpiry:any={...claims};delete noExpiry.exp;
   const bad=[{...claims,iss:issuer+'/wrong'},{...claims,aud:'website-audience'},{...claims,token_use:'id'},{...claims,integration:'averidi-dashboard-admin-v1'},{...claims,exp:now-60,iat:now-300},{...claims,exp:now+3600},noExpiry,{...claims,dashboard_permissions:['dashboard:manage']},{...claims,sub:'unknown-customer'}];
   for(const value of bad){access=await signed(value);await assert.rejects(client.subscription(workspace.id),e=>e instanceof IntegrationClientError&&['UNAUTHORIZED','FORBIDDEN'].includes(e.code));}
   const foreign=await generateKeyPair('RS256');access=await signed(claims,foreign.privateKey);await assert.rejects(client.subscription(workspace.id),/UNAUTHORIZED/);
   access=await signed({...claims,dashboard_permissions:['dashboard:navigation:read']});await assert.rejects(client.subscription(workspace.id),/FORBIDDEN/);access=await signed(claims);
  });
  await t.test('a signed allowlist cannot replace live membership or create customers',async()=>{
   const before=await db.dashboardUser.count();access=await signed({...claims,workspace_ids:[other.id]});await assert.rejects(client.subscription(other.id),/FORBIDDEN/);
   access=await signed(claims);await assert.rejects(client.subscription(other.id),/FORBIDDEN/);
   await db.dashboardMembership.delete({where:{userId_workspaceId:{userId:user.id,workspaceId:workspace.id}}});await assert.rejects(client.subscription(workspace.id),/FORBIDDEN/);assert.equal(await db.dashboardUser.count(),before);
   await db.dashboardMembership.create({data:{workspaceId:workspace.id,userId:user.id,role:'OWNER'}});
  });
  await t.test('client rejects response drift, wrong tenants, oversize bodies and unsafe resource paths',async()=>{
   for(mode of ['foreign-workspace','wrong-version','oversize'])await assert.rejects(client.subscription(workspace.id),/INVALID_CONTRACT_RESPONSE/);mode='valid';
   const count=requests;for(const id of ['../other','x/y','%2e%2e','?admin=true'])await assert.rejects(client.subscription(id),/INVALID_CONTRACT_REQUEST/);assert.equal(requests,count);
   const invalid=createDashboardContractClient({origin:'https://customer:secret@127.0.0.1',token:async()=>access,active:()=>true});await assert.rejects(invalid.subscription(workspace.id),/INVALID_CONTRACT_ORIGIN/);
  });
  await t.test('outage has bounded retry guidance and cannot change local subscriptions',async()=>{
   mode='outage';const count=requests;await assert.rejects(client.subscription(workspace.id),e=>e instanceof IntegrationClientError&&e.code==='INTEGRATION_UNAVAILABLE'&&e.retryAfterSeconds===2);assert.equal(requests,count+1);assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,true);mode='valid';
   active=false;await assert.rejects(client.subscription(workspace.id),/INTEGRATION_UNAVAILABLE/);active=true;
  });
  await t.test('administrative bridge grants are separate, strictly signed and short lived',async()=>{
   const bridge=createDashboardAdminBridgeVerifier({...config,audience:'dashboard-admin-bridge-fixture'});
   const base={iss:issuer,sub:'admin-fixture',aud:'dashboard-admin-bridge-fixture',iat:now,exp:now+300,jti:randomUUID(),token_use:'access',integration:'averidi-dashboard-admin-v1',dashboard_permissions:['dashboard:read']};
   assert.equal((await bridge(await signed(base),'dashboard:read'))?.subject,'admin-fixture');assert.equal(await bridge(await signed(base),'dashboard:manage'),null);
   assert.ok(await bridge(await signed({...base,dashboard_permissions:['dashboard:manage']}),'dashboard:manage'));
   for(const value of [{...base,exp:now+3600},{...base,exp:undefined},{...base,aud:[base.aud,'website']},{...base,token_use:'id'},{...base,jti:'short'},{...base,dashboard_permissions:['OWNER']},{...base,integration:claims.integration}])assert.equal(await bridge(await signed(value),'dashboard:read'),null);
   assert.equal(await verify(new Request(issuer,{headers:{authorization:'Bearer '+await signed(base)}})),null);
  });
  await t.test('signed event identity, audience and workspace bindings are validated before receiver effects',async()=>{
   const verifier=createDashboardEventVerifier({...config,audience:'future-receiver-fixture'}),event={contractVersion:'1.0',product:'averidi-dashboard',eventId:randomUUID(),workspaceId:workspace.id,occurredAt:new Date().toISOString(),type:'dashboard.workspace.changed.v1',data:{name:'Renamed fixture'}};
   const token=await signDashboardEvent(event,key.privateKey,jwk.kid,issuer,'future-receiver-fixture');assert.deepEqual(await verifier(token),event);
   let effects=0;const receipts=new Map<string,string>();const receiver={accept:async(value:any,digest:string)=>{const old=receipts.get(value.eventId);if(old)return old===digest?'DUPLICATE' as const:'CONFLICT' as const;receipts.set(value.eventId,digest);effects++;return 'APPLIED' as const;}};
   const outcomes=await Promise.all([consumeDashboardEvent(token,verifier,receiver),consumeDashboardEvent(token,verifier,receiver)]);assert.equal(effects,1);assert.equal(outcomes.filter(x=>x.outcome==='DUPLICATE').length,1);
   const conflict=await signDashboardEvent({...event,data:{name:'Different payload'}},key.privateKey,jwk.kid,issuer,'future-receiver-fixture');await assert.rejects(consumeDashboardEvent(conflict,verifier,receiver),/EVENT_IDEMPOTENCY_CONFLICT/);
   const wrong=await signDashboardEvent(event,key.privateKey,jwk.kid,issuer,'another-product');await assert.rejects(consumeDashboardEvent(wrong,verifier,receiver),/INVALID_EVENT/);assert.equal(effects,1);
   const misbound=await signed({iss:issuer,sub:'workspace:'+other.id,aud:'future-receiver-fixture',iat:now,exp:now+300,jti:event.eventId,integration:'averidi-dashboard-events-v1',event});await assert.rejects(verifier(misbound),/INVALID_EVENT/);
  });
  await t.test('unreleased resources and internal exceptions return safe versioned failures',async()=>{
   const released=createEcosystemApi({active:()=>true,verify:async()=>claims,released:()=>false,subscription:readIntegrationSubscription,navigation:readIntegrationNavigation});const response=await released(new Request(issuer),workspace.id,'subscription');assert.equal(response.status,503);assert.equal((await response.json()).error,'DASHBOARD_NOT_RELEASED');
   const broken=createEcosystemApi({active:()=>true,verify:async()=>claims,released:()=>true,subscription:async()=>{throw Error('private database connection string');},navigation:readIntegrationNavigation});const failure=await broken(new Request(issuer),workspace.id,'subscription');assert.equal(failure.status,503);assert.equal((await failure.text()).includes('private database'),false);
  });
 }finally{await db.dashboardWorkspace.deleteMany({where:{id:{in:[workspace.id,other.id]}}});await db.dashboardUser.delete({where:{id:user.id}});await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.$disconnect();}
});
