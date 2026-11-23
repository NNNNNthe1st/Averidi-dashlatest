import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesExtendedMetrics} from '../src/engines/metrics/sales-extended-metrics';
import type {MetricContext,MetricSemantics} from '../src/engines/metrics/metric-engine';
const semantics:MetricSemantics={revenueBasis:'NET',costBasis:'UNKNOWN',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'};
const mappings=[['day','TIME','DIMENSION'],['net','REVENUE','MEASURE'],['customer','CUSTOMER','DIMENSION'],['order','ORDER','DIMENSION']].map(([sourceField,canonicalConcept,role])=>({sourceField,canonicalConcept,role,status:'CONFIRMED'}));
const daily=Array.from({length:21},(_,i)=>({day:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),net:(i%7+1)*10,customer:'c'+i,order:'o'+i}));
const ctx:MetricContext={rows:daily,mappings,grain:'ORDER',grainStatus:'CONFIRMED',versionId:'v1',qualityStatus:'PASS',currency:'USD',currencyMode:'SINGLE',timezone:'UTC',appliedFilters:[]};
test('42 validation WAPE uses chronological seasonal holdout; 43 horizon growth compares equally sized windows',()=>{
 const out=calculateSalesExtendedMetrics(ctx,semantics,daily,true,{salesForecastBasisConfirmed:true,salesForecastSeasonDays:7,salesForecastHorizonDays:7});
 assert.equal(out.find(x=>x.key==='SALES_FORECAST_WAPE')?.value,0);
 assert.equal(out.find(x=>x.key==='SALES_FORECAST_MAE')?.value,0);
 assert.equal(out.find(x=>x.key==='SALES_FORECAST_RMSE')?.value,0);
 assert.equal(out.find(x=>x.key==='SALES_FORECAST_GROWTH')?.value,0);
});
test('42 and 43 require complete confirmed cadence and reject insufficient training',()=>{
 const missing=calculateSalesExtendedMetrics(ctx,semantics,daily,false,{salesForecastBasisConfirmed:true,salesForecastSeasonDays:7,salesForecastHorizonDays:7});
 assert.equal(missing.find(x=>x.key==='SALES_FORECAST_WAPE')?.status,'UNAVAILABLE');
 const insufficient=calculateSalesExtendedMetrics(ctx,semantics,daily.slice(0,5),true,{salesForecastBasisConfirmed:true,salesForecastSeasonDays:7,salesForecastHorizonDays:7});
 assert.equal(insufficient.find(x=>x.key==='SALES_FORECAST_GROWTH')?.status,'UNAVAILABLE');
});
test('44 cohort revenue per active customer uses earliest confirmed purchase and distinct members',()=>{
 const history=[{day:'2026-01-05',net:40,customer:'A',order:'a1'},{day:'2026-01-10',net:60,customer:'B',order:'b1'},{day:'2026-02-02',net:100,customer:'A',order:'a2'},{day:'2026-02-03',net:200,customer:'B',order:'b2'},{day:'2026-02-03',net:300,customer:'C',order:'c1'}];
 const selected=history.slice(2);
 const out=calculateSalesExtendedMetrics({...ctx,rows:selected,appliedFilters:[{type:'DATE_RANGE',field:'day',value:'2026-02-01',end:'2026-02-28'}]},semantics,history,true,{salesCohortMonth:'2026-01'});
 assert.equal(out.find(x=>x.key==='SALES_COHORT_REVENUE_PER_ACTIVE_CUSTOMER')?.value,150);
 assert.equal(calculateSalesExtendedMetrics({...ctx,rows:selected},semantics,history,false,{salesCohortMonth:'2026-01'}).find(x=>x.key==='SALES_COHORT_REVENUE_PER_ACTIVE_CUSTOMER')?.status,'UNAVAILABLE');
});
