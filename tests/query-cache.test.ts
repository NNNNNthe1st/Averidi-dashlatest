import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {dashboardDb as db} from '../src/server/db';
import {queryCacheSettings} from '../src/features/analysis/cache-contracts';
import {queryCacheBinding,pruneExpiredQueryCache,QUERY_CACHE_MAX_BYTES} from '../src/features/analysis/query-cache';
import {requiredWorkerCapabilities} from '../src/worker/contracts';
import {checkDashboardReadiness} from '../src/server/health-readiness';
import {governedWorkspace} from './fixtures/governed-workspace';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {dashboardStoragePath,dashboardStorageKey} from '../src/server/storage';
import {confirmWorkspaceDatasetMetricRules} from '../src/features/datasets/service';
import {mutateSharing} from '../src/features/sharing/service';
after(()=>db.$disconnect());
const keys=['DASHBOARD_QUERY_CACHE_ENABLED','DASHBOARD_QUERY_CACHE_KEY','DASHBOARD_QUERY_CACHE_TTL_SECONDS','DASHBOARD_QUERY_CACHE_MAX_ENTRIES'] as const;
function enable(){const prior=keys.map(key=>[key,process.env[key]] as const);Object.assign(process.env,{DASHBOARD_QUERY_CACHE_ENABLED:'true',DASHBOARD_QUERY_CACHE_KEY:'44'.repeat(32),DASHBOARD_QUERY_CACHE_TTL_SECONDS:'300',DASHBOARD_QUERY_CACHE_MAX_ENTRIES:'32'});return ()=>{for(const [key,value] of prior){if(value===undefined)delete process.env[key];else process.env[key]=value;}};}
test('query-cache configuration and worker capabilities fail closed while the optional cache defaults off',async()=>{
 assert.equal(queryCacheSettings({}),null);const env={DASHBOARD_QUERY_CACHE_ENABLED:'true',DASHBOARD_WORKER_ENABLED:'true',DASHBOARD_QUERY_CACHE_KEY:'44'.repeat(32)};assert.equal(queryCacheSettings(env)?.ttlSeconds,300);
 for(const changes of [{DASHBOARD_QUERY_CACHE_ENABLED:'yes'},{DASHBOARD_WORKER_ENABLED:'false'},{DASHBOARD_QUERY_CACHE_KEY:'short'},{DASHBOARD_QUERY_CACHE_TTL_SECONDS:'0'},{DASHBOARD_QUERY_CACHE_MAX_ENTRIES:'1000'}])assert.throws(()=>queryCacheSettings({...env,...changes}),/QUERY_CACHE_CONFIGURATION_INVALID/);
 assert.equal(requiredWorkerCapabilities({}).length,14);assert.ok(requiredWorkerCapabilities(env).includes('QUERY_CACHE'));assert.equal(requiredWorkerCapabilities({...env,DASHBOARD_ACCOUNT_ERASURE_ENABLED:'true'}).length,16);
 const ready=await checkDashboardReadiness({...env,DASHBOARD_QUERY_CACHE_KEY:'bad',DASHBOARD_RELEASE_MODE:'OFF',DASHBOARD_STORAGE_ROOT:'/tmp/cache-readiness'},{database:async()=>1,worker:async()=>1});assert.equal(ready.ready,false);
 assert.notEqual(queryCacheBinding('a','view',{version:'1'},{filters:[]}).id,queryCacheBinding('b','view',{version:'1'},{filters:[]}).id);
});
test('authenticated cache hits avoid re-reading source bytes, preserve exact response data and enforce per-workspace bounds',async()=>{
 const f=await governedWorkspace(),restore=enable();let moved=false;const file=dashboardStoragePath(dashboardStorageKey(f.workspace.id,f.dataset.id,f.versionId)),temporary=file+'.cache-test';
 try{
  process.env.DASHBOARD_QUERY_CACHE_MAX_ENTRIES='1';const cold=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{});assert.equal(await db.dashboardQueryCache.count({where:{workspaceId:f.workspace.id}}),1);
  await rename(file,temporary);moved=true;const warm=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{});assert.deepEqual(JSON.parse(JSON.stringify(warm)),JSON.parse(JSON.stringify(cold)));
  await assert.rejects(readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{filters:[{type:'CATEGORY',field:'channel',value:'Web'}]}));
  await rename(temporary,file);moved=false;const filtered=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{filters:[{type:'CATEGORY',field:'channel',value:'Web'}]});assert.equal(filtered.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,100);assert.equal(await db.dashboardQueryCache.count({where:{workspaceId:f.workspace.id}}),1);
 }finally{if(moved)await rename(temporary,file);restore();await f.cleanup();}
 assert.equal(await db.dashboardQueryCache.count({where:{workspaceId:f.workspace.id}}),0);
});
test('tampered payloads/signatures and key rotation fall back to current verified calculations without logging cached values',async()=>{
 const f=await governedWorkspace(),restore=enable();try{
  await readWorkspaceDashboardData(f.actor,f.workspace.id,f.viewId,{});const row=await db.dashboardQueryCache.findFirstOrThrow({where:{workspaceId:f.workspace.id}});
  const marker='must-not-be-audited-business-value';await db.dashboardQueryCache.update({where:{id:row.id},data:{payload:JSON.stringify({forged:marker})}});
  const repaired=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{});assert.equal(repaired.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);assert.ok(!(await db.dashboardQueryCache.findUniqueOrThrow({where:{id:row.id}})).payload.includes(marker));
  const audit=await db.dashboardMutationAudit.findMany({where:{resourceId:row.id}});assert.ok(audit.length);assert.ok(!JSON.stringify(audit).includes(marker));
  process.env.DASHBOARD_QUERY_CACHE_KEY='55'.repeat(32);assert.equal((await readWorkspaceDashboardData(f.actor,f.workspace.id,f.viewId,{})).analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);
  await assert.rejects(db.dashboardQueryCache.update({where:{id:row.id},data:{payload:'x'.repeat(QUERY_CACHE_MAX_BYTES+1)}}));
 }finally{restore();await f.cleanup();}
});
test('cached results do not bypass current sharing, tenant, entitlement or confirmation/version boundaries',async()=>{
 const f=await governedWorkspace(),restore=enable();try{
  await readWorkspaceDashboardData(f.actor,f.workspace.id,f.viewId,{});
  await mutateSharing(f.actor,f.workspace.id,f.viewId,{action:'MODE',mode:'RESTRICTED',expectedUpdatedAt:(await db.dashboardView.findUniqueOrThrow({where:{id:f.viewId}})).updatedAt.toISOString()});
  await assert.rejects(readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{}),/NOT_FOUND|FORBIDDEN/);
  await assert.rejects(readWorkspaceDashboardData(f.reader,f.foreign.id,f.viewId,{}),/FORBIDDEN/);
  await db.dashboardSubscription.update({where:{workspaceId:f.workspace.id},data:{status:'INACTIVE'}});await assert.rejects(readWorkspaceDashboardData(f.actor,f.workspace.id,f.viewId,{}),/SUBSCRIPTION_REQUIRED/);
  await db.dashboardSubscription.update({where:{workspaceId:f.workspace.id},data:{status:'ACTIVE'}});await confirmWorkspaceDatasetMetricRules(f.actor,f.workspace.id,f.dataset.id,f.rules);await assert.rejects(readWorkspaceDashboardData(f.actor,f.workspace.id,f.viewId,{}),/STALE_ANALYSIS/);
 }finally{restore();await f.cleanup();}
});
test('expired entries are ignored and removed by bounded native worker maintenance',async()=>{
 const f=await governedWorkspace(),restore=enable();let worker:ReturnType<typeof spawn>|null=null;try{
  await readWorkspaceDashboardData(f.actor,f.workspace.id,f.viewId,{});const row=await db.dashboardQueryCache.findFirstOrThrow({where:{workspaceId:f.workspace.id}});
  await db.dashboardQueryCache.update({where:{id:row.id},data:{createdAt:new Date(Date.now()-120000),expiresAt:new Date(Date.now()-60000)}});
  const prior=await db.dashboardWorkerHeartbeat.findMany({select:{id:true}});worker=spawn(process.execPath,['--import','tsx','src/worker/service.ts'],{env:{...process.env,DASHBOARD_WORKER_POLL_MS:'100'},stdio:'ignore'});const exited=once(worker,'exit');
  const deadline=Date.now()+10000;let id:string|null=null;while(Date.now()<deadline){const beat=await db.dashboardWorkerHeartbeat.findFirst({where:{id:{notIn:prior.map(r=>r.id)},stopping:false}});if(beat){assert.ok(beat.capabilities.includes('QUERY_CACHE'));id=beat.id;break;}if(worker.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,30));}assert.ok(id);assert.equal(await db.dashboardQueryCache.count({where:{id:row.id}}),0);
  worker.kill('SIGTERM');await exited;assert.equal(worker.exitCode,0);worker=null;
  await readWorkspaceDashboardData(f.actor,f.workspace.id,f.viewId,{});assert.equal(await pruneExpiredQueryCache(queryCacheSettings()!),0);
 }finally{if(worker&&worker.exitCode===null){const stopped=once(worker,'exit');worker.kill('SIGTERM');await stopped;}restore();await f.cleanup();}
});
