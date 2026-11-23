import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {dashboardStorageKey,writeDashboardObject,readDashboardObject} from '../src/server/storage';
import {confirmWorkspaceDatasetFields,confirmWorkspaceDatasetMetricRules} from '../src/features/datasets/service';
import {enqueueActorDashboardJob} from '../src/worker/queue';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {saveReportDefinition,listReportDefinitions} from '../src/features/reports/definitions';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {POST as createReport} from '../src/app/api/workspaces/[workspaceId]/reports/route';
import {PATCH as editReport} from '../src/app/api/workspaces/[workspaceId]/reports/[reportId]/route';
after(()=>db.$disconnect());

test('report authoring preserves tenant boundaries, role checks, revisions and real worker output',async()=>{
 const previous={worker:process.env.DASHBOARD_WORKER_ENABLED,secret:process.env.DASHBOARD_SESSION_SECRET};
 process.env.DASHBOARD_WORKER_ENABLED='true';process.env.DASHBOARD_SESSION_SECRET='report-authoring-fixture-'.repeat(3);
 const subject=randomUUID(),user=await db.dashboardUser.create({data:{externalSubject:'reports|'+subject}}),viewer=await db.dashboardUser.create({data:{externalSubject:'reports-viewer|'+randomUUID()}});
 const workspace=await db.dashboardWorkspace.create({data:{name:'Reports'}}),foreign=await db.dashboardWorkspace.create({data:{name:'Other reports'}});
 const actor={userId:user.id,issuer:'reports',subject},reader={userId:viewer.id,issuer:'reports-viewer',subject:'viewer'};
 try{
  await db.dashboardMembership.createMany({data:[{userId:user.id,workspaceId:workspace.id,role:'OWNER'},{userId:user.id,workspaceId:foreign.id,role:'OWNER'},{userId:viewer.id,workspaceId:workspace.id,role:'VIEWER'}]});
  await db.dashboardSubscription.createMany({data:[workspace,foreign].map(item=>({workspaceId:item.id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}))});
  const source=await db.dashboardDataSource.create({data:{workspaceId:workspace.id,kind:'FILE',name:'Orders'}}),dataset=await db.dashboardDataset.create({data:{workspaceId:workspace.id,sourceId:source.id,name:'Orders'}});
  const versionId=randomUUID(),bytes=Buffer.from('id,amount,cost,channel\n001,100,40,Web\n002,200,80,Shop\n'),key=dashboardStorageKey(workspace.id,dataset.id,versionId);
  await writeDashboardObject(key,bytes);
  await db.dashboardDatasetVersion.create({data:{id:versionId,datasetId:dataset.id,version:1,status:'PENDING',sourceFormat:'CSV',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex')}});
  async function run(kind:string,payload:unknown){const job=await enqueueActorDashboardJob(actor,workspace.id,kind,payload,randomUUID());assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');return (await db.dashboardJob.findUniqueOrThrow({where:{id:job.id}})).result as Record<string,string>;}
  await run('DATASET_INGEST',{datasetId:dataset.id,versionId,format:'csv'});
  assert.equal((await confirmWorkspaceDatasetFields(actor,workspace.id,dataset.id,{versionId,mappings:[['id','ORDER'],['amount','REVENUE'],['cost','COST'],['channel','CHANNEL']].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept}))})).ok,true);
  assert.equal((await confirmWorkspaceDatasetMetricRules(actor,workspace.id,dataset.id,{versionId,grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'})).ok,true);
  const version=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:versionId}}),analysis=await run('METRICS_CALCULATE',{datasetId:dataset.id,versionId,semanticRevision:version.semanticRevision}),generated=await run('DASHBOARD_GENERATE',{datasetId:dataset.id,analysisId:analysis.analysisId,template:'SALES'});
  const input={name:'Web report',viewId:generated.viewId,definition:{query:{filters:[{type:'CATEGORY',field:'channel',value:'Web'}],compare:false}}};
  const report=await saveReportDefinition(actor,workspace.id,input);
  assert.equal((await listReportDefinitions(reader,workspace.id)).reports[0].id,report.id);
  await assert.rejects(saveReportDefinition(reader,workspace.id,input),/FORBIDDEN/);
  await assert.rejects(saveReportDefinition(actor,foreign.id,input),/REPORT_UNAVAILABLE/);
  await assert.rejects(saveReportDefinition(actor,workspace.id,{...input,format:'HTML'}),/INVALID_REPORT_DEFINITION/);
  await assert.rejects(saveReportDefinition(actor,workspace.id,{...input,definition:{expiresAt:'2000-01-01T00:00:00Z'}}),/INVALID_REPORT_DEFINITION/);
  const revised=await saveReportDefinition(actor,workspace.id,{...input,name:'Updated report',expectedUpdatedAt:report.updatedAt.toISOString()},report.id);
  await assert.rejects(saveReportDefinition(actor,workspace.id,{...input,expectedUpdatedAt:'2000-01-01T00:00:00Z'},report.id),/VERSION_CONFLICT/);
  await assert.rejects(saveReportDefinition(actor,foreign.id,{...input,expectedUpdatedAt:revised.updatedAt.toISOString()},report.id),/REPORT_UNAVAILABLE/);
  const output=await run('REPORT_GENERATE',{reportId:report.id}),artifact=await db.dashboardReportExport.findUniqueOrThrow({where:{id:output.exportId}}),csv=(await readDashboardObject(artifact.storageKey!)).toString();
  assert.match(csv,/100/);assert.equal((await listReportDefinitions(actor,workspace.id)).exports[0].id,artifact.id);
  assert.equal(await db.dashboardAuditEvent.count({where:{workspaceId:workspace.id,resourceId:report.id,action:{in:['REPORT_CREATED','REPORT_UPDATED']}}}),2);
  const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(actor),context={params:Promise.resolve({workspaceId:workspace.id})};
  const request=(origin:string,body:unknown,method='POST')=>new Request('https://dashboard.test/dashboard/app/api/workspaces/'+workspace.id+'/reports',{method,headers:{cookie,origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await createReport(request('https://foreign.invalid',input),context)).status,403);
  assert.equal((await createReport(request('https://dashboard.test',{...input,name:'From API'}),context)).status,201);
  assert.equal((await editReport(request('https://dashboard.test',{...input,expectedUpdatedAt:'2000-01-01T00:00:00Z'},'PATCH'),{params:Promise.resolve({workspaceId:workspace.id,reportId:report.id})})).status,409);
 }finally{
  await db.dashboardWorkspace.deleteMany({where:{id:{in:[workspace.id,foreign.id]}}});await db.dashboardUser.deleteMany({where:{id:{in:[user.id,viewer.id]}}});
  if(previous.worker===undefined)delete process.env.DASHBOARD_WORKER_ENABLED;else process.env.DASHBOARD_WORKER_ENABLED=previous.worker;
  if(previous.secret===undefined)delete process.env.DASHBOARD_SESSION_SECRET;else process.env.DASHBOARD_SESSION_SECRET=previous.secret;
 }
});
