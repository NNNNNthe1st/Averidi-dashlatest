import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
import {dashboardStorageKey,writeDashboardObject} from "../src/server/storage";
import {runDashboardWorkerOnce} from "../src/worker/run-once";

test("Phase 4: verified version stays active until a replacement passes worker profiling",async()=>{
 const tag=randomUUID();
 const original=process.env.DASHBOARD_WORKER_ENABLED;
 process.env.DASHBOARD_WORKER_ENABLED="true";
 const workspace=await dashboardDb.dashboardWorkspace.create({data:{name:"Phase4 activation "+tag}});
 try{
  await dashboardDb.dashboardSubscription.create({data:{workspaceId:workspace.id,planCode:"STARTER",status:"ACTIVE",currentPeriodEnd:new Date(Date.now()+86400_000)}});
  const dataset=await dashboardDb.dashboardDataset.create({data:{workspaceId:workspace.id,name:"Orders",status:"READY"}});
  const make=async(index:number,text:string)=>{
   const versionId=randomUUID(),bytes=Buffer.from(text),storageKey=dashboardStorageKey(workspace.id,dataset.id,versionId);
   await writeDashboardObject(storageKey,bytes);
   return dashboardDb.dashboardDatasetVersion.create({data:{
    id:versionId,datasetId:dataset.id,version:index,status:index===1?"READY":"PENDING",sourceFormat:"CSV",
    storageKey,checksum:createHash("sha256").update(bytes).digest("hex"),fileSize:BigInt(bytes.length),
    ...(index===1?{rowCount:1,profiledAt:new Date()}:{}),
   }});
  };
  const prior=await make(1,"order,revenue\nA,100\n");
  await dashboardDb.dashboardDataset.update({where:{id:dataset.id},data:{activeVersionId:prior.id}});
  const next=await make(2,"order,revenue\nA,150\nB,40\n");
  const job=await dashboardDb.dashboardJob.create({data:{
   workspaceId:workspace.id,kind:"DATASET_PROFILE",idempotencyKey:"profile_"+next.id,
   payload:{datasetId:dataset.id,versionId:next.id,format:"csv"},
  }});
  const before=await dashboardDb.dashboardDataset.findUniqueOrThrow({where:{id:dataset.id}});
  assert.equal(before.activeVersionId,prior.id);
  assert.equal(before.status,"READY");
  assert.equal((await dashboardDb.dashboardDatasetVersion.findUniqueOrThrow({where:{id:next.id}})).status,"PENDING");
  const processed=await runDashboardWorkerOnce();
  assert.equal(processed.jobId,job.id);
  assert.equal(processed.status,"COMPLETED");
  const after=await dashboardDb.dashboardDataset.findUniqueOrThrow({where:{id:dataset.id}});
  assert.equal(after.activeVersionId,next.id);
  assert.equal(after.status,"READY");
  const previouslyActive=await dashboardDb.dashboardDatasetVersion.findUniqueOrThrow({where:{id:prior.id}});
  assert.equal(previouslyActive.status,"READY");
  assert.equal(previouslyActive.rowCount,1);
  const activated=await dashboardDb.dashboardDatasetVersion.findUniqueOrThrow({where:{id:next.id}});
  assert.equal(activated.status,"READY");
  assert.equal(activated.rowCount,2);
 }finally{
  await dashboardDb.dashboardWorkspace.delete({where:{id:workspace.id}});
  if(original===undefined)delete process.env.DASHBOARD_WORKER_ENABLED;else process.env.DASHBOARD_WORKER_ENABLED=original;
 }
});
