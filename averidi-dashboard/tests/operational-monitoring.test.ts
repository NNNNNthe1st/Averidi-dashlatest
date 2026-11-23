import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,chmod,writeFile,symlink,readFile,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:https';
import {once} from 'node:events';
import {dashboardDb as db} from '../src/server/db';
import {requiredWorkerCapabilities} from '../src/worker/contracts';
import {monitoringConfig,initialState,signalNames,advanceState,acknowledgeState,deliverAlert,validateState} from '../scripts/monitoring/policy.mjs';
import {stateDirectory,acquireMonitorLock,loadMonitorState,saveMonitorState} from '../scripts/monitoring/state.mjs';
import {probeApplication,probeChild} from '../scripts/monitoring/probes.mjs';

const env={...process.env,DASHBOARD_MONITOR_READY_URL:'https://localhost/dashboard/app/api/health/ready'},config=monitoringConfig(env);
const healthy=()=>Object.fromEntries(signalNames.map(k=>[k,true]));
after(()=>db.$disconnect());
test('monitoring rejects unsafe destinations, malformed thresholds, secrets and readiness lookalikes',async()=>{
 for(const value of ['http://localhost/dashboard/app/api/health/ready','https://u:p@localhost/dashboard/app/api/health/ready','https://localhost/dashboard/app/api/health/ready?token=x','https://localhost/dashboard/app/api/health'])assert.throws(()=>monitoringConfig({...env,DASHBOARD_MONITOR_READY_URL:value}));
 for(const value of ['0','-1','NaN','1.1','1e2','999999999999999999'])assert.throws(()=>monitoringConfig({...env,DASHBOARD_MONITOR_FAILURE_SAMPLES:value}));
 assert.throws(()=>monitoringConfig({...env,DASHBOARD_MONITOR_WEBHOOK_URL:'http://localhost'}));
 assert.throws(()=>monitoringConfig({...env,DASHBOARD_MONITOR_WEBHOOK_TOKEN:'secret'}));
 for(const body of [{ready:true},{product:'averidi-dashboard',ready:true,checks:{database:true,storage:true,worker:false,billing:true}},{product:'other',ready:true},{}])assert.equal(await probeApplication(config.readyUrl,async()=>Response.json(body)),false);
 assert.equal(await probeApplication(config.readyUrl,async()=>Response.json({product:'averidi-dashboard',ready:true,checks:{database:true,storage:true,worker:true,billing:true}})),true);
 assert.equal(await probeApplication(config.readyUrl,async()=>new Response('x'.repeat(32769))),false);
 assert.equal(await probeApplication(config.readyUrl,async()=>{throw Error('secret');}),false);
 assert.equal(await probeChild(['-e','setInterval(()=>{},1000)'],process.env,100),false);
});
test('failure/recovery thresholds, reminder suppression and restart-safe at-least-once alerts',()=>{
 let state=initialState(),signals=healthy();signals.worker=false;
 state=advanceState(state,signals,config,1000);assert.equal(state.pending,null);
 state=advanceState(state,signals,config,2000);assert.deepEqual(state.pending?.changes,[{signal:'worker',status:'FIRING'}]);
 const pending=structuredClone(state);assert.deepEqual(advanceState(state,healthy(),config,3000),pending);
 state=acknowledgeState(state,3000);state=advanceState(state,signals,config,4000);assert.equal(state.pending,null);
 state=advanceState(state,signals,config,3000+config.reminderMs);assert.equal(state.pending?.changes[0].status,'FIRING');state=acknowledgeState(state,4000+config.reminderMs);
 state=advanceState(state,healthy(),config,5000+config.reminderMs);assert.equal(state.pending,null);
 state=advanceState(state,healthy(),config,6000+config.reminderMs);assert.deepEqual(state.pending?.changes,[{signal:'worker',status:'RESOLVED'}]);
 assert.throws(()=>advanceState(state,{...healthy(),other:false},config,7000+config.reminderMs));
 assert.throws(()=>validateState({...state,pending:{...state.pending,changes:[{signal:'token',status:'FIRING'}]}}));
});
test('private persistent state refuses symlinks, broad permissions, corruption and simultaneous runs',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dashboard-monitor-state-'));let unlock:(()=>Promise<void>)|undefined;
 try{
  assert.equal(await stateDirectory(directory),directory);assert.deepEqual(await loadMonitorState(directory),initialState());
  unlock=await acquireMonitorLock(directory);await assert.rejects(acquireMonitorLock(directory));
  const sample=healthy();sample.storage=false;let state=advanceState(initialState(),sample,{...config,failureSamples:1},1000);await saveMonitorState(directory,state);
  assert.deepEqual(await loadMonitorState(directory),state);assert.equal((await lstat(path.join(directory,'state.json'))).mode&0o077,0);
  state=acknowledgeState(state,2000);await saveMonitorState(directory,state);assert.deepEqual(await loadMonitorState(directory),state);
  await chmod(path.join(directory,'state.json'),0o644);await assert.rejects(loadMonitorState(directory));await rm(path.join(directory,'state.json'));
  const outside=path.join(directory,'outside');await writeFile(outside,'private',{mode:0o600});await symlink(outside,path.join(directory,'state.json'));await assert.rejects(loadMonitorState(directory));assert.equal(await readFile(outside,'utf8'),'private');await rm(path.join(directory,'state.json'));
  await writeFile(path.join(directory,'state.json'),'{}',{mode:0o600});await assert.rejects(loadMonitorState(directory));
  await chmod(directory,0o755);await assert.rejects(stateDirectory(directory));
 }finally{if(unlock)await unlock();await rm(directory,{recursive:true,force:true});}
});
test('real HTTPS alert retries keep identity, protect credentials and acknowledge only successful delivery',async()=>{
 const requests:{key:string|undefined,body:any,auth:string|undefined}[]=[];let status=503;
 const server=createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;requests.push({key:req.headers['idempotency-key'] as string,body:JSON.parse(body),auth:req.headers.authorization});res.writeHead(status);res.end();
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const port=(server.address() as {port:number}).port,settings={...config,webhookUrl:`https://127.0.0.1:${port}/alerts`,webhookToken:'fixture-secret'};
  const signals=healthy();signals.database=false;const state=advanceState(initialState(),signals,{...config,failureSamples:1},1000);
  await assert.rejects(deliverAlert(state.pending!,settings),/MONITOR_DELIVERY_FAILED/);assert.ok(state.pending);
  status=204;await deliverAlert(state.pending!,settings);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].auth,'Bearer fixture-secret');assert.equal(requests[0].key,state.pending?.id);
  assert.equal(JSON.stringify(requests[0].body).includes('fixture-secret'),false);assert.deepEqual(requests[0].body.changes,[{signal:'database',status:'FIRING'}]);
  status=302;await assert.rejects(deliverAlert(state.pending!,settings));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('actual restricted-role database monitor detects failed jobs, backlog, expired leases and operational errors',async()=>{
 const workspace=await db.dashboardWorkspace.create({data:{name:'Isolated monitor acceptance'}});
 const run=(signal:string)=>probeChild(['--import','tsx','scripts/monitoring/database.mjs',signal],env);
 try{
  // The suite is sequential and fixtures clean up their own resources.
  for(const name of ['failedJobs','queueDelay','expiredLeases','operationalErrors'])assert.equal(await run(name),true,name);
  const now=Date.now();
  const job=await db.dashboardJob.create({data:{workspaceId:workspace.id,kind:'DATASET_PROFILE',status:'FAILED',payload:{},finishedAt:new Date(now)}});
  assert.equal(await run('failedJobs'),false);await db.dashboardJob.update({where:{id:job.id},data:{finishedAt:new Date(now-86400000)}});assert.equal(await run('failedJobs'),true);
  await db.dashboardJob.update({where:{id:job.id},data:{status:'QUEUED',availableAt:new Date(now-600000)}});assert.equal(await run('queueDelay'),false);
  await db.dashboardJob.update({where:{id:job.id},data:{availableAt:new Date(now+600000)}});assert.equal(await run('queueDelay'),true);
  await db.dashboardJob.update({where:{id:job.id},data:{status:'RUNNING',leaseExpiresAt:new Date(now-60000)}});assert.equal(await run('expiredLeases'),false);
  await db.dashboardOperationalEvent.create({data:{workspaceId:workspace.id,kind:'FIXTURE',severity:'ERROR',details:{private:'never exported'}}});assert.equal(await run('operationalErrors'),false);
  assert.equal(await run('invalid'),false);
 }finally{await db.dashboardWorkspace.delete({where:{id:workspace.id}});}
});
test('actual monitor command probes storage and database and resumes failed HTTPS delivery across processes',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dashboard-monitor-command-')),stateRoot=path.join(directory,'state'),storageRoot=path.join(directory,'storage'),workerId=randomUUID();
 await mkdir(stateRoot,{mode:0o700});await mkdir(storageRoot,{mode:0o700});
 const workspace=await db.dashboardWorkspace.create({data:{name:'Monitor command fixture'}});
 const job=await db.dashboardJob.create({data:{workspaceId:workspace.id,kind:'DATASET_PROFILE',status:'FAILED',payload:{},finishedAt:new Date()}});
 let responseStatus=503;const events:any[]=[];
 const server=createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},async(req,res)=>{
  if(req.url==='/dashboard/app/api/health/ready'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({product:'averidi-dashboard',ready:true,checks:{database:true,storage:true,worker:true,billing:true}}));return;}
  let body='';for await(const chunk of req)body+=chunk;events.push(JSON.parse(body));res.writeHead(responseStatus);res.end();
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const origin=`https://127.0.0.1:${(server.address() as {port:number}).port}`;
  // This fixture isolates failed-job delivery; separate probe tests cover request/job latency and errors.
  const childEnv={...env,DASHBOARD_MONITOR_READY_URL:origin+'/dashboard/app/api/health/ready',DASHBOARD_MONITOR_STATE_DIRECTORY:stateRoot,DASHBOARD_STORAGE_ROOT:storageRoot,DASHBOARD_STORAGE_BACKEND:'local',DASHBOARD_MONITOR_WEBHOOK_URL:origin+'/alerts',DASHBOARD_MONITOR_WEBHOOK_TOKEN:'private-fixture',DASHBOARD_MONITOR_FAILURE_SAMPLES:'1',DASHBOARD_MONITOR_RECOVERY_SAMPLES:'1',DASHBOARD_MONITOR_REQUEST_ERRORS:'1000000',DASHBOARD_MONITOR_REQUEST_MAX_MS:'3600000',DASHBOARD_MONITOR_JOB_MAX_MS:'86400000'};
  async function run(){
   await db.dashboardWorkerHeartbeat.upsert({where:{id:workerId},create:{id:workerId,version:2,capabilities:requiredWorkerCapabilities(),seenAt:new Date()},update:{seenAt:new Date()}});
   let output:string,code=0;try{output=(await promisify(execFile)(process.execPath,['scripts/monitor-dashboard.mjs'],{env:childEnv,timeout:60000})).stdout;}
   catch(e){const error=e as {stdout:string,code:number};code=error.code;output=error.stdout;}
   assert.ok(output);assert.equal(output.includes('private-fixture'),false);return {code,result:JSON.parse(output)};
  }
  const first=await run();assert.equal(first.code,1);assert.equal(first.result.alertDelivery,'PENDING');assert.equal(first.result.signals.failedJobs,false);
  const persisted=await loadMonitorState(stateRoot);assert.ok(persisted.pending);
  for(const [name,healthy] of Object.entries(first.result.signals))if(name!=='failedJobs')assert.equal(healthy,true,name);
  responseStatus=204;const retry=await run();assert.equal(retry.code,1);assert.equal(retry.result.alertDelivery,'ACKNOWLEDGED_OR_NONE');assert.equal((await loadMonitorState(stateRoot)).pending,null);
  assert.equal(events.length,2);assert.deepEqual(events[0],events[1]);assert.equal(events[0].eventId,persisted.pending?.id);
  await db.dashboardJob.update({where:{id:job.id},data:{status:'COMPLETED'}});
  const recovered=await run();assert.equal(recovered.code,0);assert.deepEqual(recovered.result.active,[]);assert.deepEqual(events[2].changes,[{signal:'failedJobs',status:'RESOLVED'}]);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.dashboardWorkerHeartbeat.deleteMany({where:{id:workerId}});await db.dashboardWorkspace.delete({where:{id:workspace.id}});await rm(directory,{recursive:true,force:true});}
});
