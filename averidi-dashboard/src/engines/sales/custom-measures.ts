import {salesDecimalOperation} from './decimal-values';
import {dashboardBusinessDay} from '../metrics/business-period';
import {effectiveAnalysisFilters,analysisComparisonPeriods,type AnalysisQuery} from '../analysis/query-contracts';
import type {DashboardPreparedData} from '../ingestion/ingest';
import type {SalesCustomMeasure} from './contracts';
export type SalesCustomResult={id:string;name:string;field:string;aggregation:SalesCustomMeasure['aggregation'];format:SalesCustomMeasure['format'];value:number|null;status:'READY'|'UNAVAILABLE';reason:string|null;rows:number};
/** Explicit aggregations only: never guess that an unfamiliar numeric column is additive. */
export function calculateSalesCustomMeasures(data:Pick<DashboardPreparedData,'columns'|'rows'>,measures:SalesCustomMeasure[]=[],currency:string|null=null):SalesCustomResult[]{
 return measures.map(m=>{
  const values=data.rows.map(row=>row[m.field]);
  const fail=(reason:string):SalesCustomResult=>({...m,status:'UNAVAILABLE',value:null,reason,rows:values.length});
  if(!data.columns.some(c=>c.name===m.field))return fail('The selected column is missing from this source version. Choose another column.');
  if(m.aggregation==='COUNT')return {...m,status:'READY',value:values.length,reason:null,rows:values.length};
  if(!values.length)return fail('No records match the current selection. Clear or change the filters.');
  if(values.some(v=>v===null||v===undefined||typeof v==='string'&&!v.trim()))return fail('This column contains missing values. Correct the source before aggregating it.');
  if(m.format==='CURRENCY'&&!currency)return fail('A single currency is required to format this result as money.');
  let value:number;
  if(m.aggregation==='DISTINCT_COUNT')value=new Set(values.map(v=>JSON.stringify(v))).size;
  else{
   if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)))return fail('This aggregation needs a complete numeric column in one consistent number format.');
   const numbers=values as number[];
   if(['SUM','AVERAGE'].includes(m.aggregation)&&numbers.reduce<number|null>((a,b)=>a===null?null:salesDecimalOperation(a,b,'ADD'),0)===null)return fail('The total exceeds the exact supported numeric range. Use smaller reporting groups.');
   value=m.aggregation==='MIN'?numbers.reduce((a,b)=>Math.min(a,b),Infinity):m.aggregation==='MAX'?numbers.reduce((a,b)=>Math.max(a,b),-Infinity):numbers.reduce<number|null>((a,b)=>a===null?null:salesDecimalOperation(a,b,'ADD'),0)!/(m.aggregation==='AVERAGE'?numbers.length:1);
  }
  return Number.isFinite(value)?{...m,value,status:'READY',reason:null,rows:values.length}:fail('The result is outside the supported numeric range.');
 });
}

export function salesCustomQueryData(data:DashboardPreparedData,query:AnalysisQuery,timezone:string|null|undefined){
 const filters=effectiveAnalysisFilters(query,analysisComparisonPeriods(query));
 return {...data,rows:data.rows.filter(row=>filters.every(f=>{const value=row[f.field];if(f.type==='MISSING')return value===null||value===undefined;if(f.type==='CATEGORY')return value!==null&&value!==undefined&&String(value)===f.value;const day=timezone?dashboardBusinessDay(value,timezone):null;return !!day&&!!f.end&&day>=f.value&&day<=f.end;}))};
}

export function salesDocumentMeasures(confirmation:import('../analysis/query-contracts').AnalysisConfirmation):SalesCustomMeasure[]{
 const concept=confirmation.metricRules.grain.startsWith('INVOICE')?'INVOICE':confirmation.metricRules.grain==='TRANSACTION'?'IDENTIFIER':null;
 const field=confirmation.confirmedMappings.find(m=>m.canonicalConcept===concept)?.sourceField;
 return field?[{id:'sales_document_count',name:concept==='INVOICE'?'Invoices':'Transactions',field,aggregation:'DISTINCT_COUNT',format:'NUMBER'}]:[];
}
