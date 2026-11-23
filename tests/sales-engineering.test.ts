import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {interpretSales,projectSalesData} from '../src/engines/sales/interpret';
import {analyzeDashboardData} from '../src/engines/analysis/pipeline';
import {discoverSalesKeys,salesDependency} from '../src/engines/sales/schema-inference';
import {compileSalesPlan,executeSalesPlan} from '../src/engines/metrics/sales-calculation-plan';
import {salesNumber} from '../src/engines/sales/source-values';
import {salesReadiness,salesPanelCapability} from '../src/engines/sales/capabilities';
const file=(rows:unknown[])=>prepareDashboardFile({bytes:Buffer.from(JSON.stringify(rows)),fileName:'independent-customer.json'});
const answers={recordedNet:true,costIsProductCost:true};
const amount=(a:ReturnType<typeof analyzeDashboardData>,key:string)=>a.outcomes.find(m=>m.key===key);
test('service event dates are selected from values and business context; shipping is separate',async()=>{
 const p=await file([{'Job Number':'J1','Job Date':'2026-09-01','Ship Date':'2026-09-03','Client Code':'C1','Fees Earned':100,Cost:60,Currency:'USD'},{'Job Number':'J2','Job Date':'2026-09-02','Ship Date':'2026-09-04','Client Code':'C2','Fees Earned':200,Cost:120,Currency:'USD'}]);
 const i=interpretSales(p,'v',answers);assert.equal(i.fields.find(f=>f.name==='Job Date')?.role,'TIME');assert.equal(i.fields.find(f=>f.name==='Ship Date')?.role,'SHIP_DATE');
 const result=analyzeDashboardData(projectSalesData(p,i.projection),'v',i.confirmation);assert.equal(amount(result,'REVENUE')?.value,300);assert.equal(result.dimensions.find(d=>d.role==='DATE')?.field,'Job Date');
});
test('competing valid business dates remain ambiguous until explicitly selected',async()=>{
 const p=await file([{'Order ID':'1','Job Date':'2026-09-01','Payment Date':'2026-09-03',Sales:10,Currency:'USD'}]);
 const i=interpretSales(p,'v',answers);assert.ok(i.questions.some(q=>q.key==='transactionDateField'));assert.equal(i.confirmation.confirmedMappings.filter(m=>m.canonicalConcept==='TIME').length,0);
 const selected=interpretSales(p,'v',{...answers,transactionDateField:'Job Date'});assert.equal(selected.confirmation.confirmedMappings.find(m=>m.canonicalConcept==='TIME')?.sourceField,'Job Date');
});
test('global assignment uses reconciliation to select a supported sales column; equal alternatives remain unresolved',async()=>{
 const p=await file([{'Order ID':'1','Gross Sales':100,'Discount Amount':10,Revenue:95,'Net Sales':90,Currency:'USD'},{'Order ID':'2','Gross Sales':200,'Discount Amount':20,Revenue:190,'Net Sales':180,Currency:'USD'}]);
 const i=interpretSales(p,'v',answers);assert.equal(i.confirmation.confirmedMappings.find(m=>m.canonicalConcept==='REVENUE')?.sourceField,'Net Sales');assert.equal(i.confirmation.confirmedMappings.filter(m=>m.canonicalConcept==='REVENUE').length,1);
 const q=await file([{'Order ID':'1',Revenue:10,'Net Sales':10,Currency:'USD'}]);assert.equal(interpretSales(q,'v',answers).confirmation.confirmedMappings.filter(m=>m.canonicalConcept==='REVENUE').length,0);
});
test('observed composite keys and functional dependencies are validated against every row',async()=>{
 const rows=[{'Order ID':'A','Record ID':'1','Customer ID':'X',Sales:10,Currency:'USD'},{'Order ID':'A','Record ID':'2','Customer ID':'X',Sales:20,Currency:'USD'},{'Order ID':'B','Record ID':'1','Customer ID':'Y',Sales:30,Currency:'USD'}],p=await file(rows),i=interpretSales(p,'v',{...answers,lineAmounts:true});
 assert.ok(discoverSalesKeys(p,i.fields).some(k=>k.includes('Order ID')&&k.includes('Record ID')));assert.equal(salesDependency(p.rows,['Order ID'],'Customer ID'),true);assert.equal(salesDependency([...p.rows,{'Order ID':'A','Customer ID':'Y'}],['Order ID'],'Customer ID'),false);
});
test('decimal calculation plan preserves cents, ordering and aggregate ratios',async()=>{
 const plan=compileSalesPlan('USD',{refunds:false,discounts:false,returns:false}),rows=[{REVENUE:.1,COST:.03,ORDER:'A'},{REVENUE:.2,COST:.07,ORDER:'B'}];
 assert.equal(executeSalesPlan(rows,plan,'REVENUE').exact,'0.3');assert.equal(executeSalesPlan([...rows].reverse(),plan,'REVENUE').exact,'0.3');assert.equal(executeSalesPlan(rows,plan,'PROFIT').exact,'0.2');
 assert.ok(plan.order.indexOf('REVENUE')<plan.order.indexOf('PROFIT'));assert.equal(plan.definitions.GROSS_MARGIN.aggregation,'RATIO');assert.deepEqual(plan.units.AVERAGE_ORDER_VALUE,{USD:1,orders:-1});
 assert.equal(salesNumber('9007199254740993','DOT'),null,'source rounding is rejected, not silently accepted');
});
test('independent invariants: splitting lines preserves money and order count, partitions reconcile, weighted margin is recomputed',()=>{
 const plan=compileSalesPlan('USD',{refunds:false,discounts:false,returns:false});
 for(let seed=1;seed<=80;seed++){
  const rows=Array.from({length:8},(_,j)=>({ORDER:String(j%4),REVENUE:((seed*37+j*19)%1000)/100,COST:((seed*11+j*7)%400)/100}));
  const split=rows.flatMap(r=>[{...r,REVENUE:r.REVENUE/2,COST:r.COST/2},{...r,REVENUE:r.REVENUE/2,COST:r.COST/2}]);
  assert.equal(executeSalesPlan(rows,plan,'REVENUE').exact,executeSalesPlan(split,plan,'REVENUE').exact);assert.equal(executeSalesPlan(rows,plan,'ORDERS').value,executeSalesPlan(split,plan,'ORDERS').value);
  const cents=rows.reduce((total,r)=>total+Math.round(r.REVENUE*100),0);assert.equal(executeSalesPlan(rows,plan,'REVENUE').value,cents/100);
  const cost=rows.reduce((total,r)=>total+Math.round(r.COST*100),0);assert.ok(Math.abs(executeSalesPlan(rows,plan,'GROSS_MARGIN').value-(cents-cost)/cents)<1e-12);
 }
});
test('granular accounting facts establish net basis without a blanket accounting answer',async()=>{
 const p=await file([{'Order ID':'1','Gross Sales':100,'Discount Amount':10,Sales:90,Cost:30,Currency:'USD'}]);
 const i=interpretSales(p,'v',{refundsAlreadyApplied:true,taxExcluded:true,deliveryExcluded:true,costIsProductCost:true});
 assert.equal(i.accountingFacts.discountsAlreadyApplied,true);assert.equal(amount(analyzeDashboardData(projectSalesData(p,i.projection),'v',i.confirmation),'REVENUE')?.value,90);
 const unknown=interpretSales(p,'v',{taxExcluded:true});assert.ok(unknown.questions.some(q=>q.key==='refundsAlreadyApplied'));assert.notEqual(unknown.confirmation.metricRules.revenueBasis,'NET');
});
test('readiness and panel messages distinguish absent dimensions from absent records',async()=>{
 const p=await file([{'Order ID':'1',Sales:10,Currency:'USD'}]),i=interpretSales(p,'v',answers),result=analyzeDashboardData(projectSalesData(p,i.projection),'v',i.confirmation);
 const capability=salesPanelCapability('segments',result);assert.match(capability.reason,/customer segment field/);assert.doesNotMatch(capability.reason,/No records/);assert.equal(salesReadiness(result).availableCharts,0);
});

