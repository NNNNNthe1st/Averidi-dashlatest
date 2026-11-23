import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {recoverExpiredDashboardJobs} from '../src/worker/job-claim';
import {publishWorkerEffect} from '../src/worker/effects';
import {cancelActorDashboardJob} from '../src/worker/queue';
after(()=>db.$disconnect());
function child(code:string){const processChild=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{env:{...process.env,CHECKPOINT_DISABLE:'1'},stdio:['ignore','pipe','pipe']});let out='',error='';processChild.stdout.on('data',d=>out+=d);processChild.stderr.on('data',d=>error+=d);return {processChild,done:new Promise<string>((resolve,reject)=>processChild.once('exit',code=>code===0?resolve(out.trim()):reject(Error(error))))};}
const claimCode="import * as m from './src/worker/job-claim.ts';const {claimDashboardJob}=m.default??m;import * as d from './src/server/db.ts';const db=(d.default??d).dashboardDb;const job=await claimDashboardJob();console.log(JSON.stringify(job?{id:job.id,leaseToken:job.leaseToken}:null));await db.$disconnect();";
test('native worker processes claim once, recover a killed owner, and acknowledge committed effects exactly once',async()=>{
 const suffix=randomUUID(),user=await db.dashboardUser.create({data:{externalSubject:'process|'+suffix}}),ws=await db.dashboardWorkspace.create({data:{name:'Worker process isolation'}});const actor={userId:user.id,issuer:'process',subject:suffix};
 try{
  await db.dashboardMembership.create({data:{workspaceId:ws.id,userId:user.id,role:'OWNER'}});
  const jobs=await Promise.all(Array.from({length:4},()=>db.dashboardJob.create({data:{workspaceId:ws.id,kind:'DATA_CLEANUP',payload:{temporaryKeys:[]}}})));
  const claims=(await Promise.all(Array.from({length:8},()=>child(claimCode).done))).map(value=>JSON.parse(value)).filter(Boolean);
  assert.equal(claims.length,4);assert.equal(new Set(claims.map(j=>j.id)).size,4);
  const first=claims[0];await db.dashboardJob.update({where:{id:first.id},data:{leaseExpiresAt:new Date(Date.now()-1000)}});
  assert.equal(await recoverExpiredDashboardJobs(),1);
  await assert.rejects(publishWorkerEffect({id:first.id,workspaceId:ws.id,leaseToken:first.leaseToken,payload:{}},async()=>({forged:true})),/LEASE_LOST/);
  // A real killed process leaves a claim; another worker can recover it.
  await db.dashboardJob.updateMany({where:{id:{in:jobs.map(j=>j.id)}},data:{status:'COMPLETED',leaseToken:null,leaseExpiresAt:null}});
  const abandoned=await db.dashboardJob.create({data:{workspaceId:ws.id,kind:'DATA_CLEANUP',payload:{temporaryKeys:[]}}});
  const owner=child(claimCode.replace('await db.$disconnect();',"await db.$disconnect();setInterval(()=>{},1000);"));
  const deadline=Date.now()+10000;while(Date.now()<deadline){if((await db.dashboardJob.findUniqueOrThrow({where:{id:abandoned.id}})).status==='RUNNING')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal((await db.dashboardJob.findUniqueOrThrow({where:{id:abandoned.id}})).status,'RUNNING');owner.processChild.kill('SIGKILL');await owner.done.catch(()=>{});
  await db.dashboardJob.update({where:{id:abandoned.id},data:{leaseExpiresAt:new Date(Date.now()-1000)}});assert.equal(await recoverExpiredDashboardJobs(),1);
  // Crash after database publication and before acknowledgement never repeats effects.
  const token='committed-lease';await db.dashboardJob.update({where:{id:abandoned.id},data:{status:'RUNNING',leaseToken:token,leaseExpiresAt:new Date(Date.now()+60000)}});
  let applied=0;const effect=()=>publishWorkerEffect({id:abandoned.id,workspaceId:ws.id,payload:{},leaseToken:token},async tx=>{applied++;await tx.dashboardOperationalEvent.create({data:{workspaceId:ws.id,kind:'ONCE',severity:'INFO',details:{}}});return {published:true};});
  await assert.rejects(publishWorkerEffect({id:abandoned.id,workspaceId:ws.id,payload:{},leaseToken:token,deadlineAt:Date.now()-1},async()=>({late:true})),/JOB_TIMEOUT/);
  await effect();await effect();assert.equal(applied,1);assert.equal(await db.dashboardOperationalEvent.count({where:{workspaceId:ws.id,kind:'ONCE'}}),1);
  await cancelActorDashboardJob(actor,ws.id,abandoned.id);assert.equal((await db.dashboardJob.findUniqueOrThrow({where:{id:abandoned.id}})).cancelRequestedAt,null);
  await db.dashboardJob.update({where:{id:abandoned.id},data:{leaseExpiresAt:new Date(Date.now()-1000),attempts:3}});await recoverExpiredDashboardJobs();assert.equal((await db.dashboardJob.findUniqueOrThrow({where:{id:abandoned.id}})).status,'COMPLETED');
 }finally{await db.dashboardWorkspace.delete({where:{id:ws.id}});await db.dashboardUser.delete({where:{id:user.id}});}
});


test('worker deadlines retry uncommitted work without publishing effects',async()=>{
 const oldWorker=process.env.DASHBOARD_WORKER_ENABLED,oldTimeout=process.env.DASHBOARD_WORKER_JOB_TIMEOUT_MS;
 process.env.DASHBOARD_WORKER_ENABLED='true';process.env.DASHBOARD_WORKER_JOB_TIMEOUT_MS='1000';
 const ws=await db.dashboardWorkspace.create({data:{name:'Deadline fixture'}});
 try{
  const job=await db.dashboardJob.create({data:{workspaceId:ws.id,kind:'DATA_CLEANUP',payload:{temporaryKeys:[]}}});
  await assert.rejects(runDashboardWorkerOnce(undefined,async()=>{await new Promise(resolve=>setTimeout(resolve,1100));}),/JOB_TIMEOUT/);
  const failed=await db.dashboardJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(failed.status,'QUEUED');assert.equal(failed.lastError,'JOB_TIMEOUT');assert.equal(failed.effectCommittedAt,null);
 }finally{await db.dashboardWorkspace.delete({where:{id:ws.id}});if(oldWorker===undefined)delete process.env.DASHBOARD_WORKER_ENABLED;else process.env.DASHBOARD_WORKER_ENABLED=oldWorker;if(oldTimeout===undefined)delete process.env.DASHBOARD_WORKER_JOB_TIMEOUT_MS;else process.env.DASHBOARD_WORKER_JOB_TIMEOUT_MS=oldTimeout;}
});


test('a standalone service advertises all capabilities and stops gracefully on SIGTERM',async()=>{
 const prior=await db.dashboardWorkerHeartbeat.findMany({select:{id:true}});
 const code="import * as m from './src/worker/service.ts';const {serveDashboardWorker}=m.default??m;import * as d from './src/server/db.ts';const db=(d.default??d).dashboardDb;process.env.DASHBOARD_WORKER_ENABLED='true';const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());await serveDashboardWorker(controller.signal);await db.$disconnect();";
 const service=child(code);let heartbeatId:string|undefined;
 try{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const beat=await db.dashboardWorkerHeartbeat.findFirst({where:{id:{notIn:prior.map(b=>b.id)},stopping:false}});if(beat){heartbeatId=beat.id;assert.equal(beat.version,2);assert.equal(beat.capabilities.length,14);break;}await new Promise(resolve=>setTimeout(resolve,20));}
  assert.ok(heartbeatId);service.processChild.kill('SIGTERM');await service.done;
  assert.equal((await db.dashboardWorkerHeartbeat.findUniqueOrThrow({where:{id:heartbeatId}})).stopping,true);
 }finally{if(service.processChild.exitCode===null)service.processChild.kill('SIGKILL');await service.done.catch(()=>{});if(heartbeatId)await db.dashboardWorkerHeartbeat.delete({where:{id:heartbeatId}});}
});
