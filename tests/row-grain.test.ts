import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDashboardRows} from '../src/engines/ingestion/ingest';
import {understandPreparedDataset} from '../src/features/datasets/understanding';
import {inferRowGrain,completeUniqueGrainKeys} from '../src/engines/understanding/row-grain';
import {recognizeDashboardConcept} from '../src/engines/understanding/concept-registry';
import {analysisConfirmationSchema,analyzeDashboardData} from '../src/engines/analysis/pipeline';
import {metricRulesToEngineSemantics} from '../src/features/datasets/metric-rules';
import {dashboardMetricGovernanceVersion} from '../src/engines/metrics/metric-governance';
import {METRIC_DEFINITIONS} from '../src/engines/metrics/metric-engine';
const detect=(rows:Parameters<typeof prepareDashboardRows>[0])=>understandPreparedDataset(prepareDashboardRows(rows));
const rules={versionId:'v1',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',timezone:'America/New_York'};
function analyze(rows:Parameters<typeof prepareDashboardRows>[0],grain:string,mappings:[string,string][],extra={}){
 const confirmation=analysisConfirmationSchema.parse({confirmedMappings:mappings.map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept})),metricRules:{...rules,grain,...extra}});
 return analyzeDashboardData(prepareDashboardRows(rows),'v1',confirmation);
}
test('full-version inference distinguishes document, line, entity and transaction grains without confirmation',()=>{
 const fixtures:[string,Record<string,string|number>[]][]=[
 ['ORDER',[{order_id:'A',revenue:1},{order_id:'B',revenue:2}]],
 ['INVOICE',[{invoice_id:'A',revenue:1},{invoice_id:'B',revenue:2}]],
 ['ORDER_ITEM',[{order_id:'A',line_id:'1',revenue:1},{order_id:'A',line_id:'2',revenue:2},{order_id:'B',line_id:'1',revenue:3}]],
 ['INVOICE_ITEM',[{invoice_number:'A',invoice_line_number:1},{invoice_number:'A',invoice_line_number:2}]],
 ['CUSTOMER',[{customer_id:'A',revenue:1},{customer_id:'B',revenue:2}]],
 ['PRODUCT',[{sku:'A',revenue:1},{sku:'B',revenue:2}]],
 ['TRANSACTION',[{transaction_id:'A',revenue:1},{transaction_id:'B',revenue:2}]],
 ['DAY',[{date:'2026-01-01',revenue:1},{date:'2026-01-02',revenue:2}]],
 ];
 for(const [kind,rows] of fixtures){const u=detect(rows);assert.equal(u.ontology.datasetGrain.kind,kind,kind);assert.equal(u.confirmationRequired,true);assert.equal(u.ontology.datasetGrain.confirmationRequired,true);assert.equal(u.ontology.datasetGrain.rowCount,rows.length);assert.ok(!JSON.stringify(u.ontology.datasetGrain).includes('"A"'));}
 assert.equal(recognizeDashboardConcept('invoice_id'),'INVOICE');assert.equal(recognizeDashboardConcept('transaction_id'),'IDENTIFIER');assert.equal(recognizeDashboardConcept('item_id'),'PRODUCT');
});
test('common line-item aliases retain composite identity without treating product item IDs as lines',()=>{
 for(const key of ['line_item_id','order_line_item_id','invoice_line_item_number']){const u=detect([{invoice_id:'A',[key]:'1'},{invoice_id:'A',[key]:'2'}]);assert.equal(u.ontology.datasetGrain.kind,'INVOICE_ITEM');assert.equal(recognizeDashboardConcept(key),'LINE_ITEM');}
 assert.equal(detect([{order_id:'A',item_id:'SKU1'},{order_id:'A',item_id:'SKU2'}]).ontology.datasetGrain.kind,'UNDETERMINED');
});
test('incomplete, ambiguous, repeated and undersized identities remain undetermined',()=>{
 for(const rows of [
 [{order_id:'A',revenue:1}],
 [{order_id:'A',revenue:1},{order_id:'A',revenue:2}],
 [{order_id:'A',line_id:'1'},{order_id:'A',line_id:'1'}],
 [{order_id:'A',line_id:'1'},{order_id:'B',line_id:null}],
 [{order_id:'A',invoice_id:'X'},{order_id:'B',invoice_id:'Y'}],
 [{customer_id:'A',product_id:'X'},{customer_id:'B',product_id:'Y'}],
 [{date:'2026-01-01',revenue:1},{date:'2026-01-01',revenue:2}],
 ])assert.equal(detect(rows).ontology.datasetGrain.kind,'UNDETERMINED');
 assert.equal(completeUniqueGrainKeys([{id:Number.MAX_SAFE_INTEGER+1},{id:2}],['id']),false);
 assert.equal(completeUniqueGrainKeys([{id:true},{id:false}],['id']),false);
 // Composite encoding avoids separator collisions.
 assert.equal(completeUniqueGrainKeys([{a:'A|B',b:'C'},{a:'A',b:'B|C'}],['a','b']),true);
});
test('grain cardinality uses every row, not the preview or approximate profile',()=>{
 const rows=Array.from({length:500},(_,i)=>({id:String(i)}));rows[499].id='0';
 assert.equal(inferRowGrain(rows,[{sourceName:'id',businessConcept:'ORDER'}]).kind,'UNDETERMINED');
});
test('line calculations require composite identity and explicit per-line monetary scope',()=>{
 const rows=[{order:'A',line:'1',amount:100},{order:'A',line:'2',amount:100},{order:'B',line:'1',amount:50}],mappings:[string,string][]=[['order','ORDER'],['line','LINE_ITEM'],['amount','REVENUE']];
 const unconfirmed=analyze(rows,'ORDER_ITEM',mappings);assert.equal(unconfirmed.quality.status,'PASS');assert.equal(unconfirmed.outcomes.find(m=>m.key==='REVENUE')?.status,'NEEDS_CONFIRMATION');assert.equal(unconfirmed.outcomes.find(m=>m.key==='ORDERS')?.value,2);
 const confirmed=analyze(rows,'ORDER_ITEM',mappings,{rowAmountsConfirmed:true});assert.equal(confirmed.outcomes.find(m=>m.key==='REVENUE')?.value,250);
 assert.equal(analyze([...rows,{order:'A',line:'1',amount:7}],'ORDER_ITEM',mappings,{rowAmountsConfirmed:true}).quality.status,'FAIL');
 assert.equal(analyze(rows,'ORDER_ITEM',mappings.filter(([f])=>f!=='line')).quality.status,'FAIL');
});
test('invoice identities never implicitly count as orders',()=>{
 const result=analyze([{invoice:'A',amount:5},{invoice:'B',amount:7}],'INVOICE',[['invoice','INVOICE'],['amount','REVENUE']]);
 assert.equal(result.quality.status,'PASS');assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,12);assert.equal(result.outcomes.find(m=>m.key==='ORDERS')?.value,null);
 const lines=analyze([{invoice:'A',line:'1',amount:5},{invoice:'A',line:'2',amount:7}],'INVOICE_ITEM',[['invoice','INVOICE'],['line','LINE_ITEM'],['amount','REVENUE']],{rowAmountsConfirmed:true});assert.equal(lines.quality.status,'PASS');assert.equal(lines.outcomes.find(m=>m.key==='REVENUE')?.value,12);
});
test('daily grain validates confirmed business days, timezone, completeness and uniqueness',()=>{
 const mappings:[string,string][]=[['day','TIME'],['amount','REVENUE']];
 assert.equal(analyze([{day:'2026-01-01',amount:5},{day:'2026-01-02',amount:7}],'DAY',mappings).quality.status,'PASS');
 for(const extra of [{timezone:null},{timezone:'America/New_York'}]){
 const result=analyze([{day:'2026-01-01T01:00:00Z',amount:5},{day:'2026-01-01T02:00:00Z',amount:7}],'DAY',mappings,extra);assert.equal(result.quality.status,'FAIL');assert.equal(result.outcomes[0].value,null);
 }
 assert.equal(analyze([{day:'bad',amount:1},{day:'2026-01-02',amount:2}],'DAY',mappings).quality.status,'FAIL');
});
test('legacy confirmations and governance hashes remain stable; new monetary scope is versioned',()=>{
 const legacy=analysisConfirmationSchema.parse({confirmedMappings:[{sourceField:'order',canonicalConcept:'ORDER'}],metricRules:rules}).metricRules;
 const policy=metricRulesToEngineSemantics(legacy);assert.equal('rowGrain' in policy,false);
 const definition=METRIC_DEFINITIONS[0],before=dashboardMetricGovernanceVersion(definition,policy);
 assert.equal(dashboardMetricGovernanceVersion(definition,metricRulesToEngineSemantics({...legacy,rowAmountsConfirmed:true})),before);
 assert.notEqual(dashboardMetricGovernanceVersion(definition,metricRulesToEngineSemantics({...legacy,grain:'ORDER_ITEM',rowAmountsConfirmed:true})),dashboardMetricGovernanceVersion(definition,metricRulesToEngineSemantics({...legacy,grain:'ORDER_ITEM',rowAmountsConfirmed:false})));
});
