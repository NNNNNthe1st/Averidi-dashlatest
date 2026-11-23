import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {approvedSalesStyle,approvedSalesMarkup,approvedSalesSourceSha256} from '../src/components/sales/approved-sales-design';
import {formatSalesMetric,salesInsights} from '../src/components/sales/sales-model';
import {salesDateExtent} from '../src/engines/visualization/widgets';
import {generateDashboardConfig,salesPresentationConfig} from '../src/engines/generation/dashboard-templates';
import {METRIC_DEFINITIONS,type MetricOutcome} from '../src/engines/metrics/metric-engine';
import type {SalesDashboardData} from '../src/components/sales/contracts';
function ready(key:MetricOutcome['key'],value=100):MetricOutcome{return {key,status:'READY',value,reason:null,definition:METRIC_DEFINITIONS.find(m=>m.key===key)!,lineage:{datasetVersionId:'sales-test',fields:['confirmed'],rowCount:2,period:null,currency:'USD'}};}

test('connected presentation retains the approved source and stylesheet byte for byte',()=>{
 const source=readFileSync(new URL('../public/design/sales-dashboard.html',import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),approvedSalesSourceSha256);
 assert.equal(source.toString().match(/<style>([\s\S]*?)<\/style>/)![1],approvedSalesStyle);
 assert.equal((approvedSalesMarkup.match(/class="kpi"/g)??[]).length,6);
 assert.equal((approvedSalesMarkup.match(/class="panel /g)??[]).length,9);
 assert.doesNotMatch(approvedSalesMarkup,/<script/);
});

test('live formatting retains design precision and uses confirmed currency without inventing missing values',()=>{
 assert.equal(formatSalesMetric(733215,ready('REVENUE')),'$733,215');
 assert.equal(formatSalesMetric(146.38,ready('AVERAGE_ORDER_VALUE')),'$146.38');
 assert.equal(formatSalesMetric(.127,ready('GROSS_MARGIN')),'12.7%');
 assert.equal(formatSalesMetric(0,ready('PROFIT')),'$0');
 assert.equal(formatSalesMetric(null,ready('REVENUE')),'Unavailable');
 assert.equal(formatSalesMetric(Number.NaN,ready('REVENUE')),'Unavailable');
 assert.equal(formatSalesMetric(100,{...ready('REVENUE'),status:'NEEDS_CONFIRMATION'}),'Unavailable');
 assert.match(formatSalesMetric(100,{...ready('REVENUE'),lineage:{...ready('REVENUE').lineage,currency:'EUR'}}),/€/);
});

test('dates display actual observed business days and require confirmed timezone',()=>{
 const dimensions=[{field:'date',role:'DATE' as const}];
 const rows=[{date:'2026-01-02T02:00:00Z'},{date:'2026-01-15T12:00:00Z'}];
 assert.deepEqual(salesDateExtent(rows,dimensions,'America/New_York'),{start:'2026-01-01',end:'2026-01-15'});
 assert.equal(salesDateExtent(rows,dimensions,null),null);
 assert.equal(salesDateExtent([],dimensions,'UTC'),null);
});

test('existing saved Sales views gain the new panels without deleting saved extras or changing other templates',()=>{
 const metrics=['REVENUE','PROFIT','GROSS_MARGIN','ORDERS','CUSTOMERS','AVERAGE_ORDER_VALUE'].map(key=>ready(key as MetricOutcome['key']));
 const dimensions=[{field:'date',concept:'TIME',role:'DATE' as const},{field:'category',concept:'CATEGORY',role:'DIMENSION' as const}];
 const stored=generateDashboardConfig('SALES',metrics);stored.widgets.push({id:'by-channel',kind:'BAR',metricKey:'REVENUE',title:'Sales by channel',dimensionField:'channel',visible:true,order:6});
 const output=salesPresentationConfig(stored,metrics,dimensions);
 assert.ok(output.widgets.some(w=>w.id==='sales-profit-trend'));
 assert.ok(output.widgets.some(w=>w.id==='sales-revenue-category'));
 assert.equal(output.widgets.at(-1)?.id,'by-channel');
 assert.equal(stored.widgets.length,7);
 const custom=generateDashboardConfig('CUSTOM',metrics);assert.equal(salesPresentationConfig(custom,metrics,dimensions),custom);
});

test('insights do not repeat approved demo claims when comparison or confirmed breakdowns are absent',()=>{
 const data={analysis:{comparison:null},widgets:[]} as unknown as SalesDashboardData;
 assert.deepEqual(salesInsights(data),[]);
 const withLoss={...data,analysis:{comparison:{REVENUE:{percentage:-.2}}}} as unknown as SalesDashboardData;
 assert.match(salesInsights(withLoss)[0].title,/decreased by 20%/);
 assert.doesNotMatch(salesInsights(withLoss)[0].title,/12\.3|Technology|West/);
});

test('confirmed engine data drives all fourteen approved widgets and source-derived filter options',async()=>{
 const {approvedSalesFixture}=await import('./fixtures/approved-sales-data');
 const all=approvedSalesFixture();assert.equal(all.widgets.length,14);assert.equal(all.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,14140);
 assert.deepEqual(all.dimensionOptions?.GEOGRAPHY,['Central','East','South','West']);
 const west=approvedSalesFixture({filters:[{type:'CATEGORY',field:'Region',value:'West'}],compare:false});assert.equal(west.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,3340);assert.deepEqual(west.widgets.find(w=>w.id==='sales-region-map')?.series.map(p=>p.label),['West']);
 for(const [field,value] of [['Category','Technology'],['Segment','Consumer']]){const selected=approvedSalesFixture({filters:[{type:'CATEGORY',field,value}],compare:false});assert.ok(selected.analysis.quality.selectedRows<all.analysis.quality.selectedRows);assert.ok(selected.analysis.quality.selectedRows>0);}
 const dated=approvedSalesFixture({filters:[{type:'DATE_RANGE',field:'Date',value:'2026-01-01',end:'2026-01-31'}],compare:true});assert.equal(dated.analysis.comparison?.REVENUE.current,4824);assert.equal(dated.analysis.comparison?.REVENUE.previous,1164);assert.match(salesInsights(dated)[0].title,/314\.4%/);
});

test('headline KPI values use compact notation for large numbers and a short empty state',async()=>{
 const {formatSalesHeadline}=await import('../src/components/sales/sales-model');
 const outcome=(key:string,format:string,currency?:string)=>({key,status:'READY',value:0,definition:{format},lineage:{currency}}) as never;
 assert.equal(formatSalesHeadline(118726350.29,outcome('REVENUE','CURRENCY','USD')),'$118.7M');
 assert.equal(formatSalesHeadline(1125806,outcome('UNITS','COUNT')),'1.1M');
 assert.equal(formatSalesHeadline(38160,outcome('REVENUE','CURRENCY','USD')),'$38,160');
 assert.equal(formatSalesHeadline(.142,outcome('GROSS_MARGIN','PERCENT')),'14.2%');
 assert.equal(formatSalesHeadline(null,outcome('ORDERS','COUNT')),'Not in data');
});
