import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesExtendedMetrics} from '../src/engines/metrics/sales-extended-metrics';
import type {MetricContext,MetricSemantics} from '../src/engines/metrics/metric-engine';
const rows=[
 {date:'2026-01-02',deal:'d1',stage:'WON',qualified:true,pipeline:0,net:100},
 {date:'2026-01-03',deal:'d2',stage:'LOST',qualified:true,pipeline:0,net:0},
 {date:'2026-01-04',deal:'d3',stage:'OPEN',qualified:true,pipeline:150,net:0},
 {date:'2026-01-05',deal:'d4',stage:'OPEN',qualified:false,pipeline:900,net:0},
];
const mappings=[
 {sourceField:'date',canonicalConcept:'TIME',role:'DIMENSION',status:'CONFIRMED'},
 {sourceField:'deal',canonicalConcept:'SALES_OPPORTUNITY_ID',role:'DIMENSION',status:'CONFIRMED'},
 {sourceField:'stage',canonicalConcept:'SALES_OPPORTUNITY_STAGE',role:'DIMENSION',status:'CONFIRMED'},
 {sourceField:'qualified',canonicalConcept:'SALES_OPPORTUNITY_QUALIFIED',role:'DIMENSION',status:'CONFIRMED'},
 {sourceField:'pipeline',canonicalConcept:'SALES_OPEN_PIPELINE_VALUE',role:'MEASURE',status:'CONFIRMED'},
 {sourceField:'net',canonicalConcept:'REVENUE',role:'MEASURE',status:'CONFIRMED'}
];
const semantics:MetricSemantics={revenueBasis:'NET',costBasis:'UNKNOWN',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'};
const ctx:MetricContext={rows,mappings,grain:'RECORD',grainStatus:'CONFIRMED',versionId:'crm-v1',qualityStatus:'PASS',currency:'USD',currencyMode:'SINGLE',timezone:'UTC',appliedFilters:[{type:'DATE_RANGE',field:'date',value:'2026-01-01',end:'2026-01-31'}]};
const options={salesOpportunityCohortConfirmed:true,salesPipelineSnapshotConfirmed:true,salesPlanningBasisConfirmed:true,salesTargetAmount:300,salesPlanningPeriodStart:'2026-01-01',salesPlanningPeriodEnd:'2026-01-31'};
const compute=(context:MetricContext=ctx,config:Parameters<typeof calculateSalesExtendedMetrics>[4]=options)=>Object.fromEntries(calculateSalesExtendedMetrics(context,semantics,rows,false,config).map(m=>[m.key,m]));
test('33 qualified conversion, 34 open pipeline coverage, 35 closed win rate',()=>{
 const out=compute();
 assert.equal(out.SALES_CONVERSION_RATE.value,1/3);
 assert.equal(out.SALES_PIPELINE_COVERAGE.value,0.5);
 assert.equal(out.SALES_WIN_RATE.value,0.5);
});
test('opportunity calculations reject duplicate identities and invalid outcomes',()=>{
 const dupe=compute({...ctx,rows:[...rows,rows[0]]});
 for(const key of ['SALES_CONVERSION_RATE','SALES_PIPELINE_COVERAGE','SALES_WIN_RATE'])assert.equal(dupe[key].status,'UNAVAILABLE');
 const bad=compute({...ctx,rows:rows.map((r,i)=>i===0?{...r,stage:'UNKNOWN'}:r)});
 assert.equal(bad.SALES_WIN_RATE.status,'UNAVAILABLE');
});
test('pipeline requires snapshot and matching planning horizon',()=>{
 assert.equal(compute(ctx,{...options,salesPipelineSnapshotConfirmed:false}).SALES_PIPELINE_COVERAGE.status,'UNAVAILABLE');
 assert.equal(compute(ctx,{...options,salesPlanningPeriodEnd:'2026-02-01'}).SALES_PIPELINE_COVERAGE.status,'UNAVAILABLE');
 assert.equal(compute({...ctx,currencyMode:'MULTI',currency:null}).SALES_PIPELINE_COVERAGE.status,'UNAVAILABLE');
});
test('outcomes are not inferred from unconfirmed qualification or missing complete cohort',()=>{
 assert.equal(compute(ctx,{...options,salesOpportunityCohortConfirmed:false}).SALES_CONVERSION_RATE.status,'UNAVAILABLE');
 const missing=compute({...ctx,rows:rows.map((r,i)=>i===0?{...r,qualified:null}:r)} as unknown as MetricContext);
 assert.equal(missing.SALES_WIN_RATE.status,'UNAVAILABLE');
});
