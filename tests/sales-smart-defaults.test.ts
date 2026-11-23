import test from 'node:test';import assert from 'node:assert/strict';
import {suggestSalesAnswers,detectCurrency,detectDateOrder,detectNumberFormat} from '../src/engines/sales/smart-defaults';
const field=(name:string,examples:string[])=>({name,role:'CUSTOM',type:'text',evidence:'',examples,use:true}) as never;
const q=(key:string,kind:string,extra={})=>({key,kind,label:key,detail:'',...extra}) as never;

test('common sales treatments default to the usual answer and are reported as assumptions',()=>{
 const r=suggestSalesAnswers([q('discountsAlreadyApplied','boolean'),q('taxExcluded','boolean'),q('costIsProductCost','boolean')],[],{});
 assert.deepEqual(r.answers,{discountsAlreadyApplied:true,taxExcluded:true,costIsProductCost:true});
 assert.equal(r.assumptions.length,3);
});
test('answers the customer already gave are never overwritten',()=>{
 const r=suggestSalesAnswers([q('discountsAlreadyApplied','boolean')],[],{discountsAlreadyApplied:false});
 assert.deepEqual(r.answers,{});
});
test('business-input questions and optional questions are left for the customer',()=>{
 const r=suggestSalesAnswers([q('planningConfirmed','boolean'),q('targetAmount','money'),q('reportingCurrency','choice',{options:['USD','EUR']}),q('taxExcluded','boolean',{optional:true})],[],{});
 assert.deepEqual(r.answers,{});
});
test('currency is detected from symbols, otherwise from region',()=>{
 assert.deepEqual(detectCurrency([field('Sales',[' $ 32,370.00 '])]),{code:'USD',fromData:true});
 assert.deepEqual(detectCurrency([field('Amount',['€12,50'])]),{code:'EUR',fromData:true});
 assert.deepEqual(detectCurrency([field('Amount',['1200'])],'en-PK'),{code:'PKR',fromData:false});
 assert.deepEqual(detectCurrency([field('Amount',['1200'])],'en-GB'),{code:'GBP',fromData:false});
});
test('date order is detected from unambiguous values, otherwise from region',()=>{
 assert.equal(detectDateOrder([field('Date',['25/03/2024','01/04/2024'])]).order,'DAY_FIRST');
 assert.equal(detectDateOrder([field('Date',['03/25/2024'])]).order,'MONTH_FIRST');
 assert.deepEqual(detectDateOrder([field('Date',['1/1/2014'])],'en-US'),{order:'MONTH_FIRST',fromData:false});
 assert.equal(detectDateOrder([field('Date',['1/1/2014'])],'en-GB').order,'DAY_FIRST');
});
test('number notation is detected',()=>{
 assert.equal(detectNumberFormat([field('Amount',['1.234,56','99,10'])]),'COMMA');
 assert.equal(detectNumberFormat([field('Amount',['1,234.56'])]),'DOT');
});
test('reporting date prefers an order or transaction date',()=>{
 const r=suggestSalesAnswers([q('transactionDateField','field',{options:['Ship Date','Order Date']})],[],{});
 assert.equal(r.answers.transactionDateField,'Order Date');
});
