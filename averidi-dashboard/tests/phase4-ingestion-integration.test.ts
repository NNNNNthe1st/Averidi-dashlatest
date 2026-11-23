import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import ExcelJS from "exceljs-hardened";
import {dashboardDb} from "../src/server/db";
import {dashboardStorageKey,writeDashboardObject} from "../src/server/storage";
import {runDashboardWorkerOnce} from "../src/worker/run-once";

test("Phase 4: selected Excel worksheet survives storage, queue and worker profiling",async()=>{
 const suffix=randomUUID();
 const old=process.env.DASHBOARD_WORKER_ENABLED;
 process.env.DASHBOARD_WORKER_ENABLED="true";
 const user=await dashboardDb.dashboardUser.create({data:{externalSubject:"phase4-fixture|"+suffix}});
 const workspace=await dashboardDb.dashboardWorkspace.create({data:{name:"Phase4 fixture"}});
 try{
  await dashboardDb.dashboardMembership.create({data:{userId:user.id,workspaceId:workspace.id,role:"OWNER"}});
  await dashboardDb.dashboardSubscription.create({data:{workspaceId:workspace.id,planCode:"STARTER",status:"ACTIVE",currentPeriodEnd:new Date(Date.now()+86400_000)}});
  const dataset=await dashboardDb.dashboardDataset.create({data:{workspaceId:workspace.id,name:"Multisheet sample"}});
  const workbook=new ExcelJS.Workbook();
  const sales=workbook.addWorksheet("Sales");sales.addRow(["Item","Revenue"]);sales.addRow(["A",200]);
  const costs=workbook.addWorksheet("Costs");costs.addRow(["Item","Cost"]);costs.addRow(["A",75]);
  const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
  const versionId=randomUUID(),key=dashboardStorageKey(workspace.id,dataset.id,versionId);
  await writeDashboardObject(key,bytes);
  await dashboardDb.dashboardDatasetVersion.create({data:{id:versionId,datasetId:dataset.id,version:1,storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash("sha256").update(bytes).digest("hex")}});
  const job=await dashboardDb.dashboardJob.create({data:{workspaceId:workspace.id,kind:"DATASET_PROFILE",idempotencyKey:"profile_"+versionId,payload:{datasetId:dataset.id,versionId,format:"xlsx",worksheetName:"Costs"}}});
  const finished=await runDashboardWorkerOnce();
  assert.equal(finished.claimed,true);
  assert.equal(finished.jobId,job.id);
  assert.equal(finished.status,"COMPLETED");
  const version=await dashboardDb.dashboardDatasetVersion.findUniqueOrThrow({where:{id:versionId}});
  assert.equal(version.rowCount,1);
  const profile=version.profile as {fields?:Record<string,unknown>}|null;
  assert.ok(profile?.fields?.Cost);
  assert.equal(profile?.fields?.Revenue,undefined);
  assert.equal((await dashboardDb.dashboardDataset.findUniqueOrThrow({where:{id:dataset.id}})).status,"READY");
 }finally{
  await dashboardDb.dashboardWorkspace.delete({where:{id:workspace.id}});
  await dashboardDb.dashboardUser.delete({where:{id:user.id}});
  if(old===undefined)delete process.env.DASHBOARD_WORKER_ENABLED;else process.env.DASHBOARD_WORKER_ENABLED=old;
 }
});
