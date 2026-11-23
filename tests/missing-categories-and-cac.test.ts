import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {analyzeDashboardData,analysisConfirmationSchema,analysisQuerySchema,retainedTextFields,type AnalysisConfirmation} from '../src/engines/analysis/pipeline';
import {generateDashboardConfig,addDashboardWidget,type DashboardConfig} from '../src/engines/generation/dashboard-templates';
import {buildDashboardWidgets} from '../src/engines/visualization/widgets';
import {chartDrilldownQuery} from '../src/engines/visualization/drilldown';
import {exportDashboardMetricReport} from '../src/engines/reporting/metric-report';
import {governedWorkspace} from './fixtures/governed-workspace';
import {confirmWorkspaceDatasetFields,confirmWorkspaceDatasetMetricRules} from '../src/features/datasets/service';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {updateWorkspaceView} from '../src/features/views/service';
import {readDrilldownRecords,saveFilterPreset,listFilterPresets} from '../src/features/views/exploration';
import {writeDashboardObject,dashboardStorageKey} from '../src/server/storage';
import {evaluateFormula} from '../src/features/custom-metrics/formula';
after(()=>db.$disconnect());
const base=analysisConfirmationSchema.parse({confirmedMappings:[{sourceField:'id',canonicalConcept:'ORDER'},{sourceField:'amount',canonicalConcept:'REVENUE'},{sourceField:'channel',canonicalConcept:'CHANNEL'}],metricRules:{versionId:'v',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'}});
const missingRows=[{id:'001',amount:100,channel:null},{id:'002',amount:200,channel:'(Missing)'},{id:'003',amount:300,channel:'Web'}];
const marketingRows=[{campaign:'Search',spend:100,acquired:4,attributed:400},{campaign:'Social',spend:50,acquired:1,attributed:100}];
const marketing=analysisConfirmationSchema.parse({confirmedMappings:[{sourceField:'campaign',canonicalConcept:'CHANNEL'},{sourceField:'spend',canonicalConcept:'MARKETING_SPEND'},{sourceField:'acquired',canonicalConcept:'MARKETING_ACQUISITIONS'},{sourceField:'attributed',canonicalConcept:'ATTRIBUTED_REVENUE'}],metricRules:{...base.metricRules,grain:'RECORD',marketingAttribution:'SOURCE_REPORTED',marketingSpendDeduplicated:true,marketingAcquisitionsConfirmed:true}});
async function prepare(rows:unknown,confirmation:AnalysisConfirmation){return prepareDashboardFile({bytes:Buffer.from(JSON.stringify(rows)),fileName:'fixture.json',preserveTextFields:retainedTextFields(confirmation)});}
test('missing categories and a real category named (Missing) retain separate exact metrics, identifiers and typed filters',async()=>{
 const prepared=await prepare(missingRows,base),analysis=analyzeDashboardData(prepared,'v',base),config=addDashboardWidget(generateDashboardConfig('SALES',analysis.outcomes),'REVENUE','BAR','channel',analysis.outcomes,['channel']);
 const data=buildDashboardWidgets(config,prepared,'v',base,{filters:[],compare:false}),groups=data.widgets.at(-1)!.series;assert.equal(groups.length,3);assert.equal(new Set(groups.map(g=>g.groupKey)).size,3);
 const absent=groups.find(g=>g.missing)!,literal=groups.find(g=>g.label==='(Missing)'&&!g.missing)!;assert.equal(absent.value,100);assert.equal(literal.value,200);
 const missingQuery=chartDrilldownQuery({filters:[],compare:false},'channel','DIMENSION',absent.label,true),literalQuery=chartDrilldownQuery({filters:[],compare:false},'channel','DIMENSION',literal.label,false);
 assert.equal(analyzeDashboardData(prepared,'v',base,missingQuery).outcomes.find(m=>m.key==='REVENUE')?.value,100);assert.equal(analyzeDashboardData(prepared,'v',base,literalQuery).outcomes.find(m=>m.key==='REVENUE')?.value,200);
 assert.equal(analysisQuerySchema.safeParse({filters:[{type:'MISSING',field:'channel',value:'Web'}]}).success,false);assert.equal(analysisQuerySchema.safeParse({filters:[{type:'MISSING',field:'channel',value:'',end:'2026-01-01'}]}).success,false);
 assert.match(exportDashboardMetricReport({...data,analysisId:'run',versionId:'v',sourceChecksum:'sum'}),/Missing group/);
});
test('drilling down never broadens an explicitly observed partial period',()=>{
 const query=analysisQuerySchema.parse({filters:[{type:'DATE_RANGE',field:'day',value:'2026-01-01',end:'2026-01-31'}],compare:true,comparison:{mode:'PREVIOUS_MONTH',through:'2026-01-02'}});
 for(const missing of [false,true]){const next=chartDrilldownQuery(query,'channel','DIMENSION',missing?'(Missing)':'Web',missing);assert.equal(next.filters[0].end,'2026-01-02');assert.equal(next.compare,false);}
});
test('marketing CAC uses confirmed non-overlapping new-customer counts and recomputes grouped ratios',async()=>{
 const prepared=await prepare(marketingRows,marketing),result=analyzeDashboardData(prepared,'v',marketing),cac=result.outcomes.find(m=>m.key==='MARKETING_CAC')!;assert.equal(cac.value,30);assert.equal(cac.definition.format,'CURRENCY');assert.deepEqual(cac.lineage.fields,['spend','acquired']);
 const config=addDashboardWidget(generateDashboardConfig('MARKETING',result.outcomes),'MARKETING_CAC','BAR','campaign',result.outcomes,['campaign']),groups=buildDashboardWidgets(config,prepared,'v',marketing,{filters:[],compare:false}).widgets.at(-1)!.series;
 assert.deepEqual(groups.map(g=>[g.label,g.value]),[['Search',25],['Social',50]]);assert.notEqual(cac.value,groups.reduce((n,g)=>n+g.value!,0)/groups.length);
 const legacy=structuredClone(marketing);delete legacy.metricRules.marketingAcquisitionsConfirmed;const old=analyzeDashboardData(prepared,'v',legacy);assert.equal(old.outcomes.find(m=>m.key==='MARKETING_CAC')?.status,'NEEDS_CONFIRMATION');assert.deepEqual(old.outcomes.find(m=>m.key==='MARKETING_ROI'),result.outcomes.find(m=>m.key==='MARKETING_ROI'));
 assert.throws(()=>evaluateFormula('MARKETING_SPEND + MARKETING_CAC',result.outcomes,'CURRENCY'),/CUSTOM_METRIC_UNIT_MISMATCH/);assert.deepEqual(evaluateFormula('MARKETING_CAC * 2',result.outcomes,'CURRENCY').units,{USD:1,acquired_customers:-1});
});
test('CAC refuses inferred attribution, repeated spend, fractional/negative/unsafe counts, mixed currency and zero acquisitions',async()=>{
 const prepared=await prepare(marketingRows,marketing);
 for(const changes of [{marketingAttribution:'UNCONFIRMED'},{marketingSpendDeduplicated:false},{marketingAcquisitionsConfirmed:false},{currencyMode:'MULTI',currency:null}]){const copy=analysisConfirmationSchema.parse({...marketing,metricRules:{...marketing.metricRules,...changes}});assert.equal(analyzeDashboardData(prepared,'v',copy).outcomes.find(m=>m.key==='MARKETING_CAC')?.status,'NEEDS_CONFIRMATION');}
 for(const count of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){const data=await prepare(marketingRows.map(row=>({...row,acquired:count})),marketing);assert.equal(analyzeDashboardData(data,'v',marketing).outcomes.find(m=>m.key==='MARKETING_CAC')?.status,'UNAVAILABLE');}
 const free=await prepare(marketingRows.map(row=>({...row,spend:0})),marketing);assert.equal(analyzeDashboardData(free,'v',marketing).outcomes.find(m=>m.key==='MARKETING_CAC')?.value,0);
});
test('actual worker/view/preset/source boundaries support missing groups and confirmed CAC without changing previous definitions',async()=>{
 const f=await governedWorkspace();try{
  async function seed(name:string,rows:unknown[],confirmation:AnalysisConfirmation,template:'SALES'|'MARKETING',key:'REVENUE'|'MARKETING_CAC',dimension:string){
   const source=await db.dashboardDataSource.create({data:{workspaceId:f.workspace.id,kind:'FILE',name}}),dataset=await db.dashboardDataset.create({data:{workspaceId:f.workspace.id,sourceId:source.id,name}}),versionId=randomUUID(),bytes=Buffer.from(JSON.stringify(rows)),storageKey=dashboardStorageKey(f.workspace.id,dataset.id,versionId);await writeDashboardObject(storageKey,bytes);
   await db.dashboardDatasetVersion.create({data:{id:versionId,datasetId:dataset.id,version:1,status:'PENDING',sourceFormat:'JSON',storageKey,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex')}});await f.run('DATASET_INGEST',{datasetId:dataset.id,versionId,format:'json'});
   assert.equal((await confirmWorkspaceDatasetFields(f.actor,f.workspace.id,dataset.id,{versionId,mappings:confirmation.confirmedMappings})).ok,true);assert.equal((await confirmWorkspaceDatasetMetricRules(f.actor,f.workspace.id,dataset.id,{...confirmation.metricRules,versionId})).ok,true);
   const version=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:versionId}}),analysis=await f.run('METRICS_CALCULATE',{datasetId:dataset.id,versionId,semanticRevision:version.semanticRevision}),view=await f.run('DASHBOARD_GENERATE',{datasetId:dataset.id,analysisId:analysis.analysisId,template}),record=await db.dashboardView.findUniqueOrThrow({where:{id:view.viewId}}),data=await readWorkspaceDashboardData(f.actor,f.workspace.id,view.viewId,{}),definition=addDashboardWidget(record.definition as DashboardConfig,key,'BAR',dimension,data.analysis.outcomes,[dimension]);
   assert.equal((await updateWorkspaceView(f.actor,f.workspace.id,view.viewId,definition,record.updatedAt.toISOString())).ok,true);return view.viewId;
  }
  const missingView=await seed('Missing categories',missingRows,base,'SALES','REVENUE','channel'),query=chartDrilldownQuery({filters:[],compare:false},'channel','DIMENSION','(Missing)',true);
  const current=await readWorkspaceDashboardData(f.reader,f.workspace.id,missingView,query);assert.equal(current.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,100);assert.equal((await readDrilldownRecords(f.reader,f.workspace.id,missingView,{query})).rows[0].id,'001');await saveFilterPreset(f.reader,f.workspace.id,missingView,{name:'Missing only',query});assert.deepEqual((await listFilterPresets(f.reader,f.workspace.id,missingView))[0].filters,query);
  const marketingView=await seed('CAC fixture',marketingRows,marketing,'MARKETING','MARKETING_CAC','campaign'),cac=await readWorkspaceDashboardData(f.reader,f.workspace.id,marketingView,{});assert.equal(cac.analysis.outcomes.find(m=>m.key==='MARKETING_CAC')?.value,30);assert.match(exportDashboardMetricReport(cac),/MARKETING_CAC/);
  await assert.rejects(readWorkspaceDashboardData(f.reader,f.foreign.id,marketingView,{}),/FORBIDDEN/);
 }finally{await f.cleanup();}
});
