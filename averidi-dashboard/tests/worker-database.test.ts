import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
import {claimDashboardJob,finishDashboardJob,recoverExpiredDashboardJobs,renewDashboardJobLease} from "../src/worker/job-claim";

/** Runs only against the dedicated, disposable Dashboard integration database. */
test("concurrent claims, lost lease rejection and crash recovery",async()=>{
 const id=randomUUID();
 const userId="test-worker-"+id;
 const workspaceId="test-workspace-"+id;
 const jobId="test-job-"+id;
 await dashboardDb.dashboardUser.create({data:{id:userId,externalSubject:userId}});
 await dashboardDb.dashboardWorkspace.create({data:{id:workspaceId,name:"Worker integration test"}});
 try{
  await dashboardDb.dashboardJob.create({data:{id:jobId,workspaceId,kind:"DATASET_PROFILE",payload:{datasetId:"test",versionId:"test",format:"csv"}}});
  const claimed=await Promise.all(Array.from({length:5},()=>claimDashboardJob()));
  const winners=claimed.filter(job=>job?.id===jobId);
  assert.equal(winners.length,1);
  const active=winners[0]!;
  assert.ok(active.leaseToken);
  assert.equal((await renewDashboardJobLease(jobId,"incorrect")).count,0);
  assert.equal((await finishDashboardJob(jobId,"incorrect",true)).count,0);
  const expired=new Date(Date.now()-60_000);
  await dashboardDb.dashboardJob.update({where:{id:jobId},data:{leaseExpiresAt:expired}});
  assert.equal((await finishDashboardJob(jobId,active.leaseToken!,true)).count,0);
  assert.equal(await recoverExpiredDashboardJobs(),1);
  const queued=await dashboardDb.dashboardJob.findUniqueOrThrow({where:{id:jobId}});
  assert.equal(queued.status,"QUEUED");
  assert.equal(queued.leaseToken,null);
  assert.ok(queued.availableAt.getTime()>Date.now()-1000);
  await dashboardDb.dashboardJob.update({where:{id:jobId},data:{status:"RUNNING",attempts:3,leaseToken:"expired-terminal",leaseExpiresAt:expired}});
  assert.equal(await recoverExpiredDashboardJobs(),1);
  const terminal=await dashboardDb.dashboardJob.findUniqueOrThrow({where:{id:jobId}});
  assert.equal(terminal.status,"FAILED");
  assert.equal(terminal.leaseToken,null);
 }finally{
  await dashboardDb.dashboardWorkspace.delete({where:{id:workspaceId}});
  await dashboardDb.dashboardUser.delete({where:{id:userId}});
 }
});


test("job availability and five-minute leases retain UTC meaning in non-UTC database sessions",async()=>{
 const workspace=await dashboardDb.dashboardWorkspace.create({data:{name:'Queue UTC boundary'}});
 const now=new Date();
 try{
  const future=await dashboardDb.dashboardJob.create({data:{workspaceId:workspace.id,kind:'DATASET_PROFILE',availableAt:new Date(now.getTime()+180000),payload:{datasetId:'test',versionId:'test',format:'csv'}}});
  const early=await claimDashboardJob(now);assert.notEqual(early?.id,future.id,'a future job must not be claimed early');
  const due=await dashboardDb.dashboardJob.create({data:{workspaceId:workspace.id,kind:'DATASET_PROFILE',availableAt:new Date(now.getTime()-1000),payload:{datasetId:'test',versionId:'test',format:'csv'}}});
  const claimed=await claimDashboardJob(now);assert.equal(claimed?.id,due.id);assert.equal(claimed!.leaseExpiresAt!.getTime()-now.getTime(),300000);
 }finally{await dashboardDb.dashboardWorkspace.delete({where:{id:workspace.id}});}
});
