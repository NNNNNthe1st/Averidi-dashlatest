import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesExtendedMetrics} from '../src/engines/metrics/sales-extended-metrics';
import type {MetricContext,MetricSemantics} from '../src/engines/metrics/metric-engine';
const days=Array.from({length:30},(_,i)=>({day:'2026-01-'+String(i+1).padStart(2,'0'),net:10,order:'o'+i,customer:'c'+i,quantity:2}));
const mappings=[
 {sourceField:'day',canonicalConcept:'TIME',status:'CONFIRMED',role:'DIMENSION'},
 {sourceField:'net',canonicalConcept:'REVENUE',status:'CONFIRMED',role:'MEASURE'},
 {sourceField:'order',canonicalConcept:'ORDER',status:'CONFIRMED',role:'DIMENSION'},
 {sourceField:'customer',canonicalConcept:'CUSTOMER',status:'CONFIRMED',role:'DIMENSION'},
 {sourceField:'quantity',canonicalConcept:'QUANTITY',status:'CONFIRMED',role:'MEASURE'},
];
const semantics:MetricSemantics={revenueBasis:'NET',costBasis:'UNKNOWN',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'};
const ctx:MetricContext={rows:days,mappings,grain:'ORDER',grainStatus:'CONFIRMED',versionId:'demo',qualityStatus:'PASS',currency:'USD',currencyMode:'SINGLE',timezone:'UTC',appliedFilters:[{type:'DATE_RANGE',field:'day',value:'2026-01-01',end:'2026-01-30'}]};
test('uploaded, governed sales rows produce accurate extended metrics',()=>{
 const results=calculateSalesExtendedMetrics(ctx,semantics,days,true);
 const values=Object.fromEntries(results.map(m=>[m.key,m.status==='READY'?m.value:m.reason]));
 assert.equal(values.SALES_MTD,300);
 assert.equal(values.SALES_QTD,300);
 assert.equal(values.SALES_YTD,300);
 assert.equal(values.SALES_ROLLING_30D,300);
 assert.equal(values.SALES_MOVING_30D_AVERAGE,10);
 assert.equal(values.SALES_CUMULATIVE,300);
 assert.equal(values.SALES_REVENUE_PER_CUSTOMER,10);
 assert.equal(values.SALES_UNITS_PER_ORDER,2);
 assert.equal(results.find(m=>m.key==='SALES_ROLLING_12M')?.status,'UNAVAILABLE');
 assert.equal(results.find(m=>m.key==='SALES_CAGR')?.status,'UNAVAILABLE');
});
test('unknown completeness disables only history-dependent calculations',()=>{
 const result=calculateSalesExtendedMetrics(ctx,semantics,days,false);
 assert.equal(result.find(m=>m.key==='SALES_MTD')?.status,'UNAVAILABLE');
 assert.equal(result.find(m=>m.key==='SALES_REVENUE_PER_CUSTOMER')?.status,'READY');
});
test('unconfirmed revenue is not reinterpreted as valid net sales',()=>{
 const noRevenue={...semantics,revenueBasis:'UNKNOWN' as const};
 const result=calculateSalesExtendedMetrics(ctx,noRevenue,days,true);
 assert.equal(result.find(m=>m.key==='SALES_MTD')?.status,'UNAVAILABLE');
 assert.equal(result.find(m=>m.key==='SALES_REVENUE_PER_CUSTOMER')?.status,'UNAVAILABLE');
});

test('selected segment contribution and rank use the same scoped governed denominator',()=>{
 const records=[
 {day:'2026-01-01',net:100,order:'A1',customer:'C1',quantity:1,channel:'Online'},
 {day:'2026-01-02',net:300,order:'A2',customer:'C2',quantity:2,channel:'Store'},
 {day:'2026-01-03',net:100,order:'A3',customer:'C3',quantity:1,channel:'Other'}
 ];
 const m=[...mappings,{sourceField:'channel',canonicalConcept:'CHANNEL',status:'CONFIRMED',role:'DIMENSION'}];
 const selected={...ctx,rows:[records[0]],mappings:m,appliedFilters:[{type:'CATEGORY' as const,field:'channel',value:'Online'}]};
 const results=calculateSalesExtendedMetrics(selected,semantics,records,false);
 assert.equal(results.find(x=>x.key==='SALES_CONTRIBUTION_SHARE')?.value,0.2);
 assert.equal(results.find(x=>x.key==='SALES_REVENUE_RANK')?.value,2);
 const all=calculateSalesExtendedMetrics({...ctx,rows:records,mappings:m,appliedFilters:[]},semantics,records,false);
 assert.equal(all.find(x=>x.key==='SALES_CONTRIBUTION_SHARE')?.status,'UNAVAILABLE');
});
test('trailing 12 calendar months handles leap days rather than 365-day shorthand',()=>{
 const begin=new Date('2024-03-01T00:00:00Z'),last=new Date('2025-02-28T00:00:00Z');
 const rows=[] as typeof days;
 for(let d=begin.getTime(),i=0;d<=last.getTime();d+=86400000,i++)rows.push({day:new Date(d).toISOString().slice(0,10),net:1,order:'T'+i,customer:'U'+i,quantity:1});
 const result=calculateSalesExtendedMetrics({...ctx,rows,appliedFilters:[]},semantics,rows,true);
 assert.equal(result.find(x=>x.key==='SALES_ROLLING_12M')?.value,365);
});
test('CAGR spans multiple complete calendar years and excludes incomplete years',()=>{
 const rows=[] as typeof days;
 let i=0;
 for(let year=2023;year<=2025;year++){
  for(let month=0;month<12;month++){
   const day=new Date(Date.UTC(year,month,year===2025&&month===11?31:1)).toISOString().slice(0,10);
   rows.push({day,net:year===2023?100:year===2024?110:121,order:'Y'+(i++),customer:'Z'+i,quantity:1});
  }
 }
 const result=calculateSalesExtendedMetrics({...ctx,rows,appliedFilters:[]},semantics,rows,true);
 const cagr=result.find(x=>x.key==='SALES_CAGR');
 assert.equal(cagr?.status,'READY');
 assert.ok(Math.abs((cagr?.value??0)-0.1)<1e-10);
});
