import {buildDashboardWidgets} from '../../engines/visualization/widgets';
import {columnarEnabled,columnarMetricAnalysis} from '../../engines/columnar/engine';
import type {AnalysisConfirmation,AnalysisQuery,DashboardAnalysis} from '../../engines/analysis/pipeline';
import type {DashboardPreparedData} from '../../engines/ingestion/ingest';
import type {DashboardConfig} from '../../engines/generation/dashboard-templates';

/** A single query implementation for interactive views and report exports.
 * The approved Sales rendering and widget data contract are unchanged.
 * Grouped chart query execution belongs to separate roadmap item 3. */
export function canUseUnfilteredKpiFrame(
 definition:DashboardConfig,source:{result:DashboardAnalysis},query:AnalysisQuery
):boolean{
 return columnarEnabled()&&source.result.frame?.formatVersion===3&&
  query.filters.length===0&&!query.compare&&!query.comparison&&
  definition.widgets.every(widget=>widget.kind==='KPI');
}
export async function buildGovernedDashboardWidgets(
 definition:DashboardConfig,
 prepared:DashboardPreparedData|undefined,
 source:{
  dataset:{id:string;workspaceId:string};
  version:{id:string;semanticRevision:number;checksum:string};
  run:{engineVersion:number};
  result:DashboardAnalysis;
  confirmation:AnalysisConfirmation;
  salesProfile?:unknown;
 },
 query:AnalysisQuery,
 freshness?:{refreshedAt:string;calculatedAt:string},
 signal?:AbortSignal
):Promise<ReturnType<typeof buildDashboardWidgets>>{
 signal?.throwIfAborted();
 // KPI-only views have no grouping requirement. The stored analysis result is
 // already governed against this exact version and revision. Reuse its quality,
 // lineage and availability decisions and let DuckDB own numeric expressions.
 // Do not recalculate every core metric in JavaScript merely to overwrite it.
 const canReuse=canUseUnfilteredKpiFrame(definition,source,query);
 const stored=canReuse?{...source.result,frame:undefined,
  outcomes:source.result.outcomes.map(metric=>({...metric,lineage:{...metric.lineage,...freshness}}))}:null;
 if(!stored&&!prepared)throw Error('COLUMNAR_REQUIRES_PREPARED_ROWS');
 const calculated=stored?{
  analysis:stored,
  widgets:definition.widgets.filter(widget=>widget.visible).sort((a,b)=>a.order-b.order)
   .map(widget=>{
    const outcome=stored.outcomes.find(metric=>metric.key===widget.metricKey);
    if(!outcome)throw Error('METRIC_UNAVAILABLE');
    return {...widget,outcome,series:[]};
   })
 }:buildDashboardWidgets(definition,prepared!,source.version.id,source.confirmation,query,freshness);
 const analysis=await columnarMetricAnalysis(source.result.frame,{
  workspaceId:source.dataset.workspaceId,datasetId:source.dataset.id,
  versionId:source.version.id,semanticRevision:source.version.semanticRevision,
  sourceChecksum:source.version.checksum,engineVersion:source.run.engineVersion,
  projection:source.salesProfile?'SALES_PROJECTED':'SOURCE'
 },source.confirmation,query,calculated.analysis,signal);
 const outcomes=new Map(analysis.outcomes.map(metric=>[metric.key,metric]));
 return {...calculated,analysis,widgets:calculated.widgets.map(widget=>{
  const metric=outcomes.get(widget.metricKey);
  return metric&&widget.kind==='KPI'&&widget.outcome.status==='READY'
   ?{...widget,outcome:metric}:widget;
 })};
}
