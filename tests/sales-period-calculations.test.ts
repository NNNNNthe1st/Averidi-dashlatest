import test from 'node:test';
import assert from 'node:assert/strict';
import {salesCagr,salesCumulativeRevenue,salesMovingDailyAverage,salesPeriodRevenue,salesRankedSegments,salesRevenuePerCustomer,salesRollingRevenue,salesSegmentShares,salesToDate,salesTopNConcentration,salesUnitsPerOrder} from '../src/engines/metrics/sales-period-calculations';

const days=[{date:'2026-01-01',revenue:100},{date:'2026-01-02',revenue:0},{date:'2026-01-03',revenue:300}];
test('daily sales totals, moving windows and cumulative revenue',()=>{
 assert.deepEqual(salesPeriodRevenue(days,{start:'2026-01-01',end:'2026-01-03'}),{status:'READY',value:400});
 assert.deepEqual(salesRollingRevenue(days,'2026-01-03',2),{status:'READY',value:300});
 assert.deepEqual(salesMovingDailyAverage(days,'2026-01-03',2),{status:'READY',value:150});
 assert.deepEqual(salesCumulativeRevenue(days,{start:'2026-01-01',end:'2026-01-03'}),[
 {date:'2026-01-01',revenue:100},{date:'2026-01-02',revenue:100},{date:'2026-01-03',revenue:400}]);
 assert.deepEqual(salesToDate(days,'2026-01-03','MONTH'),{status:'READY',value:400});
 assert.deepEqual(salesToDate(days,'2026-01-03','QUARTER'),{status:'READY',value:400});
 assert.deepEqual(salesToDate(days,'2026-01-03','YEAR'),{status:'READY',value:400});
});
test('incomplete history, duplicate records and zero denominators are unavailable',()=>{
 assert.equal(salesRollingRevenue(days,'2026-01-03',4).status,'UNAVAILABLE');
 assert.equal(salesRollingRevenue([...days,days[0]],'2026-01-03',2).status,'UNAVAILABLE');
 assert.equal(salesPeriodRevenue(days,{start:'2026-02-29',end:'2026-03-01'}).status,'UNAVAILABLE');
 assert.equal(salesRevenuePerCustomer(100,0).status,'UNAVAILABLE');
 assert.equal(salesUnitsPerOrder(100,0).status,'UNAVAILABLE');
});
test('CAGR, revenue per customer and basket units are ratio-safe',()=>{
 assert.deepEqual(salesCagr(100,121,2),{status:'READY',value:0.10000000000000009});
 assert.deepEqual(salesRevenuePerCustomer(400,2),{status:'READY',value:200});
 assert.deepEqual(salesUnitsPerOrder(12,3),{status:'READY',value:4});
});
test('ranking, share and concentration use aggregated values',()=>{
 const segments=[{id:'B',revenue:20},{id:'A',revenue:80}];
 assert.deepEqual(salesRankedSegments(segments)?.map(s=>s.id),['A','B']);
 assert.deepEqual(salesTopNConcentration(segments,1),{status:'READY',value:0.8});
 assert.deepEqual(salesSegmentShares(segments),[{id:'B',share:0.2},{id:'A',share:0.8}]);
 assert.equal(salesTopNConcentration([{id:'A',revenue:-10}],1).status,'UNAVAILABLE');
});
