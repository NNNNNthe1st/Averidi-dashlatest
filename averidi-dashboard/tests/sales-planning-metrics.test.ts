import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesExtendedMetrics} from '../src/engines/metrics/sales-extended-metrics';
import type {MetricContext,MetricSemantics} from '../src/engines/metrics/metric-engine';

const rows=[
 {date:'2026-01-05',net:120,order:'o1',rep:'rep1',transaction:'t1'},
 {date:'2026-01-06',net:80,order:'o2',rep:'rep2',transaction:'t2'},
 {date:'2026-01-07',net:100,order:'o3',rep:'rep1',transaction:'t3'},
];
const mappings=[
 {sourceField:'date',canonicalConcept:'TIME',status:'CONFIRMED',role:'DIMENSION'},
 {sourceField:'net',canonicalConcept:'REVENUE',status:'CONFIRMED',role:'MEASURE'},
 {sourceField:'order',canonicalConcept:'ORDER',status:'CONFIRMED',role:'DIMENSION'},
 {sourceField:'rep',canonicalConcept:'SALES_REPRESENTATIVE',status:'CONFIRMED',role:'DIMENSION'},
 {sourceField:'transaction',canonicalConcept:'IDENTIFIER',status:'CONFIRMED',role:'DIMENSION'}
];
const semantics:MetricSemantics={revenueBasis:'NET',costBasis:'UNKNOWN',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'};
const ctx:MetricContext={rows,mappings,grain:'ORDER',grainStatus:'CONFIRMED',qualityStatus:'PASS',versionId:'sales-v1',currency:'USD',currencyMode:'SINGLE',timezone:'UTC',appliedFilters:[{type:'DATE_RANGE',field:'date',value:'2026-01-01',end:'2026-01-31'}]};
const choices={salesRepresentativeAttributionConfirmed:true,salesPlanningBasisConfirmed:true,salesPlanningPeriodStart:'2026-01-01',salesPlanningPeriodEnd:'2026-01-31',salesTargetAmount:400,salesBudgetAmount:250,salesEligibleSellingDays:20};
const compute=(context:MetricContext=ctx,options:Parameters<typeof calculateSalesExtendedMetrics>[4]=choices)=>Object.fromEntries(calculateSalesExtendedMetrics(context,semantics,rows,false,options).map(m=>[m.key,m]));
test('28-32 compute only from governed uploaded revenue and confirmed planning inputs',()=>{
 const out=compute();
 assert.equal(out.SALES_PER_REPRESENTATIVE.value,150);
 assert.equal(out.SALES_TARGET_ATTAINMENT.value,0.75);
 assert.equal(out.SALES_BUDGET_VARIANCE.value,50);
 assert.equal(out.SALES_PER_SELLING_DAY.value,15);
 assert.equal(out.SALES_REVENUE_PER_TRANSACTION.value,100);
});
test('planning metrics require exact selected date period and no segment mismatch',()=>{
 const out=compute({...ctx,appliedFilters:[{type:'DATE_RANGE',field:'date',value:'2026-01-01',end:'2026-01-15'}]});
 for(const key of ['SALES_TARGET_ATTAINMENT','SALES_BUDGET_VARIANCE','SALES_PER_SELLING_DAY'])assert.equal(out[key].status,'UNAVAILABLE');
 const unsupported=compute(ctx,{...choices,salesPlanningBasisConfirmed:false});
 assert.equal(unsupported.SALES_TARGET_ATTAINMENT.status,'UNAVAILABLE');
});
test('missing or invalid representative IDs and transaction IDs fail closed',()=>{
 const missing=rows.map((r,i)=>({...r,rep:i===1?'':r.rep,transaction:i===2?'':r.transaction}));
 const out=compute({...ctx,rows:missing});
 assert.equal(out.SALES_PER_REPRESENTATIVE.status,'UNAVAILABLE');
 assert.equal(out.SALES_REVENUE_PER_TRANSACTION.status,'UNAVAILABLE');
});
test('selling-day count cannot exceed selected period',()=>{
 const out=compute(ctx,{...choices,salesEligibleSellingDays:32});
 assert.equal(out.SALES_PER_SELLING_DAY.status,'UNAVAILABLE');
});

test('repeated representative IDs count distinct representatives, not rows',()=>{
 const doubled=[...rows,{date:'2026-01-08',net:100,order:'o4',rep:'rep2',transaction:'t4'}];
 const out=compute({...ctx,rows:doubled});
 assert.equal(out.SALES_PER_REPRESENTATIVE.value,200);
 assert.equal(out.SALES_REVENUE_PER_TRANSACTION.value,100);
});
test('planning inputs are invalid when a category filter changes the population',()=>{
 const extra={...ctx,appliedFilters:[...ctx.appliedFilters!,{type:'CATEGORY' as const,field:'rep',value:'rep1'}]};
 const out=compute(extra);
 for(const key of ['SALES_TARGET_ATTAINMENT','SALES_BUDGET_VARIANCE','SALES_PER_SELLING_DAY'])assert.equal(out[key].status,'UNAVAILABLE');
});
test('zero sales targets and nonfinite budgets cannot produce valid sales measures',()=>{
 const bad=compute(ctx,{...choices,salesTargetAmount:0,salesBudgetAmount:Number.NaN});
 assert.equal(bad.SALES_TARGET_ATTAINMENT.status,'UNAVAILABLE');
 assert.equal(bad.SALES_BUDGET_VARIANCE.status,'UNAVAILABLE');
});

test('representative metric rejects unconfirmed revenue attribution',()=>{
 const out=compute(ctx,{...choices,salesRepresentativeAttributionConfirmed:false});
 assert.equal(out.SALES_PER_REPRESENTATIVE.status,'UNAVAILABLE');
 assert.equal(out.SALES_REVENUE_PER_TRANSACTION.status,'READY');
});
