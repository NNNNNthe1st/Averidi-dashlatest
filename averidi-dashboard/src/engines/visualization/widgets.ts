import {selectAnalysisRows} from '../analysis/selection';
import {effectiveAnalysisFilters} from '../analysis/query-contracts';
import {dashboardBusinessDay} from '../metrics/business-period';
import {salesPresentationConfig,type DashboardConfig} from '../generation/dashboard-templates';
import type {DashboardPreparedData} from '../ingestion/ingest';
import {analyzeDashboardData,type AnalysisConfirmation,type AnalysisQuery} from '../analysis/pipeline';
export function buildDashboardWidgets(definition:DashboardConfig,prepared:DashboardPreparedData,versionId:string,confirmation:AnalysisConfirmation,query:AnalysisQuery,freshness?:{refreshedAt:string;calculatedAt:string}){
 const salesGroups=new Map<string,ReturnType<typeof analyzeDashboardData>>();
 const coreKeys=new Set(['REVENUE','COST','PROFIT','GROSS_MARGIN','ORDERS','CUSTOMERS','UNITS','AVERAGE_ORDER_VALUE','AVERAGE_UNIT_PRICE']);
 const analysis=analyzeDashboardData(prepared,versionId,confirmation,query,prepared.rows);
 if(definition.template==='SALES'&&analysis.outcomes.some(m=>['REVENUE','ORDERS'].includes(m.key)&&m.status==='READY')){
  const current=salesPresentationConfig(definition,analysis.outcomes,analysis.dimensions);
  definition={...current,widgets:current.widgets.map(w=>{const previous=definition.widgets.find(p=>p.id===w.id);return previous?.dimensionField&&analysis.dimensions.some(d=>d.field===previous.dimensionField)?{...w,dimensionField:previous.dimensionField}:w;})};
 }
 if(freshness)analysis.outcomes=analysis.outcomes.map(outcome=>({...outcome,lineage:{...outcome.lineage,...freshness}}));
 return {analysis,widgets:definition.widgets.filter(w=>w.visible).sort((a,b)=>a.order-b.order).map(widget=>{
  const outcome=analysis.outcomes.find(m=>m.key===widget.metricKey)!;
  if(widget.kind==='KPI'||outcome.status!=='READY')return {...widget,outcome,series:[]};
  const dimension=analysis.dimensions.find(d=>d.field===widget.dimensionField);
  if(!dimension)throw Error('UNCONFIRMED_DIMENSION');
  const groups=new Map<string,{label:string;missing:boolean;rows:typeof prepared.rows}>();
  const labelFor=(row:typeof prepared.rows[number])=>{const value=row[dimension.field],missing=value===null||value===undefined,day=dimension.role==='DATE'&&!missing?dashboardBusinessDay(value,confirmation.metricRules.timezone!):null,label=missing?'(Missing)':dimension.role==='DATE'?(widget.kind==='SALES_TREND'||widget.id==='sales-order-date-heatmap'?day?.slice(0,7):day):String(value);return {label,missing,key:JSON.stringify([missing,label])};};
  const currentFilters=analysis.outcomes[0]?.lineage.filters??effectiveAnalysisFilters(query);
  const selected=definition.template==='SALES'?selectAnalysisRows(prepared.rows,analysis.dimensions,confirmation.metricRules.timezone,currentFilters):null;
  const selectedKeys=selected?new Set(selected.map(row=>labelFor(row).key)):null;
  const scopedQuery=definition.template==='SALES'?{...query,filters:[...query.filters,...currentFilters.filter(f=>f.type==='CATEGORY'&&!query.filters.some(q=>q.field===f.field))]}:query;
  // Each group is calculated with the same query. Ratios and distinct counts are
  // recalculated from records, never summed from pre-aggregated KPI values.
  if(dimension.role==='DATE'&&!confirmation.metricRules.timezone)throw Error('CONFIRMED_TIMEZONE_REQUIRED');
  for(const row of prepared.rows){if(selectedKeys&&!selectedKeys.has(labelFor(row).key))continue;const value=row[dimension.field],missing=value===null||value===undefined;const day=dimension.role==='DATE'&&!missing?dashboardBusinessDay(value,confirmation.metricRules.timezone!):null;const label=missing?'(Missing)':dimension.role==='DATE'?(widget.kind==='SALES_TREND'||widget.id==='sales-order-date-heatmap'?day?.slice(0,7):day):String(value);if(label===null||label===undefined)throw Error('INVALID_DATE_VALUES');const key=JSON.stringify([missing,label]),group=groups.get(key);if(group)group.rows.push(row);else groups.set(key,{label,missing,rows:[row]});}
  const topN=['sales-top-customers','sales-top-products','sales-top-subcategories'].includes(widget.id);
  if(groups.size>(topN?5000:100)){
   if(definition.template!=='SALES')throw Error('TOO_MANY_CHART_GROUPS');
   return {...widget,outcome:{...outcome,status:'UNAVAILABLE' as const,value:null,reason:`This chart has ${groups.size} groups, above its ${topN?5000:100}-group limit. Choose a filter above to narrow the chart; headline totals still include the full selection.`},series:[]};
  }
  if((widget.kind==='SALES_TREND'||widget.id==='sales-order-date-heatmap')&&[...groups.values()].some(group=>group.missing))throw Error('INVALID_DATE_VALUES');
  const series=[...groups].sort(([,a],[,b])=>a.label.localeCompare(b.label)||Number(a.missing)-Number(b.missing)).map(([groupKey,{label,missing,rows}])=>{
   const core=definition.template==='SALES'&&coreKeys.has(widget.metricKey);
   const cacheKey=dimension.field+':'+groupKey+':'+String(core);
   let result=core?salesGroups.get(cacheKey):undefined;
   if(!result){result=analyzeDashboardData({...prepared,rows,duplicateCount:0},versionId,confirmation,scopedQuery,prepared.rows,core?'SALES_CHART':'ALL');if(core)salesGroups.set(cacheKey,result);}
   const m=result.outcomes.find(m=>m.key===widget.metricKey)!;
   const second=widget.kind==='SALES_TREND'?result.outcomes.find(metric=>metric.key==='PROFIT'):undefined;
   const extraKeys=(widget.id==='sales-revenue-category'||widget.id==='sales-top-subcategories')?['PROFIT']:widget.id==='sales-segment-performance'?['ORDERS','CUSTOMERS','PROFIT','GROSS_MARGIN']:widget.id==='sales-region-map'?['PROFIT','GROSS_MARGIN']:widget.id==='sales-top-customers'?['ORDERS','AVERAGE_ORDER_VALUE']:widget.id==='sales-top-products'?['REVENUE','GROSS_MARGIN']:[];
   const segmentMetrics=extraKeys.length?Object.fromEntries(extraKeys.map(key=>{const metric=result.outcomes.find(item=>item.key===key);return [key,metric?.status==='READY'?metric.value:null];})):undefined;
   return {label,groupKey,missing,segmentMetrics,value:m.status==='READY'?m.value:null,secondaryValue:second?.status==='READY'?second.value:null,status:m.status,reason:m.reason,rowCount:m.lineage.rowCount,comparison:result.comparison?.[widget.metricKey]};
  }).filter(point=>point.rowCount>0);
  if(["sales-top-subcategories","sales-top-customers","sales-top-products"].includes(widget.id)){
   const confirmed=series.filter(point=>point.value!==null&&Number.isFinite(point.value)&&!point.missing);
   const ranked=confirmed.sort((a,b)=>(b.value??0)-(a.value??0)||a.label.localeCompare(b.label)).slice(0,5);
   const profitRanked=widget.id==='sales-top-subcategories'?series.filter(point=>point.segmentMetrics?.PROFIT!==null&&point.segmentMetrics?.PROFIT!==undefined&&!point.missing).sort((a,b)=>(b.segmentMetrics?.PROFIT??0)-(a.segmentMetrics?.PROFIT??0)||a.label.localeCompare(b.label)).slice(0,5):undefined;
   return {...widget,outcome,series:ranked,profitRanked};
  }
  return {...widget,outcome,series};
 })};
}
export type DashboardWidgetData=ReturnType<typeof buildDashboardWidgets>;

