import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {dashboardStorageKey,dashboardWorkspaceArtifactKey,writeDashboardObject,readDashboardObject} from '../src/server/storage';
import {enqueueActorDashboardJob,enqueueDashboardJob,dispatchDueReportSchedules} from '../src/worker/queue';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {confirmWorkspaceDatasetFields,confirmWorkspaceDatasetMetricRules} from '../src/features/datasets/service';
import {readDatasetAnalysis} from '../src/features/analysis/service';
import {workerJobKinds} from '../src/worker/contracts';
import {supportedDashboardJobKinds} from '../src/worker/processors';
import {queueInAppReportDelivery} from '../src/features/reports/delivery';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {GET as inbox} from '../src/app/api/workspaces/[workspaceId]/reports/deliveries/route';
import {GET as download} from '../src/app/api/workspaces/[workspaceId]/reports/exports/[exportId]/route';
after(()=>db.$disconnect());

test('all architecture job handlers publish real tenant-owned effects and reports',async()=>{
 assert.deepEqual(supportedDashboardJobKinds().sort(),[...workerJobKinds].sort());assert.equal(workerJobKinds.length,13);
 const oldWorker=process.env.DASHBOARD_WORKER_ENABLED,oldSecret=process.env.DASHBOARD_SESSION_SECRET;process.env.DASHBOARD_WORKER_ENABLED='true';process.env.DASHBOARD_SESSION_SECRET='worker-handlers-test-only-'.repeat(4);
 const subject=randomUUID(),user=await db.dashboardUser.create({data:{externalSubject:'worker|'+subject}}),otherUser=await db.dashboardUser.create({data:{externalSubject:'worker-other|'+randomUUID()}});
 const ws=await db.dashboardWorkspace.create({data:{name:'Worker handlers'}}),foreign=await db.dashboardWorkspace.create({data:{name:'Foreign workspace'}});
 const actor={userId:user.id,issuer:'worker',subject};
 try{
  await db.dashboardMembership.createMany({data:[{workspaceId:ws.id,userId:user.id,role:'OWNER'},{workspaceId:foreign.id,userId:user.id,role:'OWNER'}]});
  await db.dashboardSubscription.createMany({data:[ws,foreign].map(w=>({workspaceId:w.id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}))});
  const source=await db.dashboardDataSource.create({data:{workspaceId:ws.id,kind:'FILE',name:'Orders'}});
  const dataset=await db.dashboardDataset.create({data:{workspaceId:ws.id,name:'Orders',sourceId:source.id}});
  async function stage(number:number,bytes=Buffer.from('id,amount,cost,channel\n001,100,40,Web\n002,200,80,Shop\n')){
   const id=randomUUID(),key=dashboardStorageKey(ws.id,dataset.id,id);await writeDashboardObject(key,bytes);
   return db.dashboardDatasetVersion.create({data:{id,datasetId:dataset.id,version:number,status:'PENDING',sourceFormat:'CSV',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex')}});
  }
  async function run(kind:string,payload:unknown,key=randomUUID()){
   const job=await enqueueActorDashboardJob(actor,ws.id,kind,payload,key);const done=await runDashboardWorkerOnce();assert.equal(done.jobId,job.id);assert.equal(done.status,'COMPLETED');
   const row=await db.dashboardJob.findUniqueOrThrow({where:{id:job.id}});assert.ok(row.effectCommittedAt,kind+' must publish a receipt');return row.result as Record<string,any>;
  }
  let version=await stage(1);
  const ingested=await run('DATASET_INGEST',{datasetId:dataset.id,versionId:version.id,format:'csv'});assert.equal(ingested.rowCount,2);
  const validated=await run('DATASET_VALIDATE',{datasetId:dataset.id,versionId:version.id});assert.equal(validated.status,'PASS');assert.equal(await db.dashboardQualityCheck.count({where:{id:validated.checkId,workspaceId:ws.id}}),1);
  const transformed=await run('DATASET_TRANSFORM',{datasetId:dataset.id,versionId:version.id,operations:[{type:'RENAME',field:'amount',to:'revenue'},{type:'TRIM',field:'channel'}]});
  assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id:dataset.id}})).activeVersionId,version.id);
  await runDashboardWorkerOnce();version=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:transformed.versionId}});assert.equal(version.status,'READY');
  const mappings=[['id','ORDER'],['revenue','REVENUE'],['cost','COST'],['channel','CHANNEL']].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept}));
  assert.equal((await confirmWorkspaceDatasetFields(actor,ws.id,dataset.id,{versionId:version.id,mappings})).ok,true);
  assert.equal((await confirmWorkspaceDatasetMetricRules(actor,ws.id,dataset.id,{versionId:version.id,grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'})).ok,true);
  const revision=(await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:version.id}})).semanticRevision;
  const calculated=await run('METRICS_CALCULATE',{datasetId:dataset.id,versionId:version.id,semanticRevision:revision});assert.ok(calculated.analysisId);
  // Both names use the actual governed engine, with one immutable version/revision run.
  await run('DATASET_ANALYZE',{datasetId:dataset.id,versionId:version.id,semanticRevision:revision});assert.equal(await db.dashboardAnalysisRun.count({where:{versionId:version.id}}),1);
  const analysisId=calculated.analysisId;
  const generated=await run('DASHBOARD_GENERATE',{datasetId:dataset.id,analysisId,template:'SALES'});assert.ok(await db.dashboardView.findUnique({where:{id:generated.viewId}}));
  const metric=await db.dashboardMetricDefinition.create({data:{workspaceId:ws.id,key:'REVENUE',name:'Revenue',definition:{catalogKey:'REVENUE'}}});
  const rule=await db.dashboardAlertRule.create({data:{workspaceId:ws.id,metricId:metric.id,name:'Revenue goal',condition:{operator:'GT',threshold:250},enabled:true}});
  assert.equal((await run('ALERTS_EVALUATE',{ruleId:rule.id,analysisId})).triggered,true);await run('ALERTS_EVALUATE',{ruleId:rule.id,analysisId});assert.equal(await db.dashboardAlertEvent.count({where:{ruleId:rule.id}}),1);
  const report=await db.dashboardReportDefinition.create({data:{workspaceId:ws.id,viewId:generated.viewId,name:'Revenue report',format:'CSV',definition:{}}});
  const exported=await run('REPORT_GENERATE',{reportId:report.id});const artifact=await db.dashboardReportExport.findUniqueOrThrow({where:{id:exported.exportId}});assert.match((await readDashboardObject(artifact.storageKey!)).toString(),/300/);
  const queued=await queueInAppReportDelivery(actor,ws.id,{exportId:artifact.id,userId:user.id},'inbox-delivery');assert.ok(queued.jobId);assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');
  assert.equal((await db.dashboardReportDelivery.findUniqueOrThrow({where:{id:queued.deliveryId}})).status,'DELIVERED');
  const token=await issueDashboardBrowserSession(actor),request=new Request('https://dashboard.test',{headers:{cookie:'__Secure-averidi-dashboard='+token}});
  const inboxResult=await inbox(request,{params:Promise.resolve({workspaceId:ws.id})});assert.equal((await inboxResult.json()).deliveries[0].exportId,artifact.id);
  const file=await download(request,{params:Promise.resolve({workspaceId:ws.id,exportId:artifact.id})});assert.equal(file.status,200);assert.match(await file.text(),/300/);
  await assert.rejects(queueInAppReportDelivery(actor,ws.id,{exportId:artifact.id,userId:otherUser.id},'outsider'),/RECIPIENT_UNAVAILABLE/);
  const unsupported=await db.dashboardReportDelivery.create({data:{workspaceId:ws.id,exportId:artifact.id,destination:'external@example.invalid',idempotencyKey:'unsupported-transport'}});
  await enqueueDashboardJob(ws.id,'REPORT_DELIVER',{deliveryId:unsupported.id},'unsupported-delivery');await assert.rejects(runDashboardWorkerOnce(),/UNSUPPORTED_DELIVERY_TRANSPORT/);
  assert.equal((await db.dashboardReportDelivery.findUniqueOrThrow({where:{id:unsupported.id}})).status,'FAILED');
  await assert.rejects(enqueueDashboardJob(foreign.id,'REPORT_GENERATE',{reportId:report.id},'foreign-report'),/REPORT_UNAVAILABLE/);
  const schedule=await db.dashboardReportSchedule.create({data:{workspaceId:ws.id,reportId:report.id,intervalSeconds:60,nextRunAt:new Date(Date.now()-1000),enabled:true,recipients:[{userId:user.id}]}});
  const dispatch=await Promise.all([dispatchDueReportSchedules(),dispatchDueReportSchedules()]);assert.equal(dispatch.reduce((a,b)=>a+b,0),1);assert.equal(await dispatchDueReportSchedules(),0);
  await runDashboardWorkerOnce();await runDashboardWorkerOnce();assert.equal(await db.dashboardReportDelivery.count({where:{workspaceId:ws.id,scheduleId:schedule.id,status:'DELIVERED'}}),1);
  await db.dashboardReportSchedule.update({where:{id:schedule.id},data:{enabled:false}});
  const refresh=await stage(version.version+1);const refreshed=await run('SOURCE_REFRESH',{datasetId:dataset.id,versionId:refresh.id,format:'csv',sourceId:source.id});assert.ok(await db.dashboardRefreshExecution.findUnique({where:{id:refreshed.refreshExecutionId}}));
  assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id:dataset.id}})).activeVersionId,refresh.id);
  assert.equal((await readDatasetAnalysis(actor,ws.id,dataset.id)).analysis,null);
  const temp=dashboardWorkspaceArtifactKey('temporary',ws.id,'owned-temp');await writeDashboardObject(temp,Buffer.from('temporary'));
  await db.dashboardReportExport.update({where:{id:artifact.id},data:{expiresAt:new Date(Date.now()-1000)}});
  // Privacy cleanup continues after entitlement expires.
  const cleanup=await enqueueDashboardJob(ws.id,'DATA_CLEANUP',{temporaryKeys:[temp]},'cleanup');await db.dashboardSubscription.update({where:{workspaceId:ws.id},data:{status:'INACTIVE'}});
  assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');assert.ok((await db.dashboardJob.findUniqueOrThrow({where:{id:cleanup.id}})).effectCommittedAt);
  assert.equal((await db.dashboardReportExport.findUniqueOrThrow({where:{id:artifact.id}})).status,'EXPIRED');await assert.rejects(readDashboardObject(temp));await assert.rejects(readDashboardObject(artifact.storageKey!));
  await assert.rejects(enqueueDashboardJob(ws.id,'DATA_CLEANUP',{temporaryKeys:[dashboardWorkspaceArtifactKey('temporary',foreign.id,'foreign-temp')]},'wrong-cleanup'),/INVALID_STORAGE_SCOPE/);
 }finally{
  await db.dashboardWorkspace.deleteMany({where:{id:{in:[ws.id,foreign.id]}}});await db.dashboardUser.deleteMany({where:{id:{in:[user.id,otherUser.id]}}});
  if(oldWorker===undefined)delete process.env.DASHBOARD_WORKER_ENABLED;else process.env.DASHBOARD_WORKER_ENABLED=oldWorker;if(oldSecret===undefined)delete process.env.DASHBOARD_SESSION_SECRET;else process.env.DASHBOARD_SESSION_SECRET=oldSecret;
 }
});
