import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesExtendedMetrics} from '../src/engines/metrics/sales-extended-metrics';
import type {MetricContext,MetricSemantics} from '../src/engines/metrics/metric-engine';
const semantics:MetricSemantics={revenueBasis:'NET',costBasis:'UNKNOWN',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',rowGrain:'ORDER_ITEM',rowAmountsConfirmed:true};
const basic={grain:'ORDER_ITEM',grainStatus:'CONFIRMED',versionId:'v1',qualityStatus:'PASS',currency:'USD',currencyMode:'SINGLE',timezone:'UTC'} as const;
test('36 elapsed closed qualified opportunity days excludes open and unqualified deals',()=>{
 const rows=[{id:'a',stage:'WON',q:true,opened:'2026-01-01',closed:'2026-01-11'},{id:'b',stage:'LOST',q:true,opened:'2026-01-03',closed:'2026-01-09'},{id:'c',stage:'OPEN',q:true,opened:'2026-01-05',closed:null}];
 const mappings=[['id','SALES_OPPORTUNITY_ID'],['stage','SALES_OPPORTUNITY_STAGE'],['q','SALES_OPPORTUNITY_QUALIFIED'],['opened','SALES_OPPORTUNITY_OPENED'],['closed','SALES_OPPORTUNITY_CLOSED']].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept,status:'CONFIRMED',role:'DIMENSION'}));
 const ctx:MetricContext={...basic,rows,mappings,appliedFilters:[]};
 const outcome=calculateSalesExtendedMetrics(ctx,semantics,rows,false,{salesCycleBasisConfirmed:true,salesOpportunityCohortConfirmed:true}).find(x=>x.key==='SALES_AVG_CYCLE_DAYS');
 assert.equal(outcome?.value,8);
 assert.equal(calculateSalesExtendedMetrics(ctx,semantics,rows,false,{}).find(x=>x.key==='SALES_AVG_CYCLE_DAYS')?.status,'UNAVAILABLE');
});
test('37 and 38 decompose product revenue change without a residual',()=>{
 const rows=[{day:'2026-01-05',product:'A',revenue:100,units:10},{day:'2026-01-06',product:'B',revenue:100,units:5},{day:'2026-02-01',product:'A',revenue:144,units:12},{day:'2026-02-02',product:'B',revenue:80,units:4}];
 const mappings=[['day','TIME','DIMENSION'],['product','PRODUCT','DIMENSION'],['revenue','REVENUE','MEASURE'],['units','QUANTITY','MEASURE']].map(([sourceField,canonicalConcept,role])=>({sourceField,canonicalConcept,status:'CONFIRMED',role}));
 const ctx:MetricContext={...basic,rows:rows.slice(2),mappings,appliedFilters:[{type:'DATE_RANGE',field:'day',value:'2026-02-01',end:'2026-02-28'}]};
 const results=calculateSalesExtendedMetrics(ctx,semantics,rows,false,{salesPriceVolumeBasisConfirmed:true});
 const price=results.find(x=>x.key==='SALES_PRICE_EFFECT'),volume=results.find(x=>x.key==='SALES_VOLUME_EFFECT');
 assert.equal(price?.status,'READY');assert.equal(volume?.status,'READY');
 assert.equal(price?.value,24);assert.equal(volume?.value,0);
});
