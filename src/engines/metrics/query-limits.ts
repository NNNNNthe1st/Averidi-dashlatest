/** Central query and calculation bounds for interactive dashboard work.
 * Reject over-budget inputs rather than silently truncating financial totals.
 */
export const DASHBOARD_QUERY_LIMITS={
 maxRows:50_000,maxColumns:100,maxMappings:100,maxFilters:12,
 maxFilterValueLength:512,
} as const;

export function enforceDashboardQueryLimits(input:{
 rows:number;columns:number;mappings?:number;filters?:number;
}){
 for(const [name,value] of Object.entries(input)){
  if(value===undefined)continue;
  if(!Number.isSafeInteger(value)||value<0)throw new Error("Dashboard query size is invalid.");
  const bound=name==="rows"?DASHBOARD_QUERY_LIMITS.maxRows:
   name==="columns"?DASHBOARD_QUERY_LIMITS.maxColumns:
   name==="mappings"?DASHBOARD_QUERY_LIMITS.maxMappings:DASHBOARD_QUERY_LIMITS.maxFilters;
  if(value>bound)throw new Error("Dashboard query exceeds the supported calculation limit.");
 }
}
export function enforceDashboardQueryFilterBounds(filters:ReadonlyArray<{value:string;end?:string}>,internalCurrencyScope:0|1=0){
 // Public query schemas still accept at most 12 controls. Sales may append one
 // server-derived currency constraint so history/comparisons cannot cross it.
 enforceDashboardQueryLimits({rows:0,columns:0,filters:Math.max(0,filters.length-internalCurrencyScope)});
 for(const filter of filters){
  if(typeof filter.value!=="string"||filter.value.length>DASHBOARD_QUERY_LIMITS.maxFilterValueLength||
    (filter.end!==undefined&&(typeof filter.end!=="string"||filter.end.length>DASHBOARD_QUERY_LIMITS.maxFilterValueLength)))
    throw new Error("Dashboard filter is too large.");
 }
}
