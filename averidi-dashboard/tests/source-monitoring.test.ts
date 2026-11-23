import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {saveSourceMonitoringPolicy,listSourceMonitoring,acknowledgeSourceIncident,reconcileSourceMonitoringForJob,sweepSourceMonitoring} from '../src/features/monitoring/sources';
import {sourceFreshness} from '../src/features/monitoring/source-contracts';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {GET as summaryGET} from '../src/app/api/workspaces/[workspaceId]/monitoring/summary/route';
import {GET,POST} from '../src/app/api/workspaces/[workspaceId]/monitoring/route';
after(()=>db.$disconnect());
test('freshness uses explicit limits and inclusive deadlines without inventing a policy',()=>{
 const start=new Date('2026-01-01T00:00:00Z'),now=new Date('2026-01-01T00:01:00Z');
 assert.deepEqual(sourceFreshness(null,start,null,now),{configured:false,stale:false,deadline:null});assert.equal(sourceFreshness(null,start,1,now).stale,true);assert.equal(sourceFreshness(now,start,1,now).stale,false);
});
test('source notifications enforce tenant/revision access, persist acknowledgement, deduplicate and recover',async()=>{
 const f=await governedWorkspace();try{
  const dataset=await db.dashboardDataset.findUniqueOrThrow({where:{id:f.dataset.id}}),sourceId=dataset.sourceId!,job={workspaceId:f.workspace.id,payload:{sourceId}};
  const input={sourceId,expectedRevision:0,maxAgeMinutes:1,notifyFailures:true,notifyMetricFailures:true};
  await assert.rejects(saveSourceMonitoringPolicy(f.reader,f.workspace.id,input),/FORBIDDEN/);await assert.rejects(saveSourceMonitoringPolicy(f.actor,f.foreign.id,input),/NOT_FOUND/);
  const policy=await saveSourceMonitoringPolicy(f.actor,f.workspace.id,input);assert.equal(policy.revision,1);await assert.rejects(saveSourceMonitoringPolicy(f.actor,f.workspace.id,input),/VERSION_CONFLICT/);
  await db.dashboardDataSource.update({where:{id:sourceId},data:{status:'FAILED',lastSyncedAt:new Date(Date.now()-120000)}});
  await Promise.all([reconcileSourceMonitoringForJob(job),reconcileSourceMonitoringForJob(job)]);
  let state=await listSourceMonitoring(f.reader,f.workspace.id);assert.equal(state.incidents.length,2);assert.equal(state.sources[0].freshness.stale,true);
  const event=state.incidents.find(i=>i.kind==='REFRESH_FAILURE')!;await assert.rejects(acknowledgeSourceIncident(f.reader,f.workspace.id,{id:event.id,generation:1}),/FORBIDDEN/);await assert.rejects(acknowledgeSourceIncident(f.actor,f.foreign.id,{id:event.id,generation:1}),/VERSION_CONFLICT/);
  await acknowledgeSourceIncident(f.actor,f.workspace.id,{id:event.id,generation:1});await reconcileSourceMonitoringForJob(job);assert.equal((await db.dashboardSourceIncident.findUniqueOrThrow({where:{id:event.id}})).status,'ACKNOWLEDGED');
  const retry=await db.dashboardJob.create({data:{workspaceId:f.workspace.id,kind:'SOURCE_REFRESH',payload:{sourceId,datasetId:f.dataset.id}}});await reconcileSourceMonitoringForJob(job);assert.equal((await db.dashboardSourceIncident.findUniqueOrThrow({where:{id:event.id}})).status,'ACKNOWLEDGED');await db.dashboardJob.update({where:{id:retry.id},data:{status:'COMPLETED'}});
  await db.dashboardDataSource.update({where:{id:sourceId},data:{status:'CONNECTED',lastSyncedAt:new Date()}});await reconcileSourceMonitoringForJob(job);state=await listSourceMonitoring(f.actor,f.workspace.id);assert.ok(state.incidents.every(i=>i.status==='RESOLVED'));
  await db.dashboardDataSource.update({where:{id:sourceId},data:{status:'FAILED'}});await reconcileSourceMonitoringForJob(job);const reopened=await db.dashboardSourceIncident.findUniqueOrThrow({where:{id:event.id}});assert.equal(reopened.generation,2);assert.equal(reopened.status,'OPEN');await assert.rejects(acknowledgeSourceIncident(f.actor,f.workspace.id,{id:event.id,generation:1}),/VERSION_CONFLICT/);
  await saveSourceMonitoringPolicy(f.actor,f.workspace.id,{...input,expectedRevision:1,maxAgeMinutes:null,notifyFailures:false});assert.equal((await db.dashboardSourceIncident.findUniqueOrThrow({where:{id:event.id}})).status,'RESOLVED');
 }finally{await f.cleanup();}
});
test('queued refresh retries are suppressed; superseded failures require a successful current calculation',async()=>{
 const f=await governedWorkspace();try{
  const sourceId=(await db.dashboardDataset.findUniqueOrThrow({where:{id:f.dataset.id}})).sourceId!,job={workspaceId:f.workspace.id,payload:{datasetId:f.dataset.id}};
  const pending=await db.dashboardJob.create({data:{workspaceId:f.workspace.id,kind:'SOURCE_REFRESH',status:'QUEUED',payload:{sourceId,datasetId:f.dataset.id}}});await db.dashboardDataSource.update({where:{id:sourceId},data:{status:'FAILED'}});await reconcileSourceMonitoringForJob(job);assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents.length,0);
  await db.dashboardJob.update({where:{id:pending.id},data:{status:'FAILED',finishedAt:new Date()}});await reconcileSourceMonitoringForJob(job);assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents[0].kind,'REFRESH_FAILURE');
  await db.dashboardAnalysisRun.update({where:{id:f.analysisId},data:{status:'BLOCKED'}});await reconcileSourceMonitoringForJob(job);assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents.filter(i=>i.kind==='METRIC_FAILURE'&&i.status==='OPEN').length,1);
  await db.dashboardDatasetVersion.update({where:{id:f.versionId},data:{semanticRevision:{increment:1}}});await reconcileSourceMonitoringForJob(job);assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents.find(i=>i.kind==='METRIC_FAILURE')?.status,'OPEN');
  const current=(await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}})).semanticRevision;await f.run('METRICS_CALCULATE',{datasetId:f.dataset.id,versionId:f.versionId,semanticRevision:current});assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents.find(i=>i.kind==='METRIC_FAILURE')?.status,'RESOLVED');
 }finally{await f.cleanup();}
});
test('ordinary worker terminal metric failures generate notifications through both job aliases',async()=>{
 const f=await governedWorkspace();try{
  const revision=(await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}})).semanticRevision;
  // A safe permanent failure in the existing analysis boundary, after its current run.
  const failed=await db.dashboardJob.create({data:{workspaceId:f.workspace.id,kind:'METRICS_CALCULATE',payload:{datasetId:f.dataset.id,versionId:f.versionId,semanticRevision:revision},status:'FAILED',finishedAt:new Date(Date.now()+1)}});
  await reconcileSourceMonitoringForJob(failed);const state=await listSourceMonitoring(f.actor,f.workspace.id);assert.equal(state.incidents.find(i=>i.kind==='METRIC_FAILURE')?.status,'OPEN');
  await db.dashboardJob.update({where:{id:failed.id},data:{status:'COMPLETED',finishedAt:new Date(Date.now()+1)}});await reconcileSourceMonitoringForJob(failed);assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents.find(i=>i.kind==='METRIC_FAILURE')?.status,'RESOLVED');
  // Real worker integration: corrupted source binding fails safely before calculation.
  await db.dashboardDatasetVersion.update({where:{id:f.versionId},data:{semanticRevision:{increment:1}}});
  const next=(await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}})).semanticRevision;
  const checksum=(await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}})).checksum;await db.dashboardDatasetVersion.update({where:{id:f.versionId},data:{checksum:'0'.repeat(64)}});
  const task=await db.dashboardJob.create({data:{workspaceId:f.workspace.id,kind:'DATASET_ANALYZE',payload:{datasetId:f.dataset.id,versionId:f.versionId,semanticRevision:next}}});
  await assert.rejects(runDashboardWorkerOnce(),/SOURCE_INTEGRITY_FAILURE/);assert.equal((await db.dashboardJob.findUniqueOrThrow({where:{id:task.id}})).status,'FAILED');assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents.find(i=>i.kind==='METRIC_FAILURE')?.status,'OPEN');
  await db.dashboardDatasetVersion.update({where:{id:f.versionId},data:{checksum}});await f.run('METRICS_CALCULATE',{datasetId:f.dataset.id,versionId:f.versionId,semanticRevision:next});assert.equal((await listSourceMonitoring(f.actor,f.workspace.id)).incidents.find(i=>i.kind==='METRIC_FAILURE')?.status,'RESOLVED');
 }finally{await f.cleanup();}
});
test('monitoring API integrates source policies and notifications with CSRF and viewer boundaries',async()=>{
 const f=await governedWorkspace();try{
  const sourceId=(await db.dashboardDataset.findUniqueOrThrow({where:{id:f.dataset.id}})).sourceId!,cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.actor),context={params:Promise.resolve({workspaceId:f.workspace.id})};
  const body={action:'SAVE_SOURCE_POLICY',input:{sourceId,expectedRevision:0,maxAgeMinutes:60,notifyFailures:true,notifyMetricFailures:true}};
  const request=(origin:string,token=cookie)=>new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/monitoring',{method:'POST',headers:{cookie:token,origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await POST(request('https://evil.test'),context)).status,403);assert.equal((await POST(request('https://dashboard.test'),context)).status,200);
  const result=await GET(new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/monitoring',{headers:{cookie}}),context);assert.equal(result.status,200);const state=await result.json();assert.equal(state.sourceMonitoring.sources[0].policy.maxAgeMinutes,60);
  const summary=await summaryGET(new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/monitoring/summary',{headers:{cookie}}),context);assert.equal(summary.status,200);assert.equal(typeof (await summary.json()).open,'number');
  assert.equal((await summaryGET(new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/monitoring/summary'),context)).status,401);
  const reader='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.reader);assert.equal((await POST(request('https://dashboard.test',reader),context)).status,403);
 }finally{await f.cleanup();}
});