export function salesFilterOptions(rows:DashboardPreparedData['rows'],dimensions:readonly {field:string;concept:string;role:'DATE'|'DIMENSION'}[]){
 const concepts=['GEOGRAPHY','CATEGORY','CUSTOMER_SEGMENT'] as const;
 return Object.fromEntries(concepts.map(concept=>{
  const dimension=dimensions.find(d=>d.concept===concept&&d.role==='DIMENSION');
  if(!dimension)return [concept,[]] as const;
  const values=new Set<string>();
  for(const row of rows){const value=row[dimension.field];if(value!==null&&value!==undefined){const text=String(value);if(text&&text.length<=512)values.add(text);}}
  return [concept,[...values].sort((a,b)=>a.localeCompare(b))] as const;
 })) as Record<typeof concepts[number],string[]>;
}

/** Observed source dates, never guessed month boundaries or synthetic data. */
export function salesDateExtent(rows:DashboardPreparedData['rows'],dimensions:readonly {field:string;role:'DATE'|'DIMENSION'}[],timezone:string|null|undefined){
 const dimension=dimensions.find(d=>d.role==='DATE');if(!dimension||!timezone)return null;
 let start:string|null=null,end:string|null=null;
 for(const row of rows){const day=dashboardBusinessDay(row[dimension.field],timezone);if(!day)continue;if(start===null||day<start)start=day;if(end===null||day>end)end=day;}
 return start&&end?{start,end}:null;
}
