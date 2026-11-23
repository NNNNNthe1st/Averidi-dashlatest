import type {DashboardWidgetData} from '../visualization/widgets';
function cell(value:unknown){const text=value===null||value===undefined?'':String(value);return '"'+(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';}
export function exportDashboardMetricReport(data:DashboardWidgetData&{analysisId:string;versionId:string;sourceChecksum:string;customMeasures?:import('../sales/custom-measures').SalesCustomResult[]}){
 const rows:unknown[][]=[['Widget','Metric','Group','Value','Status','Reason','Currency','Source version','Source checksum','Source fields','Rows','Formula','Definition version','Filters','Analysis','Comparison mode','Current from','Current through','Comparison from','Comparison through','Partial period aligned','Source processed at','Metrics calculated at','Previous value','Absolute change','Relative change','Missing group','Measurement unit']];
 for(const w of data.widgets){
  const values=w.kind==='KPI'?[{label:'',value:w.outcome.value,status:w.outcome.status,reason:w.outcome.reason,rowCount:w.outcome.lineage.rowCount,comparison:data.analysis.comparison?.[w.metricKey],missing:false}]:w.series;
  const periods=data.analysis.comparisonPeriods;
  for(const p of values)rows.push([w.title,w.metricKey,p.label,p.value,p.status,p.reason,w.outcome.lineage.currency,data.versionId,data.sourceChecksum,w.outcome.lineage.fields.join('; '),p.rowCount,w.outcome.definition.formula,w.outcome.lineage.definitionVersion,JSON.stringify(w.outcome.lineage.filters),data.analysisId,periods?.mode,periods?.current.start,periods?.current.end,periods?.previous.start,periods?.previous.end,periods?String(periods.partial):'',w.outcome.lineage.refreshedAt,w.outcome.lineage.calculatedAt,p.comparison?.previous,p.comparison?.absolute,p.comparison?.percentage,w.kind==='KPI'?'':String(p.missing),w.outcome.lineage.unit]);
 }
 for(const m of data.customMeasures??[])rows.push(['Additional Sales measure',m.name,'',m.value,m.status,m.reason,m.format==='CURRENCY'?data.analysis.outcomes.find(o=>o.key==='REVENUE')?.lineage.currency:null,data.versionId,data.sourceChecksum,m.field,m.rows,`${m.aggregation}(${m.field})`,'sales-custom-v1',JSON.stringify(data.analysis.outcomes[0]?.lineage.filters??[]),data.analysisId,...Array(13).fill('')]);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
