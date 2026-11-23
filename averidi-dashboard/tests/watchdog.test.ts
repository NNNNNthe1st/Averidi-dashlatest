import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {newWatchdogState,acceptHeartbeat,advanceWatchdog,startWatchdog} from '../scripts/monitoring/watchdog.mjs';
import {heartbeatSettings,sendHeartbeat} from '../scripts/monitoring/heartbeat.mjs';
test('dead-man detection uses persisted receiver time and refuses replay, forged products and clock skew',()=>{
 let s=newWatchdogState(1000);s=acceptHeartbeat(s,{version:1,product:'averidi-dashboard',id:randomUUID(),sentAt:2000},2000);assert.equal(advanceWatchdog(s,1000,10000,2999).pending,null);
 const stale=advanceWatchdog(s,1000,10000,3000);assert.equal(stale.pending?.changes[0].status,'FIRING');assert.deepEqual(advanceWatchdog(stale,1000,10000,4000).pending,stale.pending);
 assert.throws(()=>acceptHeartbeat(s,{version:1,product:'averidi-dashboard',id:randomUUID(),sentAt:2000},2001));assert.throws(()=>acceptHeartbeat(s,{version:1,product:'other',id:randomUUID(),sentAt:3000},3000));assert.throws(()=>acceptHeartbeat(s,{version:1,product:'averidi-dashboard',id:randomUUID(),sentAt:99999999},3000));
 const recovered=advanceWatchdog(acceptHeartbeat({...stale,pending:null,lastAlert:3000},{version:1,product:'averidi-dashboard',id:randomUUID(),sentAt:4000},4000),1000,10000,4001);assert.equal(recovered.pending?.changes[0].status,'RESOLVED');
});
test('heartbeat sender requires authenticated TLS endpoints and reports failed delivery without exposing secrets',async()=>{
 assert.equal(heartbeatSettings({}),null);for(const url of ['http://localhost/heartbeat','https://user:password@localhost/heartbeat','https://localhost/heartbeat?token=x'])assert.throws(()=>heartbeatSettings({DASHBOARD_MONITOR_HEARTBEAT_URL:url,DASHBOARD_MONITOR_HEARTBEAT_TOKEN:'x'.repeat(32)}));
 const settings=heartbeatSettings({DASHBOARD_MONITOR_HEARTBEAT_URL:'https://localhost/heartbeat',DASHBOARD_MONITOR_HEARTBEAT_TOKEN:'x'.repeat(32)})!;await assert.rejects(sendHeartbeat(settings,async()=>new Response('',{status:503})),/MONITOR_HEARTBEAT_DELIVERY_FAILED/);
});
test('actual loopback watchdog authenticates and persists heartbeat state across restarts',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dashboard-watchdog-')),token='fixture-'.repeat(8),env={DASHBOARD_WATCHDOG_PORT:'0',DASHBOARD_WATCHDOG_STATE_DIRECTORY:directory,DASHBOARD_MONITOR_HEARTBEAT_TOKEN:token,DASHBOARD_MONITOR_READY_URL:'https://localhost/dashboard/app/api/health/ready',DASHBOARD_MONITOR_WEBHOOK_URL:'https://localhost/alerts'};let server:Awaited<ReturnType<typeof startWatchdog>>|undefined;
 try{server=await startWatchdog(env,async()=>new Response(null,{status:204}));const origin='http://127.0.0.1:'+(server.server.address() as {port:number}).port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/heartbeat',{method:'POST',body:'{}'})).status,401);const input={version:1,product:'averidi-dashboard',id:randomUUID(),sentAt:Date.now()};assert.equal((await fetch(origin+'/heartbeat',{method:'POST',headers,body:JSON.stringify(input)})).status,204);assert.equal((await fetch(origin+'/heartbeat',{method:'POST',headers,body:JSON.stringify(input)})).status,400);assert.equal((await fetch(origin+'/health',{headers})).status,200);
 await server.close();server=await startWatchdog(env,async()=>new Response(null,{status:204}));const next='http://127.0.0.1:'+(server.server.address() as {port:number}).port;assert.equal((await fetch(next+'/heartbeat',{method:'POST',headers,body:JSON.stringify(input)})).status,400);
 }finally{if(server)await server.close();await rm(directory,{recursive:true,force:true});}
});
test('watchdog expiry persists failed alert delivery and sends recovery after authenticated heartbeat',async()=>{
 const {writeFile}=await import('node:fs/promises'),directory=await mkdtemp(path.join(tmpdir(),'dashboard-watchdog-delivery-')),token='fixture-'.repeat(8),env={DASHBOARD_WATCHDOG_PORT:'0',DASHBOARD_WATCHDOG_TIMEOUT_SECONDS:'15',DASHBOARD_WATCHDOG_STATE_DIRECTORY:directory,DASHBOARD_MONITOR_HEARTBEAT_TOKEN:token,DASHBOARD_MONITOR_READY_URL:'https://localhost/dashboard/app/api/health/ready',DASHBOARD_MONITOR_WEBHOOK_URL:'https://localhost/alerts'};
 const events:any[]=[];let allow=false,watchdog:Awaited<ReturnType<typeof startWatchdog>>|undefined;
 const receiver:typeof fetch=async(_url,init)=>{events.push(JSON.parse(String(init?.body)));return new Response(null,{status:allow?204:503});};
 try{
  await writeFile(path.join(directory,'watchdog.json'),JSON.stringify(newWatchdogState(Date.now()-60000)),{mode:0o600});watchdog=await startWatchdog(env,receiver);assert.equal(events[0].changes[0].status,'FIRING');await watchdog.close();watchdog=undefined;
  allow=true;watchdog=await startWatchdog(env,receiver);assert.equal(events[1].eventId,events[0].eventId);
  const origin='http://127.0.0.1:'+(watchdog.server.address() as {port:number}).port;assert.equal((await fetch(origin+'/heartbeat',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({version:1,product:'averidi-dashboard',id:randomUUID(),sentAt:Date.now()})})).status,204);await watchdog.check();assert.equal(events[2].changes[0].status,'RESOLVED');assert.notEqual(events[2].eventId,events[0].eventId);
 }finally{if(watchdog)await watchdog.close();await rm(directory,{recursive:true,force:true});}
});
