import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readWorkspaceObject,writeWorkspaceObject,deleteWorkspaceTemporaryObject} from '../src/server/workspace-storage';
import {dashboardDb} from '../src/server/db';
import {requireWorkspaceRole} from '../src/server/workspace-access';
import {dashboardWorkspaceArtifactKey,writeDashboardObject,readDashboardObject,deleteDashboardTemporaryObject} from '../src/server/storage';

test('database rejects cross-tenant views and storage workflow respects workspace access',async()=>{
 const id=randomUUID();
 const user=await dashboardDb.dashboardUser.create({data:{externalSubject:'infra|'+id}});
 const a=await dashboardDb.dashboardWorkspace.create({data:{name:'Infrastructure A'}});
 const b=await dashboardDb.dashboardWorkspace.create({data:{name:'Infrastructure B'}});
 const key=dashboardWorkspaceArtifactKey('temporary',a.id,id);
 try{
  await dashboardDb.dashboardMembership.create({data:{userId:user.id,workspaceId:a.id,role:'OWNER'}});
  const actor={userId:user.id,issuer:'infra',subject:id};
  assert.ok(await requireWorkspaceRole(actor,a.id,'VIEWER'));
  assert.equal(await requireWorkspaceRole(actor,b.id,'VIEWER'),null);
  const dataset=await dashboardDb.dashboardDataset.create({data:{workspaceId:a.id,name:'Tenant fixture'}});
  await assert.rejects(()=>dashboardDb.dashboardView.create({data:{workspaceId:b.id,datasetId:dataset.id,name:'Forbidden',definition:{}}}));
  const bytes=Buffer.from('Dashboard-only dataset '+id);
  await writeWorkspaceObject(actor,a.id,key,bytes);
  assert.deepEqual(await readWorkspaceObject(actor,a.id,key),bytes);
  await assert.rejects(()=>readWorkspaceObject(actor,b.id,key),/FORBIDDEN/);
  await assert.rejects(()=>readWorkspaceObject({...actor,userId:"outsider"},a.id,key),/FORBIDDEN/);
  await assert.rejects(()=>writeDashboardObject(key,bytes));
  await deleteWorkspaceTemporaryObject(actor,a.id,key);
  await assert.rejects(()=>readDashboardObject(key));
 }finally{
  await dashboardDb.dashboardView.deleteMany({where:{workspaceId:{in:[a.id,b.id]}}});
  await dashboardDb.dashboardWorkspace.deleteMany({where:{id:{in:[a.id,b.id]}}});
  await dashboardDb.dashboardUser.delete({where:{id:user.id}});
 }
});
