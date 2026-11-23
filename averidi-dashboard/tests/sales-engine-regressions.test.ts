import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDashboardRows} from '../src/engines/ingestion/ingest';
import {interpretSales,projectSalesData} from '../src/engines/sales/interpret';
import {analyzeDashboardData,type AnalysisQuery} from '../src/engines/analysis/pipeline';
import {generateDashboardConfig} from '../src/engines/generation/dashboard-templates';
import {buildDashboardWidgets} from '../src/engines/visualization/widgets';
import {salesSnapshotSchema,type SalesAnswers} from '../src/engines/sales/contracts';
const facts={discountsAlreadyApplied:true,refundsAlreadyApplied:true,taxExcluded:true,deliveryExcluded:true,costIsProductCost:true};
const evaluate=(rows:Record<string,string|number|null>[],answers:SalesAnswers=facts,query:AnalysisQuery={filters:[],compare:false})=>{const source=prepareDashboardRows(rows,[]),i=interpretSales(source,'test',answers),data=projectSalesData(source,i.projection),analysis=analyzeDashboardData(data,'test',i.confirmation,query);return {source,i,data,analysis};};
const metric=(a:ReturnType<typeof evaluate>['analysis'],key:string)=>a.outcomes.find(m=>m.key===key)!;
test('running totals and averages never become additive revenue automatically',()=>{
 for(const name of ['Cumulative Sales','Running Revenue','Average Sales','Sales per Customer','Closing Revenue Balance']){
  const v=evaluate([{'Order Date':'2026-01-01',[name]:100,Currency:'USD'},{'Order Date':'2026-01-02',[name]:150,Currency:'USD'}]);
  assert.notEqual(metric(v.analysis,'REVENUE').status,'READY',name);assert.equal(v.i.fields.find(f=>f.name===name)?.role,'CUSTOM');
 }
 const v=evaluate([{'Order ID':'1',Sales:10,'Cumulative Sales':100,Currency:'USD'}]);assert.equal(metric(v.analysis,'REVENUE').value,10);
});
test('price times quantity derives recorded sales, then applies only confirmed adjustments',()=>{
 const rows=[{'Order ID':'1',Quantity:2,'Unit Price':20,'Unit Cost':8,'Discount Amount':5,'Refund Amount':2,'Tax Amount':3,'Delivery Charge':4,Currency:'USD'}];
 const original=JSON.stringify(rows),v=evaluate(rows,{...facts,discountsAlreadyApplied:false,refundsAlreadyApplied:false,taxExcluded:false,deliveryExcluded:false});
 assert.equal(metric(v.analysis,'REVENUE').value,26);assert.equal(metric(v.analysis,'COST').value,16);assert.equal(metric(v.analysis,'PROFIT').value,10);assert.equal(JSON.stringify(rows),original);
 assert.ok(v.i.projection.revenueFromUnits);assert.equal(v.i.projection.netFromGross?.deductions.length,4);
 const perUnit=evaluate([{'Order ID':'1',Quantity:2,'Unit Price':20,'Cost per unit':8,Currency:'USD'}]);assert.equal(metric(perUnit.analysis,'COST').value,16);
 const cents=evaluate([{'Order ID':'1',Quantity:.1,'Unit Price':.2,Currency:'USD'}]);assert.equal(metric(cents.analysis,'REVENUE').value,.02);
});
test('a discount not yet deducted produces net sales, without deducting an included discount twice',()=>{
 const row={'Order ID':'1',Sales:100,'Discount Amount':10,Currency:'USD'};
 assert.equal(metric(evaluate([row],{...facts,discountsAlreadyApplied:false}).analysis,'REVENUE').value,90);
 assert.equal(metric(evaluate([row],facts).analysis,'REVENUE').value,100);
 const unknown=evaluate([row],{discountsAlreadyApplied:false});assert.notEqual(metric(unknown.analysis,'REVENUE').status,'READY');assert.ok(unknown.i.questions.some(q=>q.key==='refundsAlreadyApplied'));
 const missing=evaluate([{'Order ID':'1',Sales:100,Currency:'USD'}],{...facts,discountsAlreadyApplied:false});assert.notEqual(metric(missing.analysis,'REVENUE').status,'READY');assert.match(missing.i.warnings.join(' '),/discount amount/);assert.equal(metric(missing.analysis,'ORDERS').value,1);
});
test('completed-sales selection excludes cancelled and pending rows without modifying the source',()=>{
 const rows=[{'Order ID':'1',Sales:100,Currency:'USD',Status:'Completed'},{'Order ID':'2',Sales:20,Currency:'USD',Status:'Paid'},{'Order ID':'3',Sales:999,Currency:'USD',Status:'Cancelled'},{'Order ID':'4',Sales:999,Currency:'USD',Status:'Pending'}];
 const initial=evaluate(rows);assert.ok(initial.i.questions.some(q=>q.key==='excludeNonSalesStatuses'));
 const v=evaluate(rows,{...facts,excludeNonSalesStatuses:true});assert.equal(v.source.rows.length,4);assert.equal(v.data.rows.length,2);assert.equal(metric(v.analysis,'REVENUE').value,120);assert.equal(metric(v.analysis,'ORDERS').value,2);
 const unknown=evaluate([...rows,{'Order ID':'5',Sales:2,Currency:'USD',Status:'Unclassified'}],{...facts,excludeNonSalesStatuses:true});assert.notEqual(metric(unknown.analysis,'REVENUE').status,'READY');
});
test('currency queries and persisted currency selection measure one currency and preserve other records',()=>{
 const rows=[{'Order ID':'1',Sales:10,Currency:'USD'},{'Order ID':'2',Sales:20,Currency:'EUR'}],v=evaluate(rows);
 assert.notEqual(metric(v.analysis,'REVENUE').status,'READY');assert.ok(v.i.questions.some(q=>q.key==='reportingCurrency'&&q.options?.includes('EUR')));
 const usd=analyzeDashboardData(v.data,'test',v.i.confirmation,{filters:[{type:'CATEGORY',field:'Currency',value:'USD'}],compare:false});assert.equal(metric(usd,'REVENUE').value,10);assert.equal(metric(usd,'REVENUE').lineage.currency,'USD');
 const eur=evaluate(rows,{...facts,reportingCurrency:'EUR'});assert.equal(eur.data.rows.length,1);assert.equal(eur.source.rows.length,2);assert.equal(metric(eur.analysis,'REVENUE').value,20);assert.deepEqual(eur.i.availableCurrencies,['EUR','USD']);
 assert.ok(salesSnapshotSchema.safeParse({version:1,confirmation:eur.i.confirmation,answers:{...facts,reportingCurrency:'EUR'},projection:eur.i.projection}).success);
});
test('date selection cannot compare or accumulate another currency as though it were the selected currency',()=>{
 const rows=[{'Order ID':'1','Order Date':'2026-01-01',Sales:100,Currency:'EUR','Customer ID':'C1'},{'Order ID':'2','Order Date':'2026-02-01',Sales:20,Currency:'USD','Customer ID':'C1'}];
 const v=evaluate(rows,{...facts,salesHistory:true,customerHistory:true},{filters:[{type:'DATE_RANGE',field:'Order Date',value:'2026-02-01',end:'2026-02-01'}],compare:true,comparison:{mode:'PREVIOUS_MONTH'}});
 assert.equal(metric(v.analysis,'REVENUE').value,20);assert.equal(metric(v.analysis,'SALES_CUMULATIVE').value,20);assert.equal(v.analysis.comparison?.REVENUE.previous,null);assert.equal(metric(v.analysis,'OBSERVED_CUSTOMER_VALUE').value,20);
});
test('Sales charts enforce category budgets on the filtered population and keep matching prior rows',()=>{
 const rows=Array.from({length:101},(_,n)=>({'Order ID':'O'+n,Category:'Category '+n,Sales:10,Cost:4,Currency:'USD'}));
 const v=evaluate(rows),definition=generateDashboardConfig('SALES',v.analysis.outcomes,'test',false,false,false,v.analysis.dimensions);
 const broad=buildDashboardWidgets(definition,v.data,'test',v.i.confirmation,{filters:[],compare:false});assert.equal(metric(broad.analysis,'REVENUE').value,1010);assert.match(broad.widgets.find(w=>w.id==='sales-revenue-category')?.outcome.reason??'',/101 groups/);
 const data=buildDashboardWidgets(definition,v.data,'test',v.i.confirmation,{filters:[{type:'CATEGORY',field:'Category',value:'Category 0'}],compare:false});assert.equal(metric(data.analysis,'REVENUE').value,10);assert.equal(data.widgets.find(w=>w.id==='sales-revenue-category')?.series.length,1);
 const dated=evaluate([{'Order ID':'A','Order Date':'2026-02-01',Category:'A',Sales:10,Currency:'USD'},{'Order ID':'B','Order Date':'2026-01-01',Category:'A',Sales:5,Currency:'USD'}]);
 const d=generateDashboardConfig('SALES',dated.analysis.outcomes,'test',false,false,false,dated.analysis.dimensions),q:AnalysisQuery={filters:[{type:'CATEGORY',field:'Category',value:'A'},{type:'DATE_RANGE',field:'Order Date',value:'2026-02-01',end:'2026-02-01'}],compare:true,comparison:{mode:'PREVIOUS_MONTH'}};
 const compared=buildDashboardWidgets(d,dated.data,'test',dated.i.confirmation,q);assert.equal(compared.widgets.find(w=>w.id==='sales-revenue-category')?.series[0].comparison?.previous,5);
});
test('top-customer budgets ignore customers outside the selected population',()=>{
 const rows=Array.from({length:5001},(_,n)=>({'Order ID':'O'+n,'Customer ID':'C'+n,Sales:10,Currency:'USD'}));
 const query:AnalysisQuery={filters:[{type:'CATEGORY',field:'Customer ID',value:'C0'}],compare:false},v=evaluate(rows,facts,query),def=generateDashboardConfig('SALES',v.analysis.outcomes,'test',false,false,false,v.analysis.dimensions);
 const data=buildDashboardWidgets(def,v.data,'test',v.i.confirmation,query);assert.equal(data.widgets.find(w=>w.id==='sales-top-customers')?.series.length,1);
});
test('decimal period metrics reconcile with core revenue through large credits and reversals',()=>{
 const v=evaluate([{'Order ID':'1','Order Date':'2026-01-01',Sales:100000000000000,Currency:'USD'},{'Order ID':'2','Order Date':'2026-01-02',Sales:.01,Currency:'USD'},{'Order ID':'3','Order Date':'2026-01-03',Sales:-100000000000000,Currency:'USD'}],{...facts,salesHistory:true});
 for(const key of ['REVENUE','SALES_MTD','SALES_QTD','SALES_YTD','SALES_CUMULATIVE']){assert.equal(metric(v.analysis,key).value,.01,key);assert.equal(metric(v.analysis,key).lineage.exactValue,'0.01',key);}
});

test('the full public filter budget still allows an internal single-currency history scope',()=>{
 const labels=Object.fromEntries(Array.from({length:11},(_,n)=>['Dimension '+n,'same']));
 const rows=[{'Order ID':'1','Order Date':'2026-01-01',Sales:100,Currency:'EUR',...labels},{'Order ID':'2','Order Date':'2026-02-01',Sales:20,Currency:'USD',...labels}];
 const filters:AnalysisQuery['filters']=[...Object.keys(labels).map(field=>({type:'CATEGORY' as const,field,value:'same'})),{type:'DATE_RANGE',field:'Order Date',value:'2026-02-01',end:'2026-02-01'}];
 const v=evaluate(rows,facts,{filters,compare:true,comparison:{mode:'PREVIOUS_MONTH'}});assert.equal(metric(v.analysis,'REVENUE').value,20);assert.equal(v.analysis.comparison?.REVENUE.previous,null);
});