test('Excel-scale residuals retain exact lineage without disabling currency totals',()=>{
 const plan=compileSalesPlan('USD',{refunds:false,discounts:false,returns:false});
 const result=executeSalesPlan([{REVENUE:118726350.25,COST:101832648},{REVENUE:.0099999999866,COST:0}],plan,'REVENUE');
 assert.equal(result.exact,'118726350.2599999999866');assert.equal(result.value.toFixed(2),'118726350.26');
 assert.throws(()=>executeSalesPlan([{REVENUE:Number.MAX_SAFE_INTEGER},{REVENUE:1}],plan,'REVENUE'),/SALES_PLAN_RANGE/);
});
test('an unfamiliar date column prompts a business date choice rather than guessing',async()=>{
 const p=await file([{'Order ID':'1',Occurred:'2026-09-01',Sales:10,Currency:'USD'}]);
 const i=interpretSales(p,'v',answers);assert.ok(i.questions.some(q=>q.key==='transactionDateField'));assert.equal(i.confirmation.confirmedMappings.some(m=>m.canonicalConcept==='TIME'),false);
 const selected=interpretSales(p,'v',{...answers,transactionDateField:'Occurred'});assert.equal(selected.confirmation.confirmedMappings.find(m=>m.canonicalConcept==='TIME')?.sourceField,'Occurred');
});
test('accounting questions ask separate facts and exact custom sums avoid binary accumulation',async()=>{
 const {calculateSalesCustomMeasures}=await import('../src/engines/sales/custom-measures');
 const p=await file([{'Order ID':'1',Revenue:.1,Currency:'USD'},{'Order ID':'2',Revenue:.2,Currency:'USD'}]),i=interpretSales(p,'v',{});
 assert.deepEqual(i.questions.filter(q=>!q.optional).map(q=>q.key),['discountsAlreadyApplied','refundsAlreadyApplied','taxExcluded','deliveryExcluded']);
 const custom=calculateSalesCustomMeasures(p,[{id:'source_total',name:'Recorded total',field:'Revenue',aggregation:'SUM',format:'CURRENCY'}],'USD');assert.equal(custom[0].value,.3);
});
