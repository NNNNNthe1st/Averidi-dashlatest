import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDb as db} from '../../src/server/db';
import {dashboardStorageKey,writeDashboardObject} from '../../src/server/storage';
import {confirmWorkspaceDatasetFields,confirmWorkspaceDatasetMetricRules} from '../../src/features/datasets/service';
import {enqueueActorDashboardJob} from '../../src/worker/queue';
import {runDashboardWorkerOnce} from '../../src/worker/run-once';
import {verificationDatabases} from '../../scripts/verification/contracts.mjs';
export async function governedWorkspace(){
 verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
 const prior={worker:process.env.DASHBOARD_WORKER_ENABLED,secret:process.env.DASHBOARD_SESSION_SECRET};process.env.DASHBOARD_WORKER_ENABLED='true';process.env.DASHBOARD_SESSION_SECRET='governed-workspace-fixture-'.repeat(3);
 const subject=randomUUID(),user=await db.dashboardUser.create({data:{externalSubject:'governed|'+subject}}),viewerSubject=randomUUID(),viewer=await db.dashboardUser.create({data:{externalSubject:'governed-viewer|'+viewerSubject}});
 const workspace=await db.dashboardWorkspace.create({data:{name:'Governed workspace'}}),foreign=await db.dashboardWorkspace.create({data:{name:'Foreign workspace'}});
 const actor={userId:user.id,issuer:'governed',subject},reader={userId:viewer.id,issuer:'governed-viewer',subject:viewerSubject};
 async function cleanup(){await db.dashboardWorkspace.deleteMany({where:{id:{in:[workspace.id,foreign.id]}}});await db.dashboardUser.deleteMany({where:{id:{in:[user.id,viewer.id]}}});for(const [key,value] of [['DASHBOARD_WORKER_ENABLED',prior.worker],['DASHBOARD_SESSION_SECRET',prior.secret]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}}
 try{
  await db.dashboardMembership.createMany({data:[{userId:user.id,workspaceId:workspace.id,role:'OWNER'},{userId:user.id,workspaceId:foreign.id,role:'OWNER'},{userId:viewer.id,workspaceId:workspace.id,role:'VIEWER'}]});
  await db.dashboardSubscription.createMany({data:[workspace,foreign].map(item=>({workspaceId:item.id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}))});
  const source=await db.dashboardDataSource.create({data:{workspaceId:workspace.id,name:'Orders',kind:'FILE'}}),dataset=await db.dashboardDataset.create({data:{workspaceId:workspace.id,sourceId:source.id,name:'Orders'}});
  const versionId=randomUUID(),bytes=Buffer.from('id,amount,cost,day,channel\n001,100,40,2026-01-01,Web\n002,200,80,2026-01-02,Shop\n'),key=dashboardStorageKey(workspace.id,dataset.id,versionId);await writeDashboardObject(key,bytes);
  await db.dashboardDatasetVersion.create({data:{id:versionId,datasetId:dataset.id,version:1,status:'PENDING',sourceFormat:'CSV',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex')}});
  async function run(kind:string,payload:unknown){const job=await enqueueActorDashboardJob(actor,workspace.id,kind,payload,randomUUID());const result=await runDashboardWorkerOnce();assert.equal(result.jobId,job.id);assert.equal(result.status,'COMPLETED');return (await db.dashboardJob.findUniqueOrThrow({where:{id:job.id}})).result as Record<string,string>;}
  await run('DATASET_INGEST',{datasetId:dataset.id,versionId,format:'csv'});
  assert.equal((await confirmWorkspaceDatasetFields(actor,workspace.id,dataset.id,{versionId,mappings:[['id','ORDER'],['amount','REVENUE'],['cost','COST'],['day','TIME'],['channel','CHANNEL']].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept}))})).ok,true);
  const rules={versionId,grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',timezone:'America/New_York'};
  assert.equal((await confirmWorkspaceDatasetMetricRules(actor,workspace.id,dataset.id,rules)).ok,true);
  const revision=(await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:versionId}})).semanticRevision;
  const analysis=await run('METRICS_CALCULATE',{datasetId:dataset.id,versionId,semanticRevision:revision}),view=await run('DASHBOARD_GENERATE',{datasetId:dataset.id,analysisId:analysis.analysisId,template:'SALES'});
  return {actor,reader,workspace,foreign,dataset,versionId,analysisId:analysis.analysisId,viewId:view.viewId,rules,run,cleanup};
 }catch(error){await cleanup();throw error;}
}
