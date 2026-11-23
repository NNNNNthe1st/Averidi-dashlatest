import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {NextRequest} from 'next/server';
import {dashboardDb as db} from '../src/server/db';
import {dashboardRateLimitSettings,dashboardRateLimitNetwork,dashboardRateLimitPolicy,consumeDashboardRateLimit,checkDashboardRequestRate} from '../src/server/rate-limit';
import {cleanupDashboardAuthentication} from '../src/server/browser-session';
import {proxy} from '../src/proxy';
const keys:string[]=[];
function key(){const k=createHash('sha256').update(randomUUID()).digest('hex');keys.push(k);return k;}
after(async()=>{await db.dashboardRequestBucket.deleteMany({where:{key:{in:keys}}});await db.$disconnect();});
function settings(env:Record<string,string|undefined>={}){return dashboardRateLimitSettings(env);}
function network(value:string,env:Record<string,string|undefined>={DASHBOARD_RATE_LIMIT_IP_HEADER:'x-client-ip',DASHBOARD_RATE_LIMIT_TRUST_PROXY:'true'}){return dashboardRateLimitNetwork(new Request('https://dashboard.test',{headers:{'x-client-ip':value,'x-forwarded-for':value}}),settings(env));}
test('request budgets reject unsafe configuration and untrusted/spoofed addresses',()=>{
 assert.deepEqual(settings(),{api:600,auth:30,ipHeader:null});
 for(const env of [{DASHBOARD_RATE_LIMIT_API_PER_MINUTE:'0'},{DASHBOARD_RATE_LIMIT_AUTH_PER_MINUTE:'false'},{DASHBOARD_RATE_LIMIT_API_PER_MINUTE:'100001'},{DASHBOARD_RATE_LIMIT_IP_HEADER:'x-forwarded-for'},{DASHBOARD_RATE_LIMIT_IP_HEADER:'Cookie',DASHBOARD_RATE_LIMIT_TRUST_PROXY:'true'},{DASHBOARD_RATE_LIMIT_TRUST_PROXY:'TRUE'}])assert.throws(()=>settings(env),/CONFIGURATION_INVALID/);
 assert.equal(network('198.51.100.1',{}),'unattributed');assert.equal(network('198.51.100.2',{}),'unattributed');
 for(const v of ['198.51.100.1,198.51.100.2','unknown','for=198.51.100.1','198.51.100.1:80','fe80::1%eth0','a'.repeat(100)])assert.equal(network(v),'unattributed');
 assert.equal(network('198.51.100.1'),'198.51.100.1');assert.equal(network('::ffff:198.51.100.1'),'198.51.100.1');
 assert.equal(network('2001:db8:1:2:3:4:5:6'),network('2001:0db8:0001:0002::7'));assert.notEqual(network('2001:db8:1:3::1'),network('2001:db8:1:2::1'));
});
test('all API namespaces share limits while auth and availability exceptions are explicit',()=>{
 for(const p of ['/api/workspaces/w/views','/api/admin/v1/health','/api/integrations/v1/contracts','/api/billing/stripe/webhook','/api/not-real'])assert.equal(dashboardRateLimitPolicy(p),'API');
 for(const p of ['/api/auth/login','/api/auth/callback','/api/auth/session','/api/auth/refresh','/api/auth/me'])assert.equal(dashboardRateLimitPolicy(p),'AUTH');
 for(const p of ['/workspaces/w/studio','/api/health','/api/health/ready','/api/auth/logout','/api/auth/logout-all'])assert.equal(dashboardRateLimitPolicy(p),null);
});
test('atomic budgets serialize concurrent consumers across independent database clients',async()=>{
 const k=key(),other=new PrismaClient({datasources:{db:{url:process.env.DASHBOARD_DATABASE_URL}}});
 try{const results=await Promise.all(Array.from({length:24},(_,i)=>consumeDashboardRateLimit(k,7,i%2?db:other)));assert.equal(results.filter(r=>r.allowed).length,7);assert.ok(results.every(r=>r.retryAfter>=1&&r.retryAfter<=60&&r.reset>0));assert.equal((await db.dashboardRequestBucket.findUniqueOrThrow({where:{key:k}})).count,8);assert.equal((await consumeDashboardRateLimit(key(),7,db)).allowed,true);}
 finally{await other.$disconnect();}
});
test('budgets reset using the database clock and cleanup only removes expired counters',async()=>{
 const k=key(),expired=key();await consumeDashboardRateLimit(k,1,db);assert.equal((await consumeDashboardRateLimit(k,1,db)).allowed,false);
 await db.dashboardRequestBucket.update({where:{key:k},data:{windowStart:new Date(0)}});const fresh=await consumeDashboardRateLimit(k,1,db);assert.equal(fresh.allowed,true);assert.equal(fresh.remaining,0);
 await db.dashboardRequestBucket.create({data:{key:expired,count:1,windowStart:new Date(0),expiresAt:new Date(0)}});assert.ok((await cleanupDashboardAuthentication()).requestBuckets>=1);assert.equal(await db.dashboardRequestBucket.count({where:{key:expired}}),0);assert.equal(await db.dashboardRequestBucket.count({where:{key:k}}),1);
});
test('HTTP boundary fails closed without weakening release, health or sign-out controls',async()=>{
 const saved={...process.env};Object.assign(process.env,{DASHBOARD_RELEASE_MODE:'GENERAL',DASHBOARD_RATE_LIMIT_API_PER_MINUTE:'0'});
 const request=(path:string)=>new NextRequest('https://dashboard.test/dashboard/app'+path);
 try{
  const failed=await proxy(request('/api/workspaces'));assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'REQUEST_PROTECTION_UNAVAILABLE'});assert.equal(failed.headers.get('Retry-After'),'5');
  for(const path of ['/api/health','/api/health/ready','/api/auth/logout','/api/auth/logout-all'])assert.equal((await proxy(request(path))).headers.get('x-middleware-next'),'1');
  process.env.DASHBOARD_RELEASE_MODE='OFF';assert.equal((await (await proxy(request('/api/workspaces'))).json()).error,'DASHBOARD_NOT_RELEASED');
  delete process.env.DASHBOARD_RATE_LIMIT_API_PER_MINUTE;
  await assert.rejects(checkDashboardRequestRate(request('/api/workspaces'),'/api/workspaces',{$queryRaw:async()=>{throw Error('private database connection secret');}} as never),/private database/);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
