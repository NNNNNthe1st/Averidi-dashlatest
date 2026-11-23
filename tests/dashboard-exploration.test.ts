import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {listFilterPresets,saveFilterPreset,removeFilterPreset,readDrilldownRecords,matchingSourceRows} from '../src/features/views/exploration';
import {chartDrilldownQuery} from '../src/engines/visualization/drilldown';
import {confirmWorkspaceDatasetMetricRules} from '../src/features/datasets/service';
import {POST as presetRoute} from '../src/app/api/workspaces/[workspaceId]/views/[viewId]/presets/route';
after(()=>db.$disconnect());
test('chart drilldown retains filters and handles confirmed business-calendar dates',()=>{
 const query=chartDrilldownQuery({filters:[{type:'CATEGORY',field:'channel',value:'Web'}],compare:false},'day','DATE','2026-01-01');
 assert.equal(query.filters.length,2);assert.equal(query.filters[1].end,'2026-01-01');
 assert.deepEqual(matchingSourceRows([{channel:'Web',day:'2026-01-02T02:00:00Z'},{channel:'Web',day:'2026-01-02T16:00:00Z'},{channel:'Shop',day:'2026-01-01'}],query,'America/New_York'),[{channel:'Web',day:'2026-01-02T02:00:00Z'}]);
 assert.throws(()=>chartDrilldownQuery(query,'channel','DIMENSION','(Missing)'));
 assert.throws(()=>chartDrilldownQuery({filters:Array(12).fill(query.filters[0]),compare:false},'channel','DIMENSION','Web'));
});
test('private saved filters and record inspection preserve identity, tenant and source-version boundaries',async()=>{
 const f=await governedWorkspace();try{
  const query={filters:[{type:'CATEGORY' as const,field:'channel',value:'Web'}],compare:false},preset=await saveFilterPreset(f.reader,f.workspace.id,f.viewId,{name:'My web records',query});
  assert.equal((await listFilterPresets(f.reader,f.workspace.id,f.viewId)).length,1);assert.equal((await listFilterPresets(f.actor,f.workspace.id,f.viewId)).length,0);
  assert.equal((await removeFilterPreset(f.actor,f.workspace.id,f.viewId,preset.id)).removed,false);
  const detail=await readDrilldownRecords(f.reader,f.workspace.id,f.viewId,{query});assert.equal(detail.total,1);assert.equal(detail.rows[0].id,'001');assert.equal(detail.rows[0].amount,100);assert.equal(detail.nextOffset,null);
  await assert.rejects(readDrilldownRecords(f.actor,f.foreign.id,f.viewId,{query}),/NOT_FOUND/);
  await assert.rejects(saveFilterPreset(f.actor,f.workspace.id,f.viewId,{name:'Unknown',query:{filters:[{type:'CATEGORY',field:'private',value:'x'}]}}),/UNCONFIRMED_FILTER/);
  assert.equal((await presetRoute(new Request('https://dashboard.test',{method:'POST',headers:{origin:'https://foreign.invalid'},body:'{}'}),{params:Promise.resolve({workspaceId:f.workspace.id,viewId:f.viewId})})).status,403);
  await confirmWorkspaceDatasetMetricRules(f.actor,f.workspace.id,f.dataset.id,f.rules);
  await assert.rejects(readDrilldownRecords(f.actor,f.workspace.id,f.viewId,{query}),/STALE_ANALYSIS/);
  assert.equal((await removeFilterPreset(f.reader,f.workspace.id,f.viewId,preset.id)).removed,true);
 }finally{await f.cleanup();}
});
