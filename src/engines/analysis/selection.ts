import type {DashboardRow} from '../ingestion/ingest';
import type {AnalysisQuery} from './query-contracts';
import {dashboardBusinessDay} from '../metrics/business-period';
import {comparablePeriods} from '../metrics/metric-engine';
/** Shared row selection for metric and Sales chart populations. */
export function selectAnalysisRows(source:DashboardRow[],dimensions:readonly {field:string;role:'DATE'|'DIMENSION'}[],timezone:string|null|undefined,filters:AnalysisQuery['filters']){
 let rows=source;
 for(const filter of filters){
  const dim=dimensions.find(d=>d.field===filter.field);if(!dim)throw Error('UNCONFIRMED_FILTER');
  if(filter.type==='DATE_RANGE'){
   if(dim.role!=='DATE'||!timezone||!filter.end)throw Error('CONFIRMED_TIMEZONE_REQUIRED');comparablePeriods(filter.value,filter.end);
   if(rows.some(row=>dashboardBusinessDay(row[filter.field],timezone)===null))throw Error('INVALID_DATE_VALUES');
   rows=rows.filter(row=>{const day=dashboardBusinessDay(row[filter.field],timezone)!;return day>=filter.value&&day<=filter.end!;});
  }else if(filter.type==='MISSING'){
   if(filter.value!==''||filter.end!==undefined)throw Error('INVALID_CATEGORY_FILTER');rows=rows.filter(row=>row[filter.field]===null||row[filter.field]===undefined);
  }else{
   if(filter.end!==undefined)throw Error('INVALID_CATEGORY_FILTER');rows=rows.filter(row=>row[filter.field]!==null&&row[filter.field]!==undefined&&String(row[filter.field])===filter.value);
  }
 }
 return rows;
}
