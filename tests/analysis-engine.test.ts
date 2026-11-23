import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {analysisConfirmationSchema,analyzeDashboardData,analysisQuerySchema,retainedTextFields} from '../src/engines/analysis/pipeline';
import {buildDashboardWidgets} from '../src/engines/visualization/widgets';
import {generateDashboardConfig,addDashboardWidget} from '../src/engines/generation/dashboard-templates';
import {exportDashboardMetricReport} from '../src/engines/reporting/metric-report';
const confirmation=analysisConfirmationSchema.parse({confirmedMappings:[{sourceField:'id',canonicalConcept:'ORDER'},{sourceField:'amount',canonicalConcept:'REVENUE'},{sourceField:'cost',canonicalConcept:'COST'},{sourceField:'day',canonicalConcept:'TIME'},{sourceField:'channel',canonicalConcept:'CHANNEL'}],metricRules:{versionId:'v1',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',timezone:'America/New_York'}});
const csv='id,amount,cost,day,channel\n001,50,20,2026-01-01,Shop\n002,100,40,2026-01-02,Web\n003,200,80,2026-01-03,Web\n';
async function prepared(){return prepareDashboardFile({bytes:Buffer.from(csv),fileName:'orders.csv',preserveTextFields:retainedTextFields(confirmation)});}
test('analysis preserves numeric-looking IDs and calculates traced business metrics',async()=>{
 const p=await prepared();assert.equal(p.rows[0].id,'001');assert.equal(p.rows[0].day,'2026-01-01T00:00:00.000Z');
 const r=analyzeDashboardData(p,'v1',confirmation);assert.equal(r.quality.status,'PASS');
 const values=Object.fromEntries(r.outcomes.map(m=>[m.key,m.value]));assert.equal(values.REVENUE,350);assert.equal(values.COST,140);assert.equal(values.PROFIT,210);assert.equal(values.GROSS_MARGIN,.6);assert.equal(values.ORDERS,3);
 assert.deepEqual(r.outcomes[0].lineage.fields,['amount']);assert.equal(r.outcomes[0].lineage.datasetVersionId,'v1');
});
test('analysis refuses duplicate rows, invalid grain and guessed or ambiguous inputs',async()=>{
 const p=await prepared();assert.equal(analyzeDashboardData({...p,duplicateCount:1},'v1',confirmation).quality.status,'FAIL');
 const c=structuredClone(confirmation);c.confirmedMappings.push({sourceField:'cost',canonicalConcept:'REVENUE'});
 assert.equal(analyzeDashboardData(p,'v1',c).outcomes.find(m=>m.key==='REVENUE')?.status,'NEEDS_CONFIRMATION');
 assert.equal(analyzeDashboardData({...p,rows:[p.rows[0],p.rows[0]]},'v1',confirmation).quality.status,'FAIL');
});
test('confirmed filters and previous-period comparison calculate actual selected records',async()=>{
 const r=analyzeDashboardData(await prepared(),'v1',confirmation,analysisQuerySchema.parse({filters:[{type:'DATE_RANGE',field:'day',value:'2026-01-02',end:'2026-01-03'}],compare:true}));
 // Shared ingestion retains legacy timestamp semantics: UTC midnight is the prior New York day.
 assert.equal(r.outcomes.find(m=>m.key==='REVENUE')?.value,200);assert.deepEqual(r.comparison?.REVENUE,{current:200,previous:150,absolute:50,percentage:1/3});
 assert.throws(()=>analyzeDashboardData({} as never,'v1',confirmation,analysisQuerySchema.parse({filters:[{type:'CATEGORY',field:'unknown',value:'x'}]})));
 const empty=analyzeDashboardData(await prepared(),'v1',confirmation,analysisQuerySchema.parse({filters:[{type:'CATEGORY',field:'channel',value:'none'}]}));assert.equal(empty.outcomes[0].value,null);
});
test('charts and CSV reports use computed grouped values and prevent spreadsheet formulas',async()=>{
 const p=await prepared(),r=analyzeDashboardData(p,'v1',confirmation);const config=addDashboardWidget(generateDashboardConfig('SALES',r.outcomes),'REVENUE','BAR','channel',r.outcomes,['channel']);
 const data=buildDashboardWidgets(config,p,'v1',confirmation,{filters:[],compare:false});assert.deepEqual(data.widgets.at(-1)?.series.map(p=>[p.label,p.value]),[['Shop',50],['Web',300]]);
 const report=exportDashboardMetricReport({...data,analysisId:'run1',versionId:'v1',sourceChecksum:'checked'});assert.match(report,/350/);assert.match(report,/checked/);assert.match(report,/amount/);
 const bad=structuredClone(data);bad.widgets[0].title='=HYPERLINK("x")';assert.match(exportDashboardMetricReport({...bad,analysisId:'r',versionId:'v',sourceChecksum:'c'}),/'=HYPERLINK/);
});
