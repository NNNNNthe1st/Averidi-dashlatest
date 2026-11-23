import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSalesExtendedMetrics} from '../src/engines/metrics/sales-extended-metrics';
import type {MetricContext,MetricSemantics} from '../src/engines/metrics/metric-engine';

const rows=[
 {date:'2026-01-01',revenue:120,order:'o1',product:'A',discount:20,pre:140,refund:5,refundBase:125,returns:1,grossUnits:6,quantity:5},
 {date:'2026-01-02',revenue:60,order:'o2',product:'B',discount:10,pre:70,refund:5,refundBase:65,returns:0,grossUnits:3,quantity:3},
 {date:'2026-01-03',revenue:20,order:'o3',product:'C',discount:0,pre:20,refund:0,refundBase:20,returns:1,grossUnits:2,quantity:1}
];
const fields=[
 ['date','TIME','DIMENSION'],['revenue','REVENUE','MEASURE'],['order','ORDER','DIMENSION'],['product','PRODUCT','DIMENSION'],['discount','DISCOUNT','MEASURE'],['pre','PRE_DISCOUNT_SALES','MEASURE'],['refund','REFUND','MEASURE'],['refundBase','REFUND_ELIGIBLE_SALES','MEASURE'],['returns','RETURN_QUANTITY','MEASURE'],['grossUnits','GROSS_SOLD_QUANTITY','MEASURE'],['quantity','QUANTITY','MEASURE']
] as const;
const mappings=fields.map(([sourceField,canonicalConcept,role])=>({sourceField,canonicalConcept,role,status:'CONFIRMED'}));
const semantics:MetricSemantics={revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED'};
const base:MetricContext={rows,mappings,grain:'ORDER',grainStatus:'CONFIRMED',versionId:'v1',qualityStatus:'PASS',currency:'USD',currencyMode:'SINGLE',timezone:'UTC',appliedFilters:[]};
const opts={salesConcentrationConcept:'PRODUCT' as const,salesTopN:2,salesDiscountBasisConfirmed:true,salesRefundBasisConfirmed:true,salesReturnBasisConfirmed:true};
const result=(key:string,context:MetricContext=base,options:NonNullable<Parameters<typeof calculateSalesExtendedMetrics>[4]>=opts)=>calculateSalesExtendedMetrics(context,semantics,rows,false,options).find(m=>m.key===key)!;
test('22 top-N uses distinct product groups and governed net revenue',()=>{
 assert.equal(result('SALES_TOP_N_CONCENTRATION').status,'READY');
 assert.equal(result('SALES_TOP_N_CONCENTRATION').value,0.9);
 assert.equal(result('SALES_TOP_N_CONCENTRATION',base,{...opts,salesTopN:1}).value,0.6);
 assert.equal(result('SALES_TOP_N_CONCENTRATION',base,{...opts,salesConcentrationConcept:undefined}).status,'UNAVAILABLE');
});
test('25 26 27 use explicitly confirmed comparable gross/eligible denominators',()=>{
 assert.ok(Math.abs((result('SALES_DISCOUNT_RATE').value??0)-30/230)<1e-12);
 assert.ok(Math.abs((result('SALES_REFUND_RATE').value??0)-10/210)<1e-12);
 assert.ok(Math.abs((result('SALES_RETURN_RATE').value??0)-2/11)<1e-12);
 for(const key of ['SALES_DISCOUNT_RATE','SALES_REFUND_RATE','SALES_RETURN_RATE']){
  assert.equal(result(key,base,{...opts,salesDiscountBasisConfirmed:false,salesRefundBasisConfirmed:false,salesReturnBasisConfirmed:false}).status,'UNAVAILABLE');
 }
});
test('missing or inconsistent upload denominator fails closed',()=>{
 const invalid=rows.map((r,i)=>({...r,pre:i===0?-1:r.pre}));
 assert.equal(result('SALES_DISCOUNT_RATE',{...base,rows:invalid}).status,'UNAVAILABLE');
 const badReturns=rows.map((r,i)=>({...r,returns:i===0?12:r.returns}));
 assert.equal(result('SALES_RETURN_RATE',{...base,rows:badReturns}).status,'UNAVAILABLE');
 const nonInteger=rows.map((r,i)=>({...r,returns:i===0?0.5:r.returns}));
 assert.equal(result('SALES_RETURN_RATE',{...base,rows:nonInteger}).status,'UNAVAILABLE');
});
test('top-N honors selected period rows and does not double count unselected data',()=>{
 const filtered={...base,rows:rows.slice(1),appliedFilters:[{type:'DATE_RANGE' as const,field:'date',value:'2026-01-02',end:'2026-01-03'}]};
 assert.equal(result('SALES_TOP_N_CONCENTRATION',filtered).value,1);
});
