import {test,after} from 'node:test';
import {dashboardDb as rateLimitDb} from '../src/server/db';
after(()=>rateLimitDb.$disconnect());
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {EXTERNAL_AVERIDI_INTEGRATION_ENABLED,externalIdentitySchema,subscriptionSummarySchema,navigationSchema,dashboardEventSchema} from '../src/contracts/integration';
import {adminOperationCatalog} from '../src/contracts/administration';
import {dashboardContractArtifacts} from '../src/contracts/manifest';
import {createDashboardContractClient} from '../src/features/ecosystem/client';
import {createEcosystemApi} from '../src/features/ecosystem/api';
import {GET as discovery} from '../src/app/api/integrations/v1/contracts/route';
import {GET as productionSubscription} from '../src/app/api/integrations/v1/workspaces/[workspaceId]/subscription/route';
import {verifyDashboardAdminBridgeToken} from '../src/server/admin-bridge';
import {NextRequest} from 'next/server';
import {proxy} from '../src/proxy';

test('v1 identities and subscription summaries reject ambiguity and foreign billing authority',()=>{
 assert.equal(externalIdentitySchema.safeParse({issuer:'https://identity.test',subject:'stable-subject'}).success,true);
 for(const issuer of ['http://identity.test','https://user:pass@identity.test','https://identity.test/?token=secret'])assert.equal(externalIdentitySchema.safeParse({issuer,subject:'customer'}).success,false);
 assert.equal(externalIdentitySchema.safeParse({issuer:'https://identity.test',subject:'customer',email:'not-an-identity-key@test'}).success,false);
 const base={contractVersion:'1.0',product:'averidi-dashboard',workspaceId:'workspace_1',subscription:{active:true,planCode:'DASHBOARD_PRO',checkedAt:new Date().toISOString()},status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000).toISOString()};
 assert.equal(subscriptionSummarySchema.safeParse(base).success,true);
 for(const v of [{...base,product:'averidi-analyst'},{...base,currentPeriodEnd:null},{...base,status:'CANCELED'},{...base,externalCustomerId:'cus_foreign'},{...base,contractVersion:'2.0'}])assert.equal(subscriptionSummarySchema.safeParse(v).success,false);
});
test('navigation and events cannot escape or silently switch the authorized workspace',()=>{
 const nav={contractVersion:'1.0',product:'averidi-dashboard',workspaceId:'workspace_1',links:{workspaces:'/dashboard/app/workspaces',studio:'/dashboard/app/workspaces/workspace_1/studio',login:'/dashboard/app/api/auth/login'}};
 assert.equal(navigationSchema.safeParse(nav).success,true);
 for(const studio of ['https://evil.test','//evil.test','/dashboard/app/workspaces/workspace_2/studio','/dashboard/app/workspaces/../studio','/dashboard/app/api/auth/login'])assert.equal(navigationSchema.safeParse({...nav,links:{...nav.links,studio}}).success,false);
 assert.equal(dashboardEventSchema.safeParse({contractVersion:'1.0',product:'averidi-dashboard',eventId:crypto.randomUUID(),workspaceId:'workspace_1',occurredAt:new Date().toISOString(),type:'dashboard.workspace.changed.v1',data:{name:'Workspace',token:'secret'}}).success,false);
});
test('published OpenAPI and JSON Schema artifacts match runtime validators',async()=>{
 const artifacts=dashboardContractArtifacts();
 for(const name of ['openapi','schemas'] as const)assert.deepEqual(JSON.parse(await readFile(`contracts/v1/${name}.json`,'utf8')),artifacts[name]);
 const response=discovery(),body=await response.json();assert.equal(body.enabled,false);assert.equal(body.contractVersion,'1.0');assert.equal(body.openapi.openapi,'3.1.0');assert.match(response.headers.get('cache-control')!,/no-store/);
 // Every local OpenAPI reference resolves, including generated request-body schemas.
 function refs(value:unknown){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='$ref'&&typeof item==='string'){let target:any=artifacts.openapi;for(const segment of item.slice(2).split('/'))target=target?.[segment];assert.ok(target,item);}else refs(item);}}
 refs(artifacts.openapi);
});
test('machine-readable administrative operations cover every implemented route and method',async()=>{
 const actual:string[]=[];
 async function walk(folder:string){for(const item of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.isDirectory())await walk(file);else if(item.name==='route.ts'){const source=await readFile(file,'utf8'),url='/api/admin/v1/'+path.relative('src/app/api/admin/v1',path.dirname(file)).split(path.sep).map(p=>p.replace(/^\[(.+)\]$/,'{$1}')).join('/');for(const [,method] of source.matchAll(/export (?:async )?function (GET|PUT|POST|PATCH|DELETE)\(/g))actual.push(method+' '+url);}}}
 await walk('src/app/api/admin/v1');
 const expected=adminOperationCatalog.flatMap(op=>Object.keys(op.methods).map(method=>method.toUpperCase()+' '+op.path));assert.deepEqual(actual.sort(),expected.sort());
});
test('production integration gates run before credentials, identity, database and network access',async()=>{
 assert.equal(EXTERNAL_AVERIDI_INTEGRATION_ENABLED,false);
 let calls=0;
 const client=createDashboardContractClient({origin:'invalid origin intentionally unused',token:async()=>{calls++;throw Error('unexpected credentials');},transport:(async()=>{calls++;throw Error('unexpected network');}) as typeof fetch});
 await assert.rejects(client.subscription('workspace_1'),/INTEGRATIONS_INACTIVE/);assert.equal(calls,0);
 const never=async()=>{calls++;throw Error('unexpected dependency');};
 const api=createEcosystemApi({active:()=>false,verify:never,released:()=>{calls++;return true;},subscription:never,navigation:never});
 assert.equal((await api(new Request('https://dashboard.test/api'),'workspace_1','subscription')).status,503);assert.equal(calls,0);
 const original={...process.env};Object.assign(process.env,{DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'true',DASHBOARD_ADMIN_BRIDGE_ENABLED:'true',DASHBOARD_RELEASE_MODE:'OFF'});
 try{
  const response=await productionSubscription(new Request('https://dashboard.test/api',{headers:{authorization:'Bearer forged',cookie:'website_session=forged'}}),{params:Promise.resolve({workspaceId:'workspace_1'})});assert.equal(response.status,503);assert.equal((await response.json()).error,'INTEGRATIONS_INACTIVE');assert.equal(await verifyDashboardAdminBridgeToken('forged','dashboard:manage'),null);
  assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/api/integrations/v1/contracts'))).headers.get('x-middleware-next'),'1');
 }finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
