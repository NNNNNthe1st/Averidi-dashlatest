import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesExtendedMetrics} from '../src/engines/metrics/sales-extended-metrics';
import type {MetricContext,MetricSemantics} from '../src/engines/metrics/metric-engine';
const semantics:MetricSemantics={revenueBasis:'NET',costBasis:'UNKNOWN',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',rowGrain:'ORDER_ITEM',rowAmountsConfirmed:true};
const mappings=[['day','TIME','DIMENSION'],['product','PRODUCT','DIMENSION'],['sales','REVENUE','MEASURE'],['units','QUANTITY','MEASURE']].map(([sourceField,canonicalConcept,role])=>({sourceField,canonicalConcept,role,status:'CONFIRMED'}));
const rows=[
 {day:'2026-01-05',product:'A',sales:100,units:10},
 {day:'2026-01-06',product:'B',sales:100,units:5},
 {day:'2026-02-01',product:'A',sales:60,units:6},
 {day:'2026-02-02',product:'B',sales:180,units:9}
];
const context:MetricContext={rows:rows.slice(2),mappings,grain:'ORDER_ITEM',grainStatus:'CONFIRMED',versionId:'test',qualityStatus:'PASS',currency:'USD',currencyMode:'SINGLE',timezone:'UTC',appliedFilters:[{type:'DATE_RANGE',field:'day',value:'2026-02-01',end:'2026-02-28'}]};
test('39 mix shift measures prior-price contribution without changing portfolio revenue reconciliation',()=>{
 const result=calculateSalesExtendedMetrics(context,semantics,rows,false,{salesPriceVolumeBasisConfirmed:true});
 const mix=result.find(x=>x.key==='SALES_PRODUCT_MIX_EFFECT');
 assert.equal(mix?.status,'READY');
 assert.ok(Math.abs((mix?.value??0)-40)<1e-10);
});
test('40 population volatility returns sample standard deviation over confirmed daily history',()=>{
 const daily=[{day:'2026-01-01',product:'A',sales:10,units:1},{day:'2026-01-02',product:'A',sales:20,units:2},{day:'2026-01-03',product:'A',sales:30,units:3}];
 const ctx={...context,rows:daily,appliedFilters:[{type:'DATE_RANGE' as const,field:'day',value:'2026-01-01',end:'2026-01-03'}]};
 const result=calculateSalesExtendedMetrics(ctx,semantics,daily,true,{salesVolatilityPeriodConfirmed:true});
 assert.equal(result.find(x=>x.key==='SALES_VOLATILITY')?.value,10);
});
test('41 contribution is segment change over whole-population change across equal periods',()=>{
 const data=[{day:'2026-01-05',product:'A',sales:40,units:4},{day:'2026-01-06',product:'B',sales:60,units:6},{day:'2026-02-05',product:'A',sales:70,units:7},{day:'2026-02-06',product:'B',sales:80,units:8}];
 const ctx={...context,rows:[data[2]],appliedFilters:[{type:'DATE_RANGE' as const,field:'day',value:'2026-02-01',end:'2026-02-28'},{type:'CATEGORY' as const,field:'product',value:'A'}]};
 const result=calculateSalesExtendedMetrics(ctx,semantics,data,false,{salesGrowthContributionBasisConfirmed:true});
 assert.equal(result.find(x=>x.key==='SALES_GROWTH_CONTRIBUTION')?.value,0.6);
});
