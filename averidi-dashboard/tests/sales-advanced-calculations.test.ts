import test from 'node:test';
import assert from 'node:assert/strict';
import {salesDiscountRate,salesRefundRate,salesReturnRate,salesPerRepresentative,salesTargetAttainment,salesBudgetVariance,salesPerSellingDay,salesRevenuePerTransaction,salesConversionRate,salesPipelineCoverage,salesWinRate,salesAverageCycleDays,salesPriceVolumeDecomposition,salesProductMixEffect,salesVolatility,salesGrowthContribution,salesForecastErrors,salesSeasonalNaiveForecast,salesCohortRevenuePerActiveCustomer} from '../src/engines/metrics/sales-advanced-calculations';
test('financial and sales ratios use governed denominators',()=>{
 const cases=[
 [salesDiscountRate(20,200),0.1],[salesRefundRate(5,100),0.05],[salesReturnRate(3,60),0.05],
 [salesPerRepresentative(600,3),200],[salesTargetAttainment(120,100),1.2],
 [salesBudgetVariance(110,100),10],[salesPerSellingDay(100,5),20],
 [salesRevenuePerTransaction(100,4),25],[salesConversionRate(4,20),0.2],
 [salesPipelineCoverage(300,100),3],[salesWinRate(3,2),0.6],
 [salesAverageCycleDays([5,10,15]),10],[salesGrowthContribution(10,50),0.2],
 [salesCohortRevenuePerActiveCustomer(200,4),50],
 ] as const;
 for(const [result,value] of cases){assert.equal(result.status,'READY');assert.equal(result.value,value);}
 assert.equal(salesDiscountRate(25,20).status,'UNAVAILABLE');
 assert.equal(salesConversionRate(11,10).status,'UNAVAILABLE');
 assert.equal(salesWinRate(0,0).status,'UNAVAILABLE');
});
test('price/volume reconcile and mix is neutral for unchanged proportions',()=>{
 const before=[{product:'A',quantity:10,revenue:100},{product:'B',quantity:20,revenue:400}];
 const after=[{product:'A',quantity:20,revenue:240},{product:'B',quantity:10,revenue:220}];
 const result=salesPriceVolumeDecomposition(before,after);
 assert.equal(result.status,'READY');
 if(result.status==='READY')assert.ok(Math.abs(result.priceEffect+result.volumeEffect-result.revenueChange)<1e-8);
 assert.equal(salesPriceVolumeDecomposition(before,[after[0]]).status,'UNAVAILABLE');
 const sameMix=[{product:'A',quantity:20,revenue:220},{product:'B',quantity:40,revenue:840}];
 const mix=salesProductMixEffect(before,sameMix);
 assert.equal(mix.status,'READY');
 if(mix.status==='READY')assert.ok(Math.abs(mix.value)<1e-8);
});
test('statistics and forecast evaluation are mathematically checked',()=>{
 const volatility=salesVolatility([10,20,30]);
 assert.equal(volatility.status,'READY');if(volatility.status==='READY')assert.equal(volatility.value,10);
 assert.equal(salesVolatility([10]).status,'UNAVAILABLE');
 assert.deepEqual(salesForecastErrors([100,200],[90,220]),{status:'READY',mae:15,rmse:Math.sqrt(250),wape:0.1});
 assert.deepEqual(salesSeasonalNaiveForecast([10,20,11,21],2,3),{status:'READY',forecast:[11,21,11],method:'seasonal naive',backtest:{status:'READY',mae:1,rmse:1,wape:2/32}});
 assert.equal(salesSeasonalNaiveForecast([10,20],2,3).status,'UNAVAILABLE');
 assert.equal(salesSeasonalNaiveForecast([10,20,11,21],0,3).status,'UNAVAILABLE');
 assert.equal(salesSeasonalNaiveForecast([10,20,11,21],-1,3).status,'UNAVAILABLE');
});
