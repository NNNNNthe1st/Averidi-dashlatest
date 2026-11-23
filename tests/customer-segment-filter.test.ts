import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {confirmWorkspaceDatasetFields,confirmWorkspaceDatasetMetricRules} from '../src/features/datasets/service';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {readDrilldownRecords} from '../src/features/views/exploration';
after(()=>db.$disconnect());
test('confirmed customer segment dimensions filter actual governed metrics and matching source records',async()=>{
 const f=await governedWorkspace();try{
  const version=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}}),mappings=(version.semantics as {confirmedMappings:{sourceField:string;canonicalConcept:string}[]}).confirmedMappings.map(m=>({sourceField:m.sourceField,canonicalConcept:m.sourceField==='channel'?'CUSTOMER_SEGMENT':m.canonicalConcept}));
  assert.equal((await confirmWorkspaceDatasetFields(f.actor,f.workspace.id,f.dataset.id,{versionId:f.versionId,mappings})).ok,true);
  assert.equal((await confirmWorkspaceDatasetMetricRules(f.actor,f.workspace.id,f.dataset.id,f.rules)).ok,true);
  const current=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}}),analysis=await f.run('METRICS_CALCULATE',{datasetId:f.dataset.id,versionId:f.versionId,semanticRevision:current.semanticRevision}),view=await f.run('DASHBOARD_GENERATE',{datasetId:f.dataset.id,analysisId:analysis.analysisId,template:'SALES'});
  const query={filters:[{type:'CATEGORY' as const,field:'channel',value:'Web'}],compare:false};
  const data=await readWorkspaceDashboardData(f.reader,f.workspace.id,view.viewId,query);assert.equal(data.analysis.dimensions.find(d=>d.field==='channel')?.role,'DIMENSION');assert.equal(data.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,100);assert.equal(data.analysis.quality.selectedRows,1);
  const records=await readDrilldownRecords(f.reader,f.workspace.id,view.viewId,{query});assert.equal(records.rows[0].id,'001');assert.equal(records.total,1);
  await assert.rejects(readWorkspaceDashboardData(f.reader,f.foreign.id,view.viewId,query),/FORBIDDEN/);
 }finally{await f.cleanup();}
});
