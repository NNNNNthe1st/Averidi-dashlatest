import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
import {createWorkspaceDataset,listWorkspaceDatasets} from "../src/features/datasets/service";
import {listWorkspaceDataSources} from "../src/features/data-sources/service";

test("Phase 4: source ownership and verified active version survive pending imports",async()=>{
 const suffix=randomUUID();
 const user=await dashboardDb.dashboardUser.create({data:{externalSubject:"source-integration|"+suffix}});
 const a=await dashboardDb.dashboardWorkspace.create({data:{name:"First tenant"}});
 const b=await dashboardDb.dashboardWorkspace.create({data:{name:"Other tenant"}});
 const actor={userId:user.id,issuer:"source-integration",subject:suffix};
 try{
  await dashboardDb.dashboardMembership.create({data:{userId:user.id,workspaceId:a.id,role:"OWNER"}});
  const created=await createWorkspaceDataset(actor,a.id,"Monthly orders");
  assert.equal(created.ok,true);
  if(!created.ok)throw Error("Dataset creation failed");
  const dataset=await dashboardDb.dashboardDataset.findUniqueOrThrow({where:{id:created.dataset.id}});
  assert.ok(dataset.sourceId);
  const source=await dashboardDb.dashboardDataSource.findUniqueOrThrow({where:{id:dataset.sourceId!}});
  assert.equal(source.kind,"FILE");assert.equal(source.status,"CONNECTED");
  assert.equal(source.workspaceId,a.id);
  const sources=await listWorkspaceDataSources(actor,a.id);
  assert.equal(sources?.length,1);
  assert.equal(sources?.[0].datasetCount,1);
  assert.equal(await listWorkspaceDataSources(actor,b.id),null);
  const outsider=await dashboardDb.dashboardDataSource.create({data:{workspaceId:b.id,name:"Foreign source",kind:"FILE",status:"CONNECTED"}});
  await assert.rejects(()=>dashboardDb.dashboardDataset.update({where:{id:dataset.id},data:{sourceId:outsider.id}}));
  const active=await dashboardDb.dashboardDatasetVersion.create({data:{datasetId:dataset.id,version:1,status:"READY",sourceFormat:"CSV",storageKey:"uploads/"+a.id+"/"+dataset.id+"/"+randomUUID()+"/source.bin",fileSize:BigInt(1),checksum:"fixture",rowCount:1,profiledAt:new Date(),semantics:{fields:[],confirmationRequired:true}}});
  await dashboardDb.dashboardDataset.update({where:{id:dataset.id},data:{status:"READY",activeVersionId:active.id}});
  const pending=await dashboardDb.dashboardDatasetVersion.create({data:{datasetId:dataset.id,version:2,status:"PENDING",sourceFormat:"CSV",storageKey:"uploads/"+a.id+"/"+dataset.id+"/"+randomUUID()+"/source.bin",fileSize:BigInt(1),checksum:"fixture-two"}});
  const before=await listWorkspaceDatasets(actor,a.id);
  const result=before?.find(item=>item.id===dataset.id);
  assert.equal(result?.latestVersionId,active.id);
  assert.equal(result?.pendingVersionId,pending.id);
  assert.equal(result?.status,"READY");
  await dashboardDb.dashboardDatasetVersion.update({where:{id:pending.id},data:{status:"FAILED"}});
  const after=await listWorkspaceDatasets(actor,a.id);
  assert.equal(after?.find(item=>item.id===dataset.id)?.latestVersionId,active.id);
 }finally{
  await dashboardDb.dashboardDataset.deleteMany({where:{workspaceId:{in:[a.id,b.id]}}});
  await dashboardDb.dashboardDataSource.deleteMany({where:{workspaceId:{in:[a.id,b.id]}}});
  await dashboardDb.dashboardWorkspace.deleteMany({where:{id:{in:[a.id,b.id]}}});
  await dashboardDb.dashboardUser.delete({where:{id:user.id}});
 }
});
