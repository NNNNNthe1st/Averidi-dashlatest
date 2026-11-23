import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {rename} from 'node:fs/promises';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {saveTarget} from '../src/features/monitoring/service';
import {mutateWorkspaceRole,listWorkspaceRoles} from '../src/features/permissions/service';
import {dashboardStorageKey,dashboardStoragePath} from '../src/server/storage';
after(()=>db.$disconnect());
const range={filters:[{type:'DATE_RANGE',field:'day',value:'2026-01-01',end:'2026-01-02'}],compare:false};
const goal=(f:Awaited<ReturnType<typeof governedWorkspace>>,value=500)=>({datasetId:f.dataset.id,metricKey:'REVENUE',name:'Revenue goal',value,start:'2026-01-01',through:'2026-01-02'});
test('KPI target annotations require exact unsegmented period, current definition, dataset and currency',async()=>{
 const f=await governedWorkspace();try{
  const target=await saveTarget(f.actor,f.workspace.id,goal(f));
  assert.deepEqual((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{})).targets.items,[]);
  const result=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,range);assert.equal(result.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);assert.deepEqual(result.targets.items,[{id:target.id,name:'Revenue goal',metricKey:'REVENUE',value:'500',currency:'USD',start:'2026-01-01',through:'2026-01-02',observedThrough:'2026-01-02'}]);
  const partial=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{...range,compare:true,comparison:{mode:'PREVIOUS_PERIOD',through:'2026-01-01'}});assert.equal(partial.targets.items[0].through,'2026-01-02');assert.equal(partial.targets.items[0].observedThrough,'2026-01-01');assert.equal(partial.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,100);
  for(const query of [{filters:[...range.filters,{type:'CATEGORY',field:'channel',value:'Web'}],compare:false},{filters:[{...range.filters[0],end:'2026-01-03'}],compare:false}])assert.equal((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,query)).targets.items.length,0);
  await db.dashboardTarget.update({where:{id:target.id},data:{currency:'EUR'}});assert.equal((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,range)).targets.items.length,0);
  await db.dashboardTarget.update({where:{id:target.id},data:{currency:'USD',definitionVersion:'wrong-definition'}});assert.equal((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,range)).targets.items.length,0);
  await assert.rejects(readWorkspaceDashboardData(f.reader,f.foreign.id,f.viewId,range),/FORBIDDEN/);
 }finally{await f.cleanup();}
});
test('mutable goal edits are fresh on a signed warm cache hit without rereading source bytes',async()=>{
 const f=await governedWorkspace(),keys=['DASHBOARD_QUERY_CACHE_ENABLED','DASHBOARD_QUERY_CACHE_KEY','DASHBOARD_QUERY_CACHE_TTL_SECONDS','DASHBOARD_QUERY_CACHE_MAX_ENTRIES'],prior=keys.map(key=>[key,process.env[key]]),file=dashboardStoragePath(dashboardStorageKey(f.workspace.id,f.dataset.id,f.versionId));let moved=false;
 try{Object.assign(process.env,{DASHBOARD_QUERY_CACHE_ENABLED:'true',DASHBOARD_QUERY_CACHE_KEY:'66'.repeat(32),DASHBOARD_QUERY_CACHE_TTL_SECONDS:'300',DASHBOARD_QUERY_CACHE_MAX_ENTRIES:'32'});
  const target=await saveTarget(f.actor,f.workspace.id,goal(f));assert.equal((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,range)).targets.items[0].value,'500');assert.ok(await db.dashboardQueryCache.count({where:{workspaceId:f.workspace.id}}));
  await saveTarget(f.actor,f.workspace.id,goal(f,600),{id:target.id,expectedRevision:target.revision});await rename(file,file+'.target-test');moved=true;
  const warm=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,range);assert.equal(warm.targets.items[0].value,'600');assert.equal(warm.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);
 }finally{if(moved)await rename(file+'.target-test',file);for(const [key,value] of prior){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}await f.cleanup();}
});
test('chart-only custom permission cannot expose monitoring targets and bounded annotations disclose truncation',async()=>{
 const f=await governedWorkspace();try{
  const target=await saveTarget(f.actor,f.workspace.id,goal(f));const row=await db.dashboardTarget.findUniqueOrThrow({where:{id:target.id}});
  await db.dashboardTarget.createMany({data:Array.from({length:100},(_,i)=>({workspaceId:f.workspace.id,datasetId:f.dataset.id,metricId:row.metricId,name:'Additional goal '+i,value:500,currency:row.currency,definitionVersion:row.definitionVersion,periodStart:row.periodStart,periodEnd:row.periodEnd}))});
  const allowed=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,range);assert.equal(allowed.targets.items.length,100);assert.equal(allowed.targets.hasMore,true);
  await mutateWorkspaceRole(f.actor,f.workspace.id,{action:'CREATE',name:'Chart reader',permissions:['workspace.read','datasets.read','analysis.read','views.read']});const model=await listWorkspaceRoles(f.actor,f.workspace.id),role=model.roles.find(r=>r.name==='Chart reader')!,member=model.members.find(m=>m.userId===f.reader.userId)!;
  await mutateWorkspaceRole(f.actor,f.workspace.id,{action:'ASSIGN',userId:f.reader.userId,roleId:role.id,expectedRoleUpdatedAt:role.updatedAt.toISOString(),expectedRevision:member.revision});const denied=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,range);assert.deepEqual(denied.targets,{items:[],hasMore:false});assert.equal(denied.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);
 }finally{await f.cleanup();}
});
