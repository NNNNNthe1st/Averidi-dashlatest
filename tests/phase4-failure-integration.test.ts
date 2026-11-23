import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
import {markFailedDashboardProfile} from "../src/worker/profile-failure";

test("terminal replacement failure does not deactivate the previously verified dataset",async()=>{
 const suffix=randomUUID(),workspace=await dashboardDb.dashboardWorkspace.create({data:{name:"Failure isolation "+suffix}});
 try{
  const dataset=await dashboardDb.dashboardDataset.create({data:{workspaceId:workspace.id,name:"Orders",status:"READY"}});
  const old=await dashboardDb.dashboardDatasetVersion.create({data:{datasetId:dataset.id,version:1,status:"READY",sourceFormat:"CSV",storageKey:"uploads/"+workspace.id+"/"+dataset.id+"/"+suffix+"/source.bin",fileSize:BigInt(1),checksum:"fixture",rowCount:1,profiledAt:new Date()}});
  await dashboardDb.dashboardDataset.update({where:{id:dataset.id},data:{activeVersionId:old.id}});
  const replacement=await dashboardDb.dashboardDatasetVersion.create({data:{datasetId:dataset.id,version:2,status:"PENDING",sourceFormat:"CSV",storageKey:"uploads/"+workspace.id+"/"+dataset.id+"/"+randomUUID()+"/source.bin",fileSize:BigInt(1),checksum:"fixture2"}});
  const job=await dashboardDb.dashboardJob.create({data:{workspaceId:workspace.id,kind:"DATASET_PROFILE",status:"FAILED",attempts:3,idempotencyKey:"profile_"+replacement.id,payload:{datasetId:dataset.id,versionId:replacement.id,format:"csv"}}});
  await markFailedDashboardProfile(job);
  const after=await dashboardDb.dashboardDataset.findUniqueOrThrow({where:{id:dataset.id}});
  assert.equal(after.status,"READY");
  assert.equal(after.activeVersionId,old.id);
  assert.equal((await dashboardDb.dashboardDatasetVersion.findUniqueOrThrow({where:{id:replacement.id}})).status,"FAILED");
  assert.equal(await dashboardDb.dashboardDatasetVersion.count({where:{datasetId:dataset.id,status:"PENDING"}}),0);
 }finally{await dashboardDb.dashboardWorkspace.delete({where:{id:workspace.id}});}
});
test("failed first import leaves dataset inactive and allows a later replacement",async()=>{
 const suffix=randomUUID(),workspace=await dashboardDb.dashboardWorkspace.create({data:{name:"First failure "+suffix}});
 try{
  const dataset=await dashboardDb.dashboardDataset.create({data:{workspaceId:workspace.id,name:"First",status:"INGESTING"}});
  const version=await dashboardDb.dashboardDatasetVersion.create({data:{datasetId:dataset.id,version:1,status:"PENDING",sourceFormat:"CSV",storageKey:"uploads/"+workspace.id+"/"+dataset.id+"/"+suffix+"/source.bin",fileSize:BigInt(1),checksum:"fixture"}});
  const job=await dashboardDb.dashboardJob.create({data:{workspaceId:workspace.id,kind:"DATASET_PROFILE",status:"FAILED",attempts:3,idempotencyKey:"profile_"+version.id,payload:{datasetId:dataset.id,versionId:version.id,format:"csv"}}});
  await markFailedDashboardProfile(job);
  const after=await dashboardDb.dashboardDataset.findUniqueOrThrow({where:{id:dataset.id}});
  assert.equal(after.status,"FAILED");assert.equal(after.activeVersionId,null);
  assert.equal((await dashboardDb.dashboardDatasetVersion.findUniqueOrThrow({where:{id:version.id}})).status,"FAILED");
 }finally{await dashboardDb.dashboardWorkspace.delete({where:{id:workspace.id}});}
});
