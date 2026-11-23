import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDb} from '../src/server/db';
import {dashboardStorageKey,writeDashboardObject} from '../src/server/storage';
import {enqueueActorDashboardJob,cancelActorDashboardJob,scheduleDashboardJob,dispatchDueDashboardSchedules} from '../src/worker/queue';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {serveDashboardWorker,dashboardWorkerSettings} from '../src/worker/service';
import {claimDashboardJob,reportDashboardJobProgress,finishDashboardJob} from '../src/worker/job-claim';

test('worker queue deduplication, tenancy, progress, cancellation, schedules and graceful service stop',async()=>{
 const id=randomUUID();const original=process.env.DASHBOARD_WORKER_ENABLED;process.env.DASHBOARD_WORKER_ENABLED='true';
 const user=await dashboardDb.dashboardUser.create({data:{externalSubject:'worker-lifecycle|'+id}});
 const ws=await dashboardDb.dashboardWorkspace.create({data:{name:'Worker lifecycle'}});
 const other=await dashboardDb.dashboardWorkspace.create({data:{name:'Other tenant'}});
 const actor={userId:user.id,issuer:'worker-lifecycle',subject:id};
 try{
  await dashboardDb.dashboardMembership.create({data:{userId:user.id,workspaceId:ws.id,role:'OWNER'}});
  await dashboardDb.dashboardSubscription.create({data:{workspaceId:ws.id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400_000)}});
  const dataset=await dashboardDb.dashboardDataset.create({data:{workspaceId:ws.id,name:'CSV fixture'}});
  const bytes=Buffer.from('date,revenue\n2026-01-01,100\n2026-01-02,120\n');
  const key=dashboardStorageKey(ws.id,dataset.id,id);await writeDashboardObject(key,bytes);
  const version=await dashboardDb.dashboardDatasetVersion.create({data:{id,datasetId:dataset.id,version:1,storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex')}});
  const payload={datasetId:dataset.id,versionId:version.id,format:'csv'};
  const enqueue=(key:string)=>enqueueActorDashboardJob(actor,ws.id,'DATASET_PROFILE',payload,key);
  const [a,b]=await Promise.all([enqueue('one'),enqueue('one')]);assert.equal(a.id,b.id);
  await assert.rejects(()=>enqueueActorDashboardJob(actor,ws.id,'DATASET_PROFILE',{...payload,format:'json'},'one'),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>enqueueActorDashboardJob(actor,other.id,'DATASET_PROFILE',payload,'other'),/FORBIDDEN/);
  await assert.rejects(()=>enqueueActorDashboardJob(actor,ws.id,'UNKNOWN',payload,'bad'),/UNSUPPORTED/);
  await runDashboardWorkerOnce();
  const done=await dashboardDb.dashboardJob.findUniqueOrThrow({where:{id:a.id}});
  assert.equal(done.status,'COMPLETED');assert.equal(done.progress,100);assert.ok(done.finishedAt);assert.ok(done.result);
  const profiled=await dashboardDb.dashboardDatasetVersion.findUniqueOrThrow({where:{id:version.id}});assert.equal(profiled.rowCount,2);
  const queued=await enqueue('cancel-queued');await cancelActorDashboardJob(actor,ws.id,queued.id);
  assert.equal((await dashboardDb.dashboardJob.findUniqueOrThrow({where:{id:queued.id}})).status,'CANCELLED');
  const active=await enqueue('cancel-active');const claimed=await claimDashboardJob();assert.equal(claimed?.id,active.id);
  await reportDashboardJobProgress(active.id,claimed!.leaseToken!,20);
  await cancelActorDashboardJob(actor,ws.id,active.id);
  await assert.rejects(()=>reportDashboardJobProgress(active.id,claimed!.leaseToken!,50));
  await finishDashboardJob(active.id,claimed!.leaseToken!,false,'JOB_CANCELLED');
  assert.equal((await dashboardDb.dashboardJob.findUniqueOrThrow({where:{id:active.id}})).status,'CANCELLED');
  const schedule=await scheduleDashboardJob(ws.id,'DATASET_PROFILE',payload,60,new Date(Date.now()-1000));
  assert.equal(await dispatchDueDashboardSchedules(),1);assert.equal(await dispatchDueDashboardSchedules(),0);
  await dashboardDb.dashboardJobSchedule.update({where:{id:schedule.id},data:{enabled:false}});
  const controller=new AbortController();
  const running=serveDashboardWorker(controller.signal);
  const deadline=Date.now()+5000;
  let beat;
  while(Date.now()<deadline){beat=await dashboardDb.dashboardWorkerHeartbeat.findFirst({where:{stopping:false}});if(beat)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.ok(beat);controller.abort();await running;
  assert.equal((await dashboardDb.dashboardWorkerHeartbeat.findUniqueOrThrow({where:{id:beat!.id}})).stopping,true);
  await dashboardDb.dashboardWorkerHeartbeat.delete({where:{id:beat!.id}});
  assert.throws(()=>dashboardWorkerSettings({DASHBOARD_WORKER_ENABLED:'true',DASHBOARD_WORKER_POLL_MS:'0'}));
 }finally{
  await dashboardDb.dashboardWorkspace.deleteMany({where:{id:{in:[ws.id,other.id]}}});
  await dashboardDb.dashboardUser.delete({where:{id:user.id}});
  if(original===undefined)delete process.env.DASHBOARD_WORKER_ENABLED;else process.env.DASHBOARD_WORKER_ENABLED=original;
 }
});
