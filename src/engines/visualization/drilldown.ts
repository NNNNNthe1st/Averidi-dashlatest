import {effectiveAnalysisFilters,type AnalysisQuery} from '../analysis/query-contracts';
/** Chart exploration narrows existing filters; it never broadens them silently. */
export function chartDrilldownQuery(query:AnalysisQuery,field:string,role:'DATE'|'DIMENSION',label:string,missing?:boolean):AnalysisQuery{
 if(!field||label==='(Missing)'&&missing===undefined||query.filters.length>=12)throw Error('Choose an explicitly identified group with fewer than twelve active filters.');
 const filters=effectiveAnalysisFilters(query);
 if(missing)return {filters:[...filters,{type:'MISSING',field,value:''}],compare:false};
 return {filters:[...filters,{type:role==='DATE'?'DATE_RANGE':'CATEGORY',field,value:label,...(role==='DATE'?{end:label}:{})}],compare:false};
}
