import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import http from 'node:http';
import * as dbModule from '../src/server/db.ts';
const {dashboardDb:db}=dbModule.default??dbModule;
const database=new URL(process.env.DASHBOARD_DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(database.hostname)||decodeURIComponent(database.pathname)!=='/dashboard_test')throw Error('Request-limit acceptance requires isolated loopback dashboard_test.');
const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin='http://127.0.0.1:'+port,network='198.18.'+Math.floor(Math.random()*255)+'.'+(1+Math.floor(Math.random()*254));
const env={...process.env,DASHBOARD_RELEASE_MODE:'GENERAL',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_RATE_LIMIT_TRUST_PROXY:'true',DASHBOARD_RATE_LIMIT_IP_HEADER:'x-dashboard-fixture-ip',DASHBOARD_RATE_LIMIT_API_PER_MINUTE:'2',DASHBOARD_RATE_LIMIT_AUTH_PER_MINUTE:'2',DASHBOARD_PUBLIC_ORIGIN:'https://dashboard.test'};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>{logs+=d});child.stderr.on('data',d=>{logs+=d});
const keys=['API','AUTH'].map(policy=>createHash('sha256').update('dashboard-rate-v1|'+policy+'|'+network).digest('hex'));
const request=(path,extra={})=>fetch(origin+'/dashboard/app'+path,{redirect:'manual',headers:{'x-dashboard-fixture-ip':network,...extra}});
try{
 let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('Production app exited: '+logs);try{if((await request('/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}assert.ok(ready,'Production app did not start: '+logs);
 // A fresh forced window is used for each class so a wall-clock minute transition cannot make the fixture flaky.
 for(const [policy,paths] of [['API',['/api/workspaces','/api/organizations','/api/not-a-route']],['AUTH',['/api/auth/me','/api/auth/session','/api/auth/login']]]){
  const key=keys[policy==='API'?0:1];await db.dashboardRequestBucket.deleteMany({where:{key}});
  for(let i=0;i<2;i++){const response=await request(paths[i],{'x-forwarded-for':randomUUID(),'cookie':'forged='+randomUUID()});assert.notEqual(response.status,429);assert.equal(response.headers.get('x-ratelimit-limit'),'2');assert.equal(response.headers.get('x-ratelimit-remaining'),String(1-i));}
  // Keep the saturated bucket current even if the preceding requests crossed a minute boundary.
  await db.$executeRaw`UPDATE "DashboardRequestBucket" SET "count"=2,"windowStart"=date_trunc('minute',clock_timestamp() AT TIME ZONE 'UTC') WHERE "key"=${key}`;
  const blocked=await request(paths[2],{'x-forwarded-for':'192.0.2.22'});assert.equal(blocked.status,429);assert.equal(blocked.headers.get('cache-control'),'no-store');assert.ok(Number(blocked.headers.get('retry-after'))>=1);assert.deepEqual(await blocked.json(),{error:'RATE_LIMITED'});
 }
 assert.equal((await request('/api/health')).status,200);
 const logout=await fetch(origin+'/dashboard/app/api/auth/logout',{method:'POST',headers:{origin:env.DASHBOARD_PUBLIC_ORIGIN,'x-dashboard-fixture-ip':network}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie')??'',/Max-Age=0/);
 console.log('PASS: production Next request boundary enforces separate API/auth budgets, shared route budgets, forged cookie/forwarded-header resistance, 429/retry/no-store headers, health and sign-out availability.');
}finally{child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)child.kill('SIGKILL');await db.dashboardRequestBucket.deleteMany({where:{key:{in:keys}}});await db.$disconnect();}
