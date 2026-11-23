import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {analysisConfirmationSchema,analyzeDashboardData,retainedTextFields} from '../src/engines/analysis/pipeline';
import {buildDashboardWidgets} from '../src/engines/visualization/widgets';
import {generateDashboardConfig} from '../src/engines/generation/dashboard-templates';
import {normalizeBusinessUnits,unitRulesSchema} from '../src/engines/metrics/units';
import {targetPace} from '../src/engines/metrics/target-pace';
import {targetSchema} from '../src/features/monitoring/contracts';
import {evaluateFormula} from '../src/features/custom-metrics/formula';
import {validateGovernedDefinition} from '../src/features/analysis/views';
const confirmation=analysisConfirmationSchema.parse({confirmedMappings:[['id','ORDER'],['customer','CUSTOMER'],['product','PRODUCT'],['revenue','REVENUE'],['cost','COST'],['quantity','QUANTITY'],['day','TIME']].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept})),metricRules:{versionId:'v1',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',timezone:'America/New_York',customerHistoryConfirmed:true}});
const csv='id,customer,product,revenue,cost,quantity,day\n001,A,X,100,60,1000,2026-01-01\n002,B,Y,80,20,2000,2026-01-02\n003,A,X,50,30,500,2026-01-03\n004,C,Y,120,40,1500,2026-01-03\n005,A,Y,30,10,1000,2026-01-04\n';
const query={filters:[{type:'DATE_RANGE' as const,field:'day',value:'2026-01-03',end:'2026-01-04'}],compare:false};
async function fixture(){return prepareDashboardFile({bytes:Buffer.from(csv),fileName:'business.csv',preserveTextFields:retainedTextFields(confirmation)});}
const values=(r:ReturnType<typeof analyzeDashboardData>)=>Object.fromEntries(r.outcomes.map(m=>[m.key,m.value]));
test('100: explicit dimensional conversion, case packaging, compatible returns and unchanged source',()=>{
 const row={sold:2500,returned:500,minutes:90,cases:3};const mappings=[{sourceField:'sold',canonicalConcept:'QUANTITY'},{sourceField:'returned',canonicalConcept:'RETURN_QUANTITY'},{sourceField:'minutes',canonicalConcept:'OPERATIONS_HOURS'},{sourceField:'cases',canonicalConcept:'INVENTORY_ON_HAND'}];
 const r=normalizeBusinessUnits([row],mappings,{sold:{unit:'G'},returned:{unit:'G'},minutes:{unit:'MINUTE'},cases:{unit:'CASE',itemsPerCase:12}});assert.deepEqual(r.rows,[{sold:2.5,returned:.5,minutes:1.5,cases:36}]);assert.equal(row.sold,2500);assert.equal(r.units.get('QUANTITY'),'kg');assert.equal(normalizeBusinessUnits([row],mappings,{cases:{unit:'CASE'}}).units.get('INVENTORY_ON_HAND'),'cases');
 assert.throws(()=>normalizeBusinessUnits([row],mappings,{sold:{unit:'KG'},returned:{unit:'ITEM'}}),/INCOMPATIBLE_UNIT/);assert.throws(()=>normalizeBusinessUnits([row],mappings,{minutes:{unit:'KG'}}),/INCOMPATIBLE_UNIT/);assert.throws(()=>normalizeBusinessUnits([{sold:-1}],mappings.filter(m=>m.sourceField==='sold'),{sold:{unit:'KG'}}),/INVALID_UNIT_VALUE/);assert.equal(unitRulesSchema.safeParse({sold:{unit:'KG',itemsPerCase:12}}).success,false);
});
test('100: canonical units reach engine lineage, price and dimensional formula safeguards without changing legacy revenue',async()=>{
 const p=await fixture(),legacy=analyzeDashboardData(p,'v1',confirmation),c=structuredClone(confirmation);c.metricRules.units={quantity:{unit:'G'}};const r=analyzeDashboardData(p,'v1',c);assert.equal(values(r).UNITS,6);assert.equal(values(r).REVENUE,values(legacy).REVENUE);assert.equal(r.outcomes.find(m=>m.key==='UNITS')?.lineage.unit,'kg');assert.equal(values(r).AVERAGE_UNIT_PRICE,380/6);assert.notEqual(r.outcomes[0].lineage.definitionVersion,legacy.outcomes[0].lineage.definitionVersion);assert.throws(()=>evaluateFormula('UNITS + ORDERS',r.outcomes,'NUMBER'),/UNIT_MISMATCH/);assert.deepEqual(evaluateFormula('REVENUE / UNITS',r.outcomes,'CURRENCY').units,{USD:1,kg:-1});
 const stock=await prepareDashboardFile({bytes:Buffer.from('product,stock,demand\nA,500,1000\n'),fileName:'stock.csv',preserveTextFields:['product']}),inventory=structuredClone(confirmation);inventory.confirmedMappings=[{sourceField:'product',canonicalConcept:'PRODUCT'},{sourceField:'stock',canonicalConcept:'INVENTORY_ON_HAND'},{sourceField:'demand',canonicalConcept:'INVENTORY_DEMAND'}];Object.assign(inventory.metricRules,{grain:'PRODUCT',units:{stock:{unit:'G'},demand:{unit:'G'}},inventorySnapshotConfirmed:true,inventorySnapshotUniqueProducts:true,inventoryDemandPeriodDays:2,inventoryLeadTimeDays:2,inventorySafetyDays:0});const quantities=values(analyzeDashboardData(stock,'v1',inventory));assert.equal(quantities.INVENTORY_STOCK_ON_HAND,.5);assert.equal(quantities.INVENTORY_REORDER_GAP,.5);

});
test('149: complete-history acquisition, actual repeat orders, adjacent-period cohort retention and observed customer value',async()=>{
 const r=analyzeDashboardData(await fixture(),'v1',confirmation,query),v=values(r);assert.equal(v.NEW_CUSTOMERS,1);assert.equal(v.REPEAT_CUSTOMERS,1);assert.equal(v.REPEAT_PURCHASE_RATE,.5);assert.equal(v.RETAINED_CUSTOMERS,1);assert.equal(v.CUSTOMER_RETENTION_RATE,.5);assert.equal(v.OBSERVED_CUSTOMER_VALUE,150);assert.equal(v.REVENUE,200);assert.equal(values(analyzeDashboardData(await fixture(),'v1',confirmation,{...query,filters:[...query.filters,{type:'DATE_RANGE',field:'day',value:'2026-01-04',end:'2026-01-04'}]})).CUSTOMER_RETENTION_RATE,null);
 const noConsent=structuredClone(confirmation);noConsent.metricRules.customerHistoryConfirmed=false;assert.equal(values(analyzeDashboardData(await fixture(),'v1',noConsent,query)).CUSTOMER_RETENTION_RATE,null);
});
test('149: period-dependent widgets persist transparently and invalid identities refuse customer attribution',async()=>{
 const p=await fixture(),r=analyzeDashboardData(p,'v1',confirmation),config=generateDashboardConfig('CUSTOMER',r.outcomes);assert.ok(config.widgets.some(w=>w.metricKey==='CUSTOMER_RETENTION_RATE'));assert.doesNotThrow(()=>validateGovernedDefinition(config,r));assert.equal(r.outcomes.find(m=>m.key==='CUSTOMER_RETENTION_RATE')?.requiresPeriod,true);
 const bad={...p,rows:[...p.rows,{...p.rows[0],customer:'conflict'}]},c=structuredClone(confirmation);c.metricRules.grain='RECORD';assert.equal(values(analyzeDashboardData(bad,'v1',c,query)).REPEAT_CUSTOMERS,null);
});
test('151: native product charts retain full denominator, governed gross profit and exact contribution',async()=>{
 const p=await fixture(),r=analyzeDashboardData(p,'v1',confirmation),config=generateDashboardConfig('PRODUCT',r.outcomes),data=buildDashboardWidgets(config,p,'v1',confirmation,{filters:[],compare:false});assert.ok(config.widgets.every(w=>w.kind==='BAR'&&w.dimensionField==='product'));
 const revenue=data.widgets.find(w=>w.metricKey==='PRODUCT_REVENUE_SHARE')!,profit=data.widgets.find(w=>w.metricKey==='PRODUCT_PROFIT_SHARE')!;assert.deepEqual(revenue.series.map(p=>p.value),[150/380,230/380]);assert.deepEqual(profit.series.map(p=>p.value),[60/220,160/220]);
 const selected=analyzeDashboardData(p,'v1',confirmation,{filters:[...query.filters,{type:'CATEGORY',field:'product',value:'X'}],compare:false});assert.equal(values(selected).PRODUCT_REVENUE_SHARE,.25);assert.equal(values(selected).PRODUCT_PROFIT_SHARE,20/120);
});
test('143: explicit linear pace handles direction, dates, equality, final status and unavailable assumptions',()=>{
 const base={value:50,target:100,start:'2026-01-01',through:'2026-01-10',observedThrough:'2026-01-05',direction:'HIGHER',pacing:'LINEAR',metricKey:'REVENUE'};
 assert.equal(targetPace(base).code,'ON_TRACK');assert.equal(targetPace({...base,value:60}).code,'AHEAD');assert.equal(targetPace({...base,value:40}).code,'BEHIND');assert.equal(targetPace({...base,direction:'LOWER',value:40}).code,'AHEAD');assert.equal(targetPace({...base,observedThrough:'2026-01-10',value:99}).code,'MISSED');assert.equal(targetPace({...base,observedThrough:'2026-01-10',value:100}).code,'MET');
 for(const change of [{observedThrough:null},{direction:null},{pacing:'NONE'},{metricKey:'GROSS_MARGIN'},{observedThrough:'2026-02-30'},{value:NaN}])assert.equal(targetPace({...base,...change}).code,'UNAVAILABLE');
 assert.equal(targetSchema.safeParse({name:'Ratio',metricKey:'GROSS_MARGIN',datasetId:'dataset',value:.2,start:base.start,through:base.through,pacing:'LINEAR',direction:'HIGHER'}).success,false);
});

import {after} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {confirmWorkspaceDatasetFields,confirmWorkspaceDatasetMetricRules} from '../src/features/datasets/service';
import {dashboardStorageKey,writeDashboardObject} from '../src/server/storage';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {saveTarget} from '../src/features/monitoring/service';
import {updateWorkspaceView} from '../src/features/views/service';
after(()=>db.$disconnect());
test('100/149/151: native worker stores explicit units and history consent, generates both dashboards, filters and preserves tenant boundaries',async()=>{
 const f=await governedWorkspace();try{
  const dataset=await db.dashboardDataset.create({data:{workspaceId:f.workspace.id,name:'Customer and product purchases'}}),versionId=randomUUID(),bytes=Buffer.from(csv),key=dashboardStorageKey(f.workspace.id,dataset.id,versionId);await writeDashboardObject(key,bytes);await db.dashboardDatasetVersion.create({data:{id:versionId,datasetId:dataset.id,version:1,status:'PENDING',sourceFormat:'CSV',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex')}});await f.run('DATASET_INGEST',{datasetId:dataset.id,versionId,format:'csv'});
  assert.equal((await confirmWorkspaceDatasetFields(f.actor,f.workspace.id,dataset.id,{versionId,mappings:confirmation.confirmedMappings})).ok,true);
  const rules={...confirmation.metricRules,versionId,units:{quantity:{unit:'G'}}};assert.equal((await confirmWorkspaceDatasetMetricRules(f.actor,f.workspace.id,dataset.id,rules)).ok,true);
  assert.equal((await confirmWorkspaceDatasetMetricRules(f.reader,f.workspace.id,dataset.id,rules)).ok,false);
  assert.equal((await confirmWorkspaceDatasetMetricRules(f.actor,f.workspace.id,dataset.id,{...rules,units:{revenue:{unit:'KG'}}})).ok,false);
  const version=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:versionId}}),analysis=await f.run('METRICS_CALCULATE',{datasetId:dataset.id,versionId,semanticRevision:version.semanticRevision});
  const customer=await f.run('DASHBOARD_GENERATE',{datasetId:dataset.id,analysisId:analysis.analysisId,template:'CUSTOMER'}),product=await f.run('DASHBOARD_GENERATE',{datasetId:dataset.id,analysisId:analysis.analysisId,template:'PRODUCT'});
  const customers=await readWorkspaceDashboardData(f.reader,f.workspace.id,customer.viewId,query);assert.equal(customers.analysis.outcomes.find(m=>m.key==='CUSTOMER_RETENTION_RATE')?.value,.5);
  const products=await readWorkspaceDashboardData(f.reader,f.workspace.id,product.viewId,{filters:[],compare:false});assert.deepEqual(products.widgets.find(w=>w.metricKey==='UNITS')?.series.map(p=>p.value),[1.5,4.5]);assert.deepEqual(products.widgets.find(w=>w.metricKey==='PRODUCT_REVENUE_SHARE')?.series.map(p=>p.value),[150/380,230/380]);
  await assert.rejects(readWorkspaceDashboardData(f.reader,f.foreign.id,product.viewId,query),/FORBIDDEN/);
 }finally{await f.cleanup();}
});
test('143/181: persisted target pace reaches native KPI, existing revisions refuse stale concurrent saves and return the committed token',async()=>{
 const f=await governedWorkspace();try{
  const goal=await saveTarget(f.actor,f.workspace.id,{datasetId:f.dataset.id,name:'Uniform revenue goal',metricKey:'REVENUE',value:600,start:'2026-01-01',through:'2026-01-02',direction:'HIGHER',pacing:'LINEAR'});assert.equal(goal.direction,'HIGHER');assert.equal(goal.pacing,'LINEAR');
  const data=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{filters:[{type:'DATE_RANGE',field:'day',value:'2026-01-01',end:'2026-01-02'}],compare:true,comparison:{mode:'PREVIOUS_PERIOD',through:'2026-01-01'}});assert.equal(data.targets.items[0].pace?.code,'BEHIND');assert.equal(data.targets.items[0].pace?.expected,300);
  const view=await db.dashboardView.findUniqueOrThrow({where:{id:f.viewId}}),definition=view.definition as unknown as ReturnType<typeof generateDashboardConfig>;
  const results=await Promise.all(['First editor','Second editor'].map(name=>updateWorkspaceView(f.actor,f.workspace.id,f.viewId,{...definition,name},view.updatedAt.toISOString())));assert.equal(results.filter(r=>r.ok).length,1);const winner=results.find(r=>r.ok)!;assert.ok(winner.ok);assert.equal((await db.dashboardView.findUniqueOrThrow({where:{id:f.viewId}})).updatedAt.toISOString(),winner.updatedAt);assert.notEqual(winner.updatedAt,view.updatedAt.toISOString());assert.equal((await updateWorkspaceView(f.reader,f.workspace.id,f.viewId,definition,winner.updatedAt)).ok,false);
 }finally{await f.cleanup();}
});
