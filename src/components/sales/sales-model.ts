import type {MetricOutcome} from '../../engines/metrics/metric-engine';
import type {SalesDashboardData} from './contracts';
export function validSalesValue(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value);}
/** Display precision is part of the approved design; currencies and units come from lineage. */
/** Headline KPI cards: large values use compact notation (e.g. $118.7M) so they fit the card; tables keep full precision. */
export function formatSalesHeadline(value:number|null|undefined,outcome:MetricOutcome|undefined,locale='en-US'){
 if(!validSalesValue(value)||!outcome||outcome.status!=='READY')return 'Not in data';
 const format=outcome.definition.format;
 if(Math.abs(value!)<100000||format==='PERCENT')return formatSalesMetric(value,outcome,locale);
 const options:Intl.NumberFormatOptions={notation:'compact',maximumFractionDigits:1,...(format==='CURRENCY'&&outcome.lineage.currency?{style:'currency',currency:outcome.lineage.currency}:{})};
 return new Intl.NumberFormat(locale,options).format(value!)+(outcome.lineage.unit?(format==='CURRENCY'?' / '+outcome.lineage.unit:format==='COUNT'?' '+outcome.lineage.unit:''):'');
}
export function formatSalesMetric(value:number|null|undefined,outcome:MetricOutcome|undefined,locale='en-US'){
 if(!validSalesValue(value)||!outcome||outcome.status!=='READY')return 'Unavailable';
 const format=outcome.definition.format,key=outcome.key;
 const options:Intl.NumberFormatOptions=format==='PERCENT'?{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}:format==='CURRENCY'&&outcome.lineage.currency?{style:'currency',currency:outcome.lineage.currency,minimumFractionDigits:key==='AVERAGE_ORDER_VALUE'?2:0,maximumFractionDigits:key==='AVERAGE_ORDER_VALUE'?2:0}:{maximumFractionDigits:format==='COUNT'?0:2};
 return new Intl.NumberFormat(locale,options).format(value)+(outcome.lineage.unit?(format==='CURRENCY'?' / '+outcome.lineage.unit:format==='COUNT'?' '+outcome.lineage.unit:''):'');
}
export function salesInsights(data:SalesDashboardData,locale='en-US'){
 const insights:{icon:number;title:string;detail:string}[]=[];const change=data.analysis.comparison?.REVENUE?.percentage;
 if(validSalesValue(change))insights.push({icon:0,title:`Sales ${change>=0?'increased':'decreased'} by ${new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(Math.abs(change))} compared to the previous period.`,detail:'Measured against the confirmed comparison period.'});
 for(const [id,label] of [['sales-region-map','regional'],['sales-segment-performance','segment']] as const){
  const points=data.widgets.find(w=>w.id===id)?.series??[];if(!points.length||points.some(p=>!validSalesValue(p.value)||p.value!<0))continue;
  const total=points.reduce((sum,p)=>sum+p.value!,0);if(total<=0)continue;
  const top=[...points].filter(p=>!p.missing).sort((a,b)=>b.value!-a.value!)[0];if(!top)continue;const share=new Intl.NumberFormat(locale,{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(top.value!/total),margin=top.segmentMetrics?.GROSS_MARGIN;
  insights.push({icon:label==='regional'?1:2,title:`${top.label}${label==='segment'?' segment':''} ${label==='regional'?'contributes':'accounts for'} ${share} of ${label==='regional'?'regional':'segment'} sales.`,detail:label==='regional'&&validSalesValue(margin)?`Profit margin: ${new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(margin)}.`:'Calculated from the selected confirmed records.'});
 }
 return insights.slice(0,3);
}
