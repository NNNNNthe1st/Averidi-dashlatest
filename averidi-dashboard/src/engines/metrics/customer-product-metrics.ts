import {CUSTOMER_PRODUCT_METRICS} from "./metric-catalog";
export {CUSTOMER_PRODUCT_METRICS} from "./metric-catalog";
import {createHash} from 'node:crypto';
import type {DashboardRow} from '../ingestion/ingest';
import {dashboardBusinessDay} from './business-period';
import {calculateDashboardMetrics,comparablePeriods,type MetricContext,type MetricDefinition,type MetricOutcome,type MetricSemantics} from './metric-engine';

export function calculateCustomerProductMetrics(ctx:MetricContext,semantics:MetricSemantics,history:DashboardRow[],totalRows:DashboardRow[],historyConfirmed=false,cohortRows:DashboardRow[]=history):MetricOutcome[]{
 const field=(key:string)=>{const matches=ctx.mappings.filter(m=>m.canonicalConcept===key&&m.role!=='IGNORE'&&['CONFIRMED','AUTO_CONFIRMED'].includes(m.status));return matches.length===1?matches[0].sourceField:null;};
 const date=field('TIME'),customer=field('CUSTOMER'),order=field('ORDER'),product=field('PRODUCT'),status=field('STATUS');
 const clean=(rows:DashboardRow[])=>semantics.cancellationTreatment==='EXCLUDE_ROWS'&&status?rows.filter(r=>!['CANCELLED','CANCELED','VOID','VOIDED'].includes(String(r[status]).trim().toUpperCase())):rows;
 const selected=clean(ctx.rows),all=clean(history),ranges=ctx.appliedFilters?.filter(f=>f.type==='DATE_RANGE')??[],period=ranges.length===1&&ranges[0].field===date?ranges[0]:undefined,core=calculateDashboardMetrics(ctx,semantics),byKey=(rows:DashboardRow[],key:string)=>calculateDashboardMetrics({...ctx,rows},semantics).find(m=>m.key===key);
 return CUSTOMER_PRODUCT_METRICS.map(definition=>{
  const lineage={datasetVersionId:ctx.versionId,fields:definition.requires.flatMap(k=>field(k)?[field(k)!]:[]),rowCount:selected.length,period:period?.end?{start:period.value,end:period.end}:null,currency:ctx.currency,filters:ctx.appliedFilters??[],definitionVersion:'behavior-v1-'+createHash('sha256').update(JSON.stringify({definition,semantics,historyConfirmed})).digest('hex').slice(0,20)};
  const reject=(reason:string):MetricOutcome=>({key:definition.key,definition,lineage,status:'UNAVAILABLE',value:null,reason});
  if(ctx.qualityStatus==='FAIL'||!selected.length||definition.requires.some(k=>!field(k)))return reject('Confirm unique required fields and resolve data quality.');
  if(definition.requires.includes('REVENUE'))lineage.fields=[...new Set([...lineage.fields,...(core.find(m=>m.key==='REVENUE')?.lineage.fields??[]),...(definition.requires.includes('COST')?core.find(m=>m.key==='PROFIT')?.lineage.fields??[]:[])])];
  if(definition.key.startsWith('PRODUCT_')){
   if(!product||selected.some(r=>r[product]===null||r[product]===undefined||!String(r[product]).trim()))return reject('Product identifiers must be complete.');
   const key=definition.key==='PRODUCT_REVENUE_SHARE'?'REVENUE':'PROFIT',numerator=core.find(m=>m.key===key),denominator=byKey(totalRows,key);
   if(numerator?.status!=='READY'||denominator?.status!=='READY'||!denominator.value)return reject('Confirm product monetary inputs; contribution requires a nonzero governed total.');
   return {key:definition.key,definition,lineage,status:'READY',value:numerator.value!/denominator.value,reason:null};
  }
  if(!customer||!order||!core.some(m=>m.key==='ORDERS'&&m.status==='READY')||!core.some(m=>m.key==='CUSTOMERS'&&m.status==='READY'))return reject('Confirm order/customer identities, row grain and cancellation treatment.');
  const ids=new Map<string,{customer:string;day:string|null}>(),orders=new Map<string,Set<string>>();
  for(const r of all){const c=r[customer],o=r[order];if(typeof c==='number'&&!Number.isSafeInteger(c)||typeof o==='number'&&!Number.isSafeInteger(o)||c===null||c===undefined||!String(c).trim()||o===null||o===undefined||!String(o).trim())return reject('History needs complete customer and order identities.');const day=date&&ctx.timezone?dashboardBusinessDay(r[date],ctx.timezone):null,previous=ids.get(String(o));if(previous&&(previous.customer!==String(c)||previous.day!==day))return reject('One order cannot belong to conflicting customers or purchase dates.');ids.set(String(o),{customer:String(c),day});}
  for(const r of selected){const c=String(r[customer]),o=String(r[order]);if(!orders.has(c))orders.set(c,new Set());orders.get(c)!.add(o);}
  const repeat=[...orders.values()].filter(v=>v.size>=2).length;let value:number|null=null;
  if(definition.key==='REPEAT_CUSTOMERS')value=repeat;
  if(definition.key==='REPEAT_PURCHASE_RATE')value=orders.size?repeat/orders.size:null;
  if(['NEW_CUSTOMERS','RETAINED_CUSTOMERS','CUSTOMER_RETENTION_RATE','OBSERVED_CUSTOMER_VALUE'].includes(definition.key)){
   if(!historyConfirmed)return reject('Confirm that loaded history contains complete purchases for the customer population and required observation periods.');
   if(definition.key==='OBSERVED_CUSTOMER_VALUE'){const revenue=byKey(all.filter(r=>orders.has(String(r[customer!]))),'REVENUE');if(revenue?.status!=='READY')return reject('Confirm historical net revenue and currency.');value=orders.size?revenue.value!/orders.size:null;}
   else{
    if(!date||!ctx.timezone||[...ids.values()].some(v=>!v.day))return reject('Confirm one business-date field and timezone with valid history dates.');
    if(!period?.end)return {...reject('Apply one business-date range to calculate acquisition and period retention.'),requiresPeriod:true};
    const previous=comparablePeriods(period.value,period.end).previous,first=new Map<string,string>(),prior=new Set<string>();
    for(const item of ids.values()){if(!first.has(item.customer)||item.day!<first.get(item.customer)!)first.set(item.customer,item.day!);}
    for(const r of clean(cohortRows)){const day=dashboardBusinessDay(r[date],ctx.timezone);if(day&&day>=previous.start&&day<=previous.end)prior.add(String(r[customer!]));}
    const retained=[...orders.keys()].filter(c=>prior.has(c)).length;
    value=definition.key==='NEW_CUSTOMERS'?[...orders.keys()].filter(c=>first.get(c)!>=period.value&&first.get(c)!<=period.end!).length:definition.key==='RETAINED_CUSTOMERS'?retained:prior.size?retained/prior.size:null;
   }
  }
  if(value===null||!Number.isFinite(value))return reject('No eligible population or a zero denominator.');
  return {key:definition.key,definition,lineage,status:'READY',value,reason:null};
 });
}
