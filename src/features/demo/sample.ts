import {z} from 'zod';
import {prepareDashboardRows} from '../../engines/ingestion/ingest';
import {analyzeDashboardData,type AnalysisConfirmation,type AnalysisQuery} from '../../engines/analysis/pipeline';
import {generateDashboardConfig,type DashboardConfig} from '../../engines/generation/dashboard-templates';
import {buildDashboardWidgets} from '../../engines/visualization/widgets';
export const DEMO_VERSION='illustrative-demo-v1';
export const demoSelectionSchema=z.object({channel:z.enum(['ALL','Web','Shop','Partner']).default('ALL'),period:z.enum(['JAN','FEB']).default('FEB')}).strict();
export const DEMO_ROWS=Object.freeze([
 {order_id:'DEMO-001',customer_id:'DEMO-C01',product:'Sample item A',day:'2026-01-05',channel:'Web',amount:100,cost:40,quantity:1},
 {order_id:'DEMO-002',customer_id:'DEMO-C02',product:'Sample item B',day:'2026-01-12',channel:'Web',amount:200,cost:80,quantity:2},
 {order_id:'DEMO-003',customer_id:'DEMO-C01',product:'Sample item A',day:'2026-01-18',channel:'Shop',amount:150,cost:60,quantity:1},
 {order_id:'DEMO-004',customer_id:'DEMO-C03',product:'Sample item B',day:'2026-01-25',channel:'Partner',amount:250,cost:100,quantity:2},
 {order_id:'DEMO-005',customer_id:'DEMO-C01',product:'Sample item A',day:'2026-02-05',channel:'Web',amount:180,cost:72,quantity:1},
 {order_id:'DEMO-006',customer_id:'DEMO-C02',product:'Sample item B',day:'2026-02-12',channel:'Web',amount:220,cost:88,quantity:2},
 {order_id:'DEMO-007',customer_id:'DEMO-C04',product:'Sample item A',day:'2026-02-18',channel:'Shop',amount:200,cost:80,quantity:1},
 {order_id:'DEMO-008',customer_id:'DEMO-C03',product:'Sample item B',day:'2026-02-25',channel:'Partner',amount:300,cost:120,quantity:2},
].map(row=>Object.freeze(row)));
const columns=['order_id','customer_id','product','day','channel','amount','cost','quantity'] as const;
export const DEMO_CSV=columns.join(',')+'\r\n'+DEMO_ROWS.map(row=>columns.map(field=>String(row[field])).join(',')).join('\r\n')+'\r\n';
export const DEMO_CONFIRMATION:AnalysisConfirmation={confirmedMappings:[['order_id','ORDER'],['customer_id','CUSTOMER'],['product','PRODUCT'],['day','TIME'],['channel','CHANNEL'],['amount','REVENUE'],['cost','COST'],['quantity','QUANTITY']].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept:canonicalConcept as AnalysisConfirmation['confirmedMappings'][number]['canonicalConcept'],status:'CONFIRMED'})),metricRules:{versionId:DEMO_VERSION,grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',timezone:'UTC'}};
/** A fixed synthetic dataset only: no database, session, storage object, external request or tenant identifier is accepted. */
export function buildSampleDashboard(input:unknown={}){
 const selection=demoSelectionSchema.parse(input),prepared=prepareDashboardRows(DEMO_ROWS.map(row=>({...row})),['order_id','customer_id']);
 const dates=selection.period==='FEB'?{start:'2026-02-01',end:'2026-02-28'}:{start:'2026-01-01',end:'2026-01-31'};
 const query:AnalysisQuery={filters:[{type:'DATE_RANGE',field:'day',value:dates.start,end:dates.end},...(selection.channel==='ALL'?[]:[{type:'CATEGORY' as const,field:'channel',value:selection.channel}])],compare:selection.period==='FEB',...(selection.period==='FEB'?{comparison:{mode:'PREVIOUS_MONTH' as const}}:{})};
 const metrics=analyzeDashboardData(prepared,DEMO_VERSION,DEMO_CONFIRMATION,query),definition:DashboardConfig=generateDashboardConfig('SALES',metrics.outcomes,'Illustrative sales dashboard');
 definition.widgets.push({id:'demo-revenue-channel',kind:'BAR',metricKey:'REVENUE',title:'Revenue by channel',dimensionField:'channel',visible:true,order:definition.widgets.length},{id:'demo-revenue-day',kind:'LINE',metricKey:'REVENUE',title:'Revenue over time',dimensionField:'day',visible:true,order:definition.widgets.length+1});
 return {selection,definition,query,data:buildDashboardWidgets(definition,prepared,DEMO_VERSION,DEMO_CONFIRMATION,query)};
}
