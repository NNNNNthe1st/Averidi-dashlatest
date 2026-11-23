import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../src/server/db';
after(()=>db.$disconnect());
const start=new Date('2026-01-01'),end=new Date('2026-02-01');

import {databaseDomainFixture as fixture} from './fixtures/database-domains';

async function rollback(run:(tx:Prisma.TransactionClient)=>Promise<void>){
 await assert.rejects(db.$transaction(async tx=>{await run(tx);throw Error('ROLLBACK_FIXTURE');},{timeout:30000}),/ROLLBACK_FIXTURE/);
}

test('all architecture persistence domains store exact values and roll back cleanly',async()=>{
 let workspaceId='';
 await rollback(async tx=>{
  const f=await fixture(tx);workspaceId=f.workspace.id;
  assert.equal(Object.keys(f.ids).length,40);
  const result=await tx.dashboardMetricResult.findUniqueOrThrow({where:{id:f.ids.dashboardMetricResult}});
  assert.equal(result.value?.toFixed(10),'1234.5678901234');
  assert.equal((result.lineage as any).versionId,f.version.id);
  const invoice=await tx.dashboardInvoice.findUniqueOrThrow({where:{id:f.ids.dashboardInvoice}});
  assert.equal(invoice.amount.toFixed(6),'12.345678');
  assert.equal((await tx.dashboardDataset.findUniqueOrThrow({where:{id:f.dataset.id},include:{activeVersion:true}})).activeVersion?.id,f.version.id);
 });
 assert.equal(await db.dashboardWorkspace.count({where:{id:workspaceId}}),0);
});

test('PostgreSQL rejects cross-workspace links throughout the new domains',async()=>{
 await rollback(async tx=>{
  const f=await fixture(tx),other=await tx.dashboardWorkspace.create({data:{name:'Other tenant'}});
  // Use savepoints because PostgreSQL aborts a transaction after a constraint violation.
  for(const [name,id] of Object.entries(f.ids)){
   const model=Prisma.dmmf.datamodel.models.find(m=>m.name[0].toLowerCase()+m.name.slice(1)===name)!;
   if(!model.fields.some(field=>field.relationFromFields?.includes('workspaceId')&&field.relationFromFields.length>1))continue;
   await tx.$executeRawUnsafe('SAVEPOINT tenant_check');
   await assert.rejects((tx as any)[name].update({where:{id},data:{workspaceId:other.id}}),(e:any)=>e.code==='P2003',name);
   await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT tenant_check');
  }
  const otherDataset=await tx.dashboardDataset.create({data:{workspaceId:other.id,name:'Other data'}});
  await tx.$executeRawUnsafe('SAVEPOINT active_check');
  await assert.rejects(tx.dashboardDataset.update({where:{id:otherDataset.id},data:{activeVersionId:f.version.id}}),(e:any)=>e.code==='P2003');
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT active_check');
 });
});

test('database rejects duplicate provider events, invalid periods and incomplete ready exports',async()=>{
 await rollback(async tx=>{
  const f=await fixture(tx);
  const bad=[
   ()=>tx.dashboardMetricResult.create({data:{workspaceId:f.workspace.id,datasetId:f.dataset.id,versionId:f.version.id,metricId:f.metric.id,status:'READY',lineage:{},periodStart:end,periodEnd:start}}),
   ()=>tx.dashboardReportExport.create({data:{workspaceId:f.workspace.id,reportId:f.report.id,status:'READY'}}),
   async()=>{const event=await tx.dashboardWebhookRecord.findUniqueOrThrow({where:{id:f.ids.dashboardWebhookRecord}});return tx.dashboardWebhookRecord.create({data:{workspaceId:f.workspace.id,connectorId:f.connector.id,externalEventId:event.externalEventId,payloadDigest:'retry'}});},
  ];
  for(const run of bad){await tx.$executeRawUnsafe('SAVEPOINT invalid_check');await assert.rejects(run());await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_check');}
 });
});

test('workspace deletion cascades its domain graph without deleting global identity or plans',async()=>{
 await rollback(async tx=>{
  const f=await fixture(tx);
  await tx.dashboardWorkspace.delete({where:{id:f.workspace.id}});
  for(const model of Prisma.dmmf.datamodel.models.filter(m=>m.fields.some(f=>f.name==='workspaceId'&&f.isRequired))){
   const name=model.name[0].toLowerCase()+model.name.slice(1);
   assert.equal(await (tx as any)[name].count({where:{workspaceId:f.workspace.id}}),0,model.name);
  }
  assert.ok(await tx.dashboardUser.findUnique({where:{id:f.user.id}}));
  assert.ok(await tx.dashboardBillingPlan.findUnique({where:{id:f.ids.dashboardBillingPlan}}));
 });
});
