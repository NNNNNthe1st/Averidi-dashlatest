import type {DashboardPreparedData} from '../ingestion/ingest';
import type {SalesAnswers,SalesField,SalesProjection,SalesQuestion} from './contracts';
import {salesName} from './recognition';
const summary=new Set(['total','subtotal','sub total','grand total','summary','summary row','header','total row','aggregate']);
const detail=new Set(['detail','detail row','line','line item','sale','transaction','item','record']);
/** Flag explicit summary markers; never silently remove a customer's records. */
export function salesPopulation(data:DashboardPreparedData,fields:SalesField[],answers:SalesAnswers){
 const rules:{field:string;values:string[]}[]=[];
 for(const f of fields){
  const kind=f.role==='ROW_KIND';
  if(!kind&&!['ORDER','INVOICE','TRANSACTION','LINE_ITEM','PRODUCT_NAME'].includes(f.role))continue;
  const values=[...new Set(data.rawRows.map(r=>String(r[f.name]??'')))];
  const flagged=values.filter(v=>summary.has(salesName(v)));
  if(flagged.length&&values.some(v=>kind?detail.has(salesName(v)):!!v&&!summary.has(salesName(v))))rules.push({field:f.name,values:flagged});
 }
 const questions:SalesQuestion[]=[];const warnings:string[]=[];let projection:SalesProjection={};
 if(rules.length){
  projection={rowSelection:{rules,confirmed:answers.excludeSummaryRows===true}};
  if(answers.excludeSummaryRows!==true)questions.push({key:'excludeSummaryRows',kind:'boolean',label:'This file appears to contain detail rows and summary rows. Should we calculate from detail rows only?',detail:`Summary markers were found in ${rules.map(r=>r.field).join(', ')}. Answer Yes only if these markers identify subtotals, totals or headers that repeat the detail amounts. Otherwise correct the row-type field or upload one consistent population. Until resolved, totals remain blocked.`});
 }
 const status=fields.filter(f=>f.role==='STATUS');
 if(status.length===1){
  const field=status[0].name,values=[...new Set(data.rawRows.map(row=>String(row[field]??'').trim().toUpperCase()))];
  const completed=new Set(['COMPLETE','COMPLETED','PAID','FULFILLED','SHIPPED','DELIVERED']),excluded=new Set(['CANCELLED','CANCELED','VOID','VOIDED','OPEN','PENDING','PROCESSING']);
  if(values.some(v=>excluded.has(v))){
   if(values.every(v=>completed.has(v)||excluded.has(v))){
    if(answers.excludeNonSalesStatuses===true)projection.completedSales={field,excluded:[...excluded]};
    else if(answers.excludeNonSalesStatuses===undefined)questions.push({key:'excludeNonSalesStatuses',kind:'boolean',label:'Calculate Sales from completed or paid orders only?',detail:'Cancelled, void, open, pending and processing orders will be excluded. The original source records stay intact.'});
    else warnings.push('Uncompleted orders remain in this source. Choose completed sales only, or supply a source with the intended sales population.');
   }else warnings.push(`Some values in ${field} are not recognized order statuses. Correct those values before excluding incomplete orders.`);
  }
 }
 const currency=fields.filter(f=>f.role==='CURRENCY'),availableCurrencies=currency.length===1?[...new Set(data.rawRows.map(row=>String(row[currency[0].name]??'').trim().toUpperCase()))].filter(v=>/^[A-Z]{3}$/.test(v)&&Intl.supportedValuesOf('currency').includes(v)).sort():[];
 if(answers.reportingCurrency){if(currency.length!==1||!availableCurrencies.includes(answers.reportingCurrency))throw Error('INVALID_SALES_ANSWERS');projection.currencySelection={field:currency[0].name,value:answers.reportingCurrency};}
 else if(availableCurrencies.length>1)questions.push({key:'reportingCurrency',kind:'choice',options:availableCurrencies,label:'Which currency should this dashboard report?',detail:'Amounts in the chosen currency are included. Other currencies remain in your source and are excluded from this selection; no exchange rate is assumed.'});
 return {projection,questions,warnings,availableCurrencies};
}
