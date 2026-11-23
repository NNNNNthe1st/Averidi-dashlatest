import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {analysisConfirmationSchema,analyzeDashboardData,type AnalysisQuery} from '../src/engines/analysis/pipeline';
import {columnarMetricAnalysis,frameScope,publishColumnarFrame,readColumnarFrame,queryColumnarSales,compileColumnarSalesSql} from '../src/engines/columnar/engine';

const csv='id,amount,cost,quantity,day,channel,customer\n'
 +'00000001,100.25,40.12,2,2026-01-01,Web,0007\n'
 +'00000002,200.35,80.22,3,2026-01-02,Shop,0008\n'
 +'00000003,50.10,20.00,1,2026-01-03,Web,0007\n';
const checksum=createHash('sha256').update(csv).digest('hex');
const identity={workspaceId:'workspace_1',datasetId:'dataset_1',versionId:'version_1',semanticRevision:3,sourceChecksum:checksum};
const confirmation=analysisConfirmationSchema.parse({
 salesEngine:{version:3,arithmetic:'DECIMAL'},
 confirmedMappings:[
  {sourceField:'id',canonicalConcept:'ORDER'},
  {sourceField:'amount',canonicalConcept:'REVENUE'},
  {sourceField:'cost',canonicalConcept:'COST'},
  {sourceField:'quantity',canonicalConcept:'QUANTITY'},
  {sourceField:'day',canonicalConcept:'TIME'},
  {sourceField:'channel',canonicalConcept:'CHANNEL'},
  {sourceField:'customer',canonicalConcept:'CUSTOMER'},
 ],
 metricRules:{versionId:'version_1',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',
  revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,
  taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',
  returnTreatment:'ALREADY_NETTED',timezone:'America/New_York'}
});
const prepare=()=>prepareDashboardFile({fileName:'input.csv',bytes:Buffer.from(csv),preserveTextFields:['id','customer']});
test('frame identity is scope-bound to workspace, version, revision and checksum',()=>{
 const key=frameScope(identity);
 assert.match(key,/^processed\/workspace_1\/frame_[a-f0-9]+\.bin$/);
 assert.notEqual(key,frameScope({...identity,workspaceId:'workspace_2'}));
 assert.notEqual(key,frameScope({...identity,semanticRevision:4}));
 assert.notEqual(key,frameScope({...identity,sourceChecksum:'a'.repeat(64)}));
 assert.notEqual(key,frameScope({...identity,engineVersion:1000000077,projection:'SALES_PROJECTED'}));
 assert.throws(()=>frameScope({...identity,workspaceId:'../escape'}),/COLUMNAR_INVALID_ID/);
});
test('DuckDB frame preserves raw values, row order, schema and governed metric parity',async(t)=>{
 const folder=await mkdtemp(path.join(tmpdir(),'averidi-frame-'));
 const original=process.env.DASHBOARD_STORAGE_ROOT,backend=process.env.DASHBOARD_STORAGE_BACKEND,flag=process.env.DASHBOARD_COLUMNAR_ENGINE;
 process.env.DASHBOARD_STORAGE_ROOT=folder;process.env.DASHBOARD_STORAGE_BACKEND='local';process.env.DASHBOARD_COLUMNAR_ENGINE='enabled';
 t.after(async()=>{
  if(original===undefined)delete process.env.DASHBOARD_STORAGE_ROOT;else process.env.DASHBOARD_STORAGE_ROOT=original;
  if(backend===undefined)delete process.env.DASHBOARD_STORAGE_BACKEND;else process.env.DASHBOARD_STORAGE_BACKEND=backend;
  if(flag===undefined)delete process.env.DASHBOARD_COLUMNAR_ENGINE;else process.env.DASHBOARD_COLUMNAR_ENGINE=flag;
  await rm(folder,{recursive:true,force:true});
 });
 const prepared=await prepare();
 const frame=await publishColumnarFrame({...identity,prepared,confirmation});
 assert.equal(frame.formatVersion,3);
 assert.equal(frame.rowCount,3);
 assert.match(frame.contentHash??'',/^[a-f0-9]{64}$/);
 assert.equal(frame.projection,'SOURCE');
 const read=await readColumnarFrame(frame,identity);
 assert.deepEqual(read.rows,prepared.rows);
 assert.deepEqual(read.rawRows,prepared.rawRows);
 assert.equal(read.contentHash,frame.contentHash);
 assert.equal(read.rows[0].id,'00000001');
 assert.equal(read.rawRows[0].amount,'100.25');
 assert.deepEqual(read.columns,prepared.columns);
 await assert.rejects(()=>readColumnarFrame(frame,{...identity,workspaceId:'workspace_2'}),/STALE_ANALYSIS/);
 await assert.rejects(()=>readColumnarFrame(frame,{...identity,semanticRevision:4}),/STALE_ANALYSIS/);
 const query:AnalysisQuery={filters:[],compare:false};
 const current=await queryColumnarSales(frame,identity,confirmation,{...query},['REVENUE','COST','PROFIT','GROSS_MARGIN','ORDERS','CUSTOMERS','UNITS']);
 assert.equal(current.REVENUE.exact,'350.7');
 assert.equal(current.COST.exact,'140.34');
 assert.equal(current.PROFIT.exact,'210.36');
 assert.equal(current.ORDERS.value,3);
 assert.equal(current.CUSTOMERS.value,2);
 assert.equal(current.UNITS.value,6);
 const baseline=analyzeDashboardData(prepared,identity.versionId,confirmation,{...query});
 const patched=await columnarMetricAnalysis(frame,identity,confirmation,{...query},baseline);
 for(const key of ['REVENUE','COST','PROFIT','GROSS_MARGIN','ORDERS','CUSTOMERS','UNITS']){
  const a=baseline.outcomes.find(m=>m.key===key),b=patched.outcomes.find(m=>m.key===key);
  assert.equal(a?.status,b?.status);
  assert.equal(a?.value,b?.value);
 }
 const filtered={filters:[{type:'CATEGORY' as const,field:'channel',value:'Web'}],compare:false};
 const selected=await queryColumnarSales(frame,identity,confirmation,filtered,['REVENUE','ORDERS']);
 assert.equal(selected.REVENUE.exact,'150.35');
 assert.equal(selected.ORDERS.value,2);
 const compiled=compileColumnarSalesSql(frame,confirmation,{filters:[{type:'CATEGORY',field:'channel',value:"O'Reilly"}],compare:false},['REVENUE']);
 assert.match(compiled.sql,/O''Reilly/);
 assert.match(compiled.sql,/__af_missing_SUM_REVENUE/);
 const dateFiltered=await queryColumnarSales(frame,identity,confirmation,{
  filters:[{type:'DATE_RANGE',field:'day',value:'2026-01-02',end:'2026-01-03'}],compare:false
 },['REVENUE','ORDERS']);
 assert.equal(dateFiltered.REVENUE.exact,'250.45');
 assert.equal(dateFiltered.ORDERS.value,2);
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(()=>publishColumnarFrame({...identity,prepared,confirmation,signal:aborted.signal}),(error:unknown)=>error instanceof Error&&error.name==='AbortError');
});
test('missing measure is never silently aggregated as zero',async(t)=>{
 const folder=await mkdtemp(path.join(tmpdir(),'averidi-nullframe-'));
 const original=process.env.DASHBOARD_STORAGE_ROOT,backend=process.env.DASHBOARD_STORAGE_BACKEND;
 process.env.DASHBOARD_STORAGE_ROOT=folder;process.env.DASHBOARD_STORAGE_BACKEND='local';
 t.after(async()=>{
  if(original===undefined)delete process.env.DASHBOARD_STORAGE_ROOT;else process.env.DASHBOARD_STORAGE_ROOT=original;
  if(backend===undefined)delete process.env.DASHBOARD_STORAGE_BACKEND;else process.env.DASHBOARD_STORAGE_BACKEND=backend;
  await rm(folder,{recursive:true,force:true});
 });
 const missing='id,amount,cost,quantity,day,channel,customer\n00000001,100,40,2,2026-01-01,Web,0007\n00000002,,80,1,2026-01-02,Web,0008\n';
 const prepared=await prepareDashboardFile({bytes:Buffer.from(missing),fileName:'null.csv',preserveTextFields:['id','customer']});
 const scoped={...identity,versionId:'version_1',sourceChecksum:createHash('sha256').update(missing).digest('hex')};
 const frame=await publishColumnarFrame({...scoped,prepared,confirmation});
 await assert.rejects(()=>queryColumnarSales(frame,scoped,confirmation,{filters:[],compare:false},['REVENUE']),/SALES_PLAN_INPUT/);
});
