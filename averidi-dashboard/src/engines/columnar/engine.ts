import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Prisma} from '@prisma/client';
import {dashboardWorkspaceArtifactKey,readDashboardObject,writeDashboardObject} from '../../server/storage';
import {dashboardBusinessDay,comparablePeriods} from '../metrics/business-period';
import {normalizeBusinessUnits} from '../metrics/units';
import {compileSalesPlan} from '../metrics/sales-calculation-plan';
import {confirmedDimensions,type AnalysisConfirmation,type AnalysisQuery,type DashboardAnalysis,ANALYSIS_ENGINE_VERSION} from '../analysis/pipeline';
import {analysisComparisonPeriods,effectiveAnalysisFilters} from '../analysis/query-contracts';
import {metricComparison} from '../metrics/metric-engine';
import type {DashboardPreparedData,DashboardRow,DashboardColumn} from '../ingestion/ingest';

/** All file paths, column identifiers and SQL are server-built; no user SQL is accepted. */
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const nameFor=(index:number)=>'__af_src_'+index;
const conceptName=(index:number)=>'__af_concept_'+index;
const dayName=(index:number)=>'__af_business_day_'+index;
const FRAME_PREFIX='columnar-v3';
const DECIMAL='DECIMAL(38,12)';
const moneyConcepts=new Set(['REVENUE','COST','REFUND','DISCOUNT','QUANTITY','RETURN_QUANTITY','INVENTORY_ON_HAND','INVENTORY_DEMAND','MARKETING_SPEND','SALES_OPEN_PIPELINE_VALUE']);
type SourceField={source:string;stored:string;valueStored:string;rawStored:string;dataType:DashboardColumn['dataType']};
type CanonicalField={concept:string;stored:string;source:string;numeric:boolean};
export type ColumnarFrame={
 format:'PARQUET';formatVersion:3;projection:'SOURCE'|'SALES_PROJECTED';versionId:string;workspaceId:string;datasetId:string;
 semanticRevision:number;engineVersion:number;sourceChecksum:string;artifactKey:string;
 artifactChecksum:string;rowCount:number;duplicateCount:number;columns:DashboardColumn[];
 contentHash?:string;
 sourceFields:SourceField[];canonicalFields:CanonicalField[];
 businessDays:{source:string;stored:string;invalidCount:number}[];
 profile:DashboardPreparedData['profile'];
};
export function columnarEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.DASHBOARD_COLUMNAR_ENGINE==='enabled';
}
export function frameScope(input:{workspaceId:string;datasetId:string;versionId:string;semanticRevision:number;sourceChecksum:string;engineVersion?:number;projection?:'SOURCE'|'SALES_PROJECTED'}){
 if(![input.workspaceId,input.datasetId,input.versionId].every(id=>/^[A-Za-z0-9_-]{1,128}$/.test(id)))throw Error('COLUMNAR_INVALID_ID');
 if(!Number.isSafeInteger(input.semanticRevision)||input.semanticRevision<0||!Number.isSafeInteger(input.engineVersion??ANALYSIS_ENGINE_VERSION)||(input.engineVersion??ANALYSIS_ENGINE_VERSION)<0||!/^[a-f\d]{64}$/i.test(input.sourceChecksum))throw Error('COLUMNAR_INVALID_REVISION');
 const identity=JSON.stringify([FRAME_PREFIX,input.workspaceId,input.datasetId,input.versionId,input.semanticRevision,input.engineVersion??ANALYSIS_ENGINE_VERSION,input.projection??'SOURCE',input.sourceChecksum]);
 const artifactId='frame_'+hash(identity).slice(0,56);
 return dashboardWorkspaceArtifactKey('processed',input.workspaceId,artifactId);
}
function metadataColumns(prepared:DashboardPreparedData,confirmation:AnalysisConfirmation){
 const sourceFields=prepared.columns.map((col,i)=>({source:col.name,stored:nameFor(i),valueStored:'__af_val_'+i,rawStored:'__af_raw_'+i,dataType:col.dataType}));
 const mappings=confirmation.confirmedMappings.filter(m=>m.canonicalConcept!=='IGNORE'&&prepared.columns.some(c=>c.name===m.sourceField));
 const counts=new Map<string,number>();
 for(const m of mappings)counts.set(m.canonicalConcept,(counts.get(m.canonicalConcept)??0)+1);
 const canonicalFields=mappings.filter(m=>counts.get(m.canonicalConcept)===1).map((m,i)=>({concept:m.canonicalConcept,stored:conceptName(i),source:m.sourceField,numeric:moneyConcepts.has(m.canonicalConcept)}));
 const businessDays=confirmedDimensions(confirmation).filter(d=>d.role==='DATE').map((d,i)=>({source:d.field,stored:dayName(i),invalidCount:0}));
 return {sourceFields,canonicalFields,businessDays};
}
async function duckdbConnection(){
 // A private in-process database. Connection is never exposed to clients.
 const {DuckDBInstance}=await import('@duckdb/node-api');
 const instance=await DuckDBInstance.create(':memory:',{threads:'2',memory_limit:'512MB'});
 return instance.connect();
}
async function runDuckdbCancellable(connection:Awaited<ReturnType<typeof duckdbConnection>>,sql:string,signal?:AbortSignal):Promise<Array<Record<string,unknown>>>{
 const {DuckDBPendingResultState}=await import('@duckdb/node-api');
 signal?.throwIfAborted();
 const pending=await connection.start(sql);
 for(;;){
   signal?.throwIfAborted();
   const state=pending.runTask();
   if(state===DuckDBPendingResultState.RESULT_READY)break;
   await new Promise<void>(resolve=>setImmediate(resolve));
  }
  signal?.throwIfAborted();
  const reader=await pending.readAll();
  signal?.throwIfAborted();
  // @duckdb/node-api 1.4.x does not expose closeSync() on pending results/readers.
  // Once consumed and out of scope, the API releases these result objects automatically.
 return reader.getRowObjectsJson() as Array<Record<string,unknown>>;
}
async function withPrivateDirectory<T>(run:(folder:string)=>Promise<T>):Promise<T>{
 const folder=await mkdtemp(path.join(tmpdir(),'dashboard-frame-'));
 try{return await run(folder);}finally{await rm(folder,{recursive:true,force:true});}
}
function sourceCell(value:DashboardRow[string]):string|null{
 if(value===null||value===undefined)return null;
 if(typeof value==='number'&&!Number.isFinite(value))throw Error('COLUMNAR_INVALID_NUMBER');
 return String(value);
}
function assertParquet(bytes:Buffer){if(bytes.length<12||bytes.subarray(0,4).toString()!=='PAR1'||bytes.subarray(-4).toString()!=='PAR1')throw Error('COLUMNAR_INVALID_PARQUET');}
function sqlJsonColumns(names:string[]){return '{'+names.map(n=>literal(n)+': '+literal('VARCHAR')).join(', ')+'}';}
function frameProjection(columns:ReturnType<typeof metadataColumns>){
 const projection=columns.sourceFields.flatMap(c=>[quote(c.stored),quote(c.valueStored),quote(c.rawStored)]);
 projection.push('CAST("__af_idx" AS BIGINT) AS "__af_idx"');
 for(const field of columns.canonicalFields){
  const source=columns.sourceFields.find(c=>c.source===field.source);
  if(!source)throw Error('COLUMNAR_FIELD_NOT_FOUND');
  projection.push(field.numeric
   ?`TRY_CAST(${quote(field.stored)} AS ${DECIMAL}) AS ${quote(field.stored)}`
   :quote(field.stored));
 }
 projection.push(...columns.businessDays.map(f=>`TRY_CAST(${quote(f.stored)} AS DATE) AS ${quote(f.stored)}`));
 return projection.join(', ');
}
function inputMappings(confirmation:AnalysisConfirmation){
 return confirmation.confirmedMappings.map(m=>({...m,status:'CONFIRMED',role:m.canonicalConcept==='IGNORE'?'IGNORE':moneyConcepts.has(m.canonicalConcept)?'MEASURE':'DIMENSION'}));
}
export async function publishColumnarFrame(input:{
 workspaceId:string;datasetId:string;versionId:string;semanticRevision:number;sourceChecksum:string;
 engineVersion?:number;projection?:'SOURCE'|'SALES_PROJECTED';
 prepared:DashboardPreparedData;confirmation:AnalysisConfirmation;signal?:AbortSignal;
}):Promise<ColumnarFrame>{
 const {prepared,confirmation,signal}=input;
 const artifactKey=frameScope(input);
 // Canonical hashing depends on row position and projected column order, not
 // JavaScript property insertion order (Sales creates calculated fields).
 const calculatedHash=hash(JSON.stringify(prepared.rows.map(row=>
  prepared.columns.map(column=>row[column.name]??null))));
 const columns=metadataColumns(prepared,confirmation);
 const mappings=inputMappings(confirmation);
 const normalized=normalizeBusinessUnits(prepared.rows,mappings,confirmation.metricRules.units).rows;
 const originals=new Map(columns.sourceFields.map(f=>[f.source,f]));
 const dayCounts=new Map(columns.businessDays.map(f=>[f.source,0]));
 const bytes=await withPrivateDirectory(async folder=>{
  const json=path.join(folder,'rows-'+randomUUID()+'.jsonl');
  const parquet=path.join(folder,'frame-'+randomUUID()+'.parquet');
  const chunks:string[]=[];
  for(let i=0;i<prepared.rows.length;i++){
   signal?.throwIfAborted();
   const row=prepared.rows[i],normalizedRow=normalized[i];
   const record:Record<string,string|null>={};
   record.__af_idx=String(i);
   for(const f of columns.sourceFields){
    record[f.stored]=sourceCell(row[f.source]);
    record[f.valueStored]=JSON.stringify(row[f.source]??null);
    record[f.rawStored]=JSON.stringify(prepared.rawRows[i]?.[f.source]??null);
   }
   for(const f of columns.canonicalFields){
    const source=originals.get(f.source);
    const value=normalizedRow[source!.source];
    record[f.stored]=sourceCell(value);
   }
   for(const f of columns.businessDays){
    const day=confirmation.metricRules.timezone?dashboardBusinessDay(row[f.source],confirmation.metricRules.timezone):null;
    if(day===null)dayCounts.set(f.source,(dayCounts.get(f.source)??0)+1);
    record[f.stored]=day;
   }
   chunks.push(JSON.stringify(record));
  }
  await writeFile(json,chunks.join('\n')+'\n',{flag:'wx',mode:0o600});
  signal?.throwIfAborted();
  const connection=await duckdbConnection();
  const names=['__af_idx',...columns.sourceFields.flatMap(f=>[f.stored,f.valueStored,f.rawStored]),...columns.canonicalFields.map(f=>f.stored),...columns.businessDays.map(f=>f.stored)];
  // Explicit VARCHAR input schema prevents numeric inference from corrupting leading-zero identifiers.
  const sql=`COPY (SELECT ${frameProjection(columns)} FROM read_json(${literal(json)},format='newline_delimited',columns=${sqlJsonColumns(names)})) TO ${literal(parquet)} (FORMAT PARQUET,COMPRESSION ZSTD)`;
  try{await runDuckdbCancellable(connection,sql,signal);}finally{connection.closeSync();}
  signal?.throwIfAborted();
  return readFile(parquet);
 });
 assertParquet(bytes);
 const artifactChecksum=hash(bytes);
 // The object key is deterministic. Never silently replace a different immutable revision.
 let existing:Buffer|null=null;
 try{existing=await readDashboardObject(artifactKey);}
 catch(e){const err=e as NodeJS.ErrnoException;
  if(err.code!=='ENOENT'&&!/not found|404/i.test(err.message))throw e;
 }
 if(existing&&hash(existing)!==artifactChecksum)throw Error('COLUMNAR_IMMUTABILITY_CONFLICT');
 if(!existing){
  signal?.throwIfAborted();
  try{await writeDashboardObject(artifactKey,bytes);}
  catch(error){
   // A competing retry can win the same immutable object key.
   let winner:Buffer;
   try{winner=await readDashboardObject(artifactKey);}catch{throw error;}
   if(hash(winner)!==artifactChecksum)throw Error('COLUMNAR_IMMUTABILITY_CONFLICT');
  }
 }
 return {
  format:'PARQUET',formatVersion:3,projection:input.projection??'SOURCE',versionId:input.versionId,workspaceId:input.workspaceId,datasetId:input.datasetId,
  semanticRevision:input.semanticRevision,engineVersion:input.engineVersion??ANALYSIS_ENGINE_VERSION,sourceChecksum:input.sourceChecksum,
  artifactKey,artifactChecksum,rowCount:prepared.rows.length,duplicateCount:prepared.duplicateCount,contentHash:calculatedHash,
  columns:prepared.columns,sourceFields:columns.sourceFields,canonicalFields:columns.canonicalFields,
  businessDays:columns.businessDays.map(d=>({...d,invalidCount:dayCounts.get(d.source)??0})),profile:prepared.profile
 };
}
export function assertFrameIdentity(frame:ColumnarFrame,input:{
 workspaceId:string;datasetId:string;versionId:string;semanticRevision:number;sourceChecksum:string;
 engineVersion?:number;projection?:'SOURCE'|'SALES_PROJECTED';
}){
 if(frame.format!=='PARQUET'||frame.formatVersion!==3||frame.engineVersion!==(input.engineVersion??ANALYSIS_ENGINE_VERSION)||frame.projection!==(input.projection??'SOURCE')||
  frame.workspaceId!==input.workspaceId||frame.datasetId!==input.datasetId||frame.versionId!==input.versionId||
  frame.semanticRevision!==input.semanticRevision||frame.sourceChecksum!==input.sourceChecksum||
  frame.artifactKey!==frameScope(input)||!/^[a-f\d]{64}$/i.test(frame.artifactChecksum))throw Error('STALE_ANALYSIS');
}
export async function readColumnarFrame(frame:ColumnarFrame,input:{
 workspaceId:string;datasetId:string;versionId:string;semanticRevision:number;sourceChecksum:string;
 engineVersion?:number;projection?:'SOURCE'|'SALES_PROJECTED';
}):Promise<DashboardPreparedData>{
 assertFrameIdentity(frame,input);
 if(frame.columns.length!==frame.sourceFields.length||frame.rowCount<1||frame.rowCount>50000||
  frame.sourceFields.some((f,i)=>f.source!==frame.columns[i]?.name||f.stored!=='__af_src_'+i||f.valueStored!=='__af_val_'+i||f.rawStored!=='__af_raw_'+i))throw Error('COLUMNAR_FRAME_SCHEMA_INVALID');
 const bytes=await readDashboardObject(frame.artifactKey);
 if(hash(bytes)!==frame.artifactChecksum)throw Error('SOURCE_INTEGRITY_FAILURE');
 assertParquet(bytes);
 return withPrivateDirectory(async folder=>{
  const file=path.join(folder,'frame.parquet');
  await writeFile(file,bytes,{flag:'wx',mode:0o600});
  const db=await duckdbConnection();
  const fields=frame.sourceFields.flatMap(f=>[quote(f.stored),quote(f.valueStored),quote(f.rawStored)]).join(',');
  let objects:Array<Record<string,unknown>>;
  try{objects=(await db.runAndReadAll(`SELECT ${fields} FROM read_parquet(${literal(file)}) ORDER BY "__af_idx"`)).getRowObjectsJson() as Array<Record<string,unknown>>;}
  finally{db.closeSync();}
  if(objects.length!==frame.rowCount)throw Error('COLUMNAR_ROW_COUNT_MISMATCH');
  const decode=(encoded:unknown):DashboardRow[string]=>{
   if(typeof encoded!=='string')throw Error('COLUMNAR_CELL_INVALID');
   const value=JSON.parse(encoded) as DashboardRow[string];
   if(value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw Error('COLUMNAR_CELL_INVALID');
   if(typeof value==='number'&&!Number.isFinite(value))throw Error('COLUMNAR_CELL_INVALID');
   return value;
  };
  const rows=objects.map(object=>Object.fromEntries(frame.sourceFields.map(f=>[f.source,decode(object[f.valueStored])])) as DashboardRow);
  const rawRows=objects.map(object=>Object.fromEntries(frame.sourceFields.map(f=>{
   return [f.source,decode(object[f.rawStored])];
  })) as DashboardRow);
  const contentHash=hash(JSON.stringify(rows.map(row=>frame.columns.map(column=>row[column.name]??null))));
  if(!frame.contentHash||contentHash!==frame.contentHash)throw Error('SOURCE_INTEGRITY_FAILURE');
  return {rows,rawRows,columns:frame.columns,
   duplicateCount:frame.duplicateCount,profile:frame.profile,preview:rows.slice(0,20),
   contentHash};
 });
}
/** SQL compilation produces the governed expression and a lossless aggregate
 * projection. Ratios are evaluated with Prisma.Decimal after DuckDB aggregations:
 * DuckDB's native DECIMAL division can otherwise return DOUBLE. */
export function compileColumnarSalesSql(frame:ColumnarFrame,confirmation:AnalysisConfirmation,query:AnalysisQuery,requested?:readonly string[]){
 const rule=confirmation.metricRules;
 const plan=compileSalesPlan(rule.currency??'USD',{refunds:rule.refundsIncluded===false,discounts:rule.discountsIncluded===false,returns:rule.returnTreatment==='DEDUCT_RETURNED_UNITS'});
 const fields=new Map(frame.canonicalFields.map(f=>[f.concept,f]));
 const dims=new Map(confirmedDimensions(confirmation).map(d=>[d.field,d]));
 const predicate:string[]=[];
 const dateValidationPredicates:string[]=[];
 if(rule.cancellationTreatment==='EXCLUDE_ROWS'){
  const status=fields.get('STATUS');
  if(!status||rule.grain!=='ORDER')throw Error('COLUMNAR_CANCELLATION_UNCONFIRMED');
  const column=quote(status.stored);
  predicate.push(`UPPER(TRIM(CAST(${column} AS VARCHAR))) NOT IN ('CANCELLED','CANCELED','VOID','VOIDED')`);
 }
 for(const filter of query.filters){
  const dim=dims.get(filter.field);
  if(!dim)throw Error('UNCONFIRMED_FILTER');
  if(filter.type==='DATE_RANGE'){
   if(dim.role!=='DATE'||!rule.timezone||!filter.end)throw Error('CONFIRMED_TIMEZONE_REQUIRED');
   comparablePeriods(filter.value,filter.end);
   const day=frame.businessDays.find(x=>x.source===filter.field);
   if(!day)throw Error('INVALID_DATE_VALUES');
   // The reference engine requires valid business dates in the population
   // surviving preceding filters, even if those rows fall outside the range.
   if(day.invalidCount>0){
    const selection=predicate.length?predicate.join(' AND ')+' AND ':'';
    dateValidationPredicates.push(`${selection}${quote(day.stored)} IS NULL`);
   }
   predicate.push(`${quote(day.stored)} BETWEEN DATE ${literal(filter.value)} AND DATE ${literal(filter.end)}`);
  }else{
   const source=frame.sourceFields.find(f=>f.source===filter.field);
   if(!source)throw Error('UNCONFIRMED_FILTER');
   if(filter.type==='MISSING'&&(filter.value!==''||filter.end!==undefined)||
      filter.type==='CATEGORY'&&filter.end!==undefined)throw Error('INVALID_CATEGORY_FILTER');
   predicate.push(filter.type==='MISSING'?`${quote(source.stored)} IS NULL`:`${quote(source.stored)} = ${literal(filter.value)}`);
  }
 }
 const missing=():never=>{throw Error('COLUMNAR_REQUIRED_CONCEPT_UNAVAILABLE');};
 const primitive=new Map<string,{field:string;op:'SUM'|'DISTINCT';expr:string;missingCount:string}>();
 type Node=ReturnType<typeof compileSalesPlan>['definitions'][string]['expression'];
 function compiled(node:Node):string{
  if(node.op==='REF'){const d=plan.definitions[node.key];if(!d)throw Error('SALES_PLAN_DEPENDENCY');return compiled(d.expression);}
  if(node.op==='SUM'||node.op==='DISTINCT'){
   const field=fields.get(node.field)??missing();
   if(node.op==='SUM'&&!field.numeric)throw Error('COLUMNAR_NONNUMERIC_MEASURE');
   const col=quote(field.stored),key=node.op+'_'+node.field;
   if(!primitive.has(key)){
    const absent=node.op==='SUM'?`${col} IS NULL`:`${col} IS NULL OR LENGTH(TRIM(CAST(${col} AS VARCHAR)))=0`;
    const result=node.op==='SUM'?`SUM(${col})`:`COUNT(DISTINCT ${col})`;
    primitive.set(key,{field:node.field,op:node.op,expr:`CASE WHEN COUNT(*) FILTER (WHERE ${absent}) > 0 THEN NULL ELSE CAST(COALESCE(${result},0) AS VARCHAR) END`,missingCount:`COUNT(*) FILTER (WHERE ${absent})`});
   }
   return `CAST(${primitive.get(key)!.expr} AS ${DECIMAL})`;
  }
  const a=compiled(node.left),b=compiled(node.right);
  return node.op==='SUBTRACT'?`(${a} - ${b})`:`(${a} / NULLIF(${b},0))`;
 }
 const keys=(requested??plan.order).filter(key=>Boolean(plan.definitions[key]));
 const formulas=Object.fromEntries(keys.map(key=>[key,compiled(plan.definitions[key].expression)]));
 const aggregateSql=[...primitive].flatMap(([key,x])=>[`${x.expr} AS ${quote(key)}`,`${x.missingCount} AS ${quote('__af_missing_'+key)}`]).join(',');
 // The complete governed expression tree is compiled into the executed SELECT.
 // Ratio values produced by DuckDB / are advisory only: the authoritative ratio
 // is recomputed from the exact aggregate strings using Prisma.Decimal below.
 const formulaSql=Object.entries(formulas).map(([key,expression])=>`${expression} AS ${quote('__af_formula_'+key)}`).join(',');
 return {plan,formulas,primitive:[...primitive.keys()],
  dateValidationSql:dateValidationPredicates.length?
   `SELECT ${dateValidationPredicates.map((p,i)=>`COUNT(*) FILTER (WHERE ${p}) AS ${quote('invalid_'+i)}`).join(',')} FROM __FRAME__`:null,
  sql:`SELECT ${[aggregateSql,formulaSql].filter(Boolean).join(',')||'COUNT(*) AS row_count'} FROM __FRAME__${predicate.length?' WHERE '+predicate.join(' AND '):''}`};
}
export async function queryColumnarSales(frame:ColumnarFrame,input:{
 workspaceId:string;datasetId:string;versionId:string;semanticRevision:number;sourceChecksum:string;
 engineVersion?:number;projection?:'SOURCE'|'SALES_PROJECTED';
},confirmation:AnalysisConfirmation,query:AnalysisQuery,requested?:readonly string[],signal?:AbortSignal){
 assertFrameIdentity(frame,input);
 const compiled=compileColumnarSalesSql(frame,confirmation,query,requested);
 const bytes=await readDashboardObject(frame.artifactKey);
 if(hash(bytes)!==frame.artifactChecksum)throw Error('SOURCE_INTEGRITY_FAILURE');
 assertParquet(bytes);
 return withPrivateDirectory(async folder=>{
  const file=path.join(folder,'frame.parquet');
  await writeFile(file,bytes,{flag:'wx',mode:0o600});
  signal?.throwIfAborted();
  const db=await duckdbConnection();
  const source=`read_parquet(${literal(file)})`;
  let rows:Array<Record<string,unknown>>;
  try{
   signal?.throwIfAborted();
   if(compiled.dateValidationSql){
    const checkSql=compiled.dateValidationSql.replace('__FRAME__',source);
    const invalid=await runDuckdbCancellable(db,checkSql,signal);
    if(Object.values(invalid[0]??{}).some(v=>Number(v)>0))throw Error('INVALID_DATE_VALUES');
   }
   const sql=compiled.sql.replace('__FRAME__',source);
   rows=await runDuckdbCancellable(db,sql,signal);
  }finally{db.closeSync();}
  signal?.throwIfAborted();
  const values=rows[0]??{};
  const Decimal=Prisma.Decimal.clone({precision:40,rounding:Prisma.Decimal.ROUND_HALF_UP});
  const primitives=new Map<string,InstanceType<typeof Decimal>>();
  for(const key of compiled.primitive){const missing=values['__af_missing_'+key];if(missing===null||missing===undefined||Number(missing)>0||!Number.isSafeInteger(Number(missing)))throw Error('SALES_PLAN_INPUT');const v=values[key];if(v===null||v===undefined)throw Error('SALES_PLAN_INPUT');primitives.set(key,new Decimal(String(v)));}
  type Node=ReturnType<typeof compileSalesPlan>['definitions'][string]['expression'];
  const memo=new Map<string,InstanceType<typeof Decimal>>();
  function evaluate(node:Node):InstanceType<typeof Decimal>{
   if(node.op==='REF')return metric(node.key);
   if(node.op==='SUM'||node.op==='DISTINCT')return primitives.get(node.op+'_'+node.field)!;
   const a=evaluate(node.left),b=evaluate(node.right);
   if(node.op==='SUBTRACT')return a.minus(b);
   if(b.isZero())throw Error('SALES_PLAN_ZERO_DENOMINATOR');
   return a.div(b);
  }
  function metric(key:string):InstanceType<typeof Decimal>{
   if(memo.has(key))return memo.get(key)!;
   const def=compiled.plan.definitions[key];if(!def)throw Error('SALES_PLAN_DEPENDENCY');
   const value=evaluate(def.expression);memo.set(key,value);return value;
  }
  return Object.fromEntries(Object.keys(compiled.formulas).map(key=>{
   const exact=metric(key),value=exact.toNumber();
   if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error('SALES_PLAN_RANGE');
   return [key,{value,exact:exact.toFixed(),unit:compiled.plan.units[key],aggregation:compiled.plan.definitions[key].aggregation}];
  }));
 });
}

/** Centralized governed-metric overlay for direct queries and saved dashboards.
 * All existing eligibility and unavailability decisions come from the reference
 * analysis; columnar results may not silently promote an unavailable metric. */
export async function columnarMetricAnalysis(
 frame:ColumnarFrame|undefined,
 identity:{workspaceId:string;datasetId:string;versionId:string;semanticRevision:number;sourceChecksum:string;engineVersion?:number;projection?:'SOURCE'|'SALES_PROJECTED'},
 confirmation:AnalysisConfirmation,
 query:AnalysisQuery,
 reference:DashboardAnalysis,
 signal?:AbortSignal
):Promise<DashboardAnalysis>{
 if(!columnarEnabled()||!frame||frame.formatVersion!==3||!confirmation.salesEngine||
  reference.quality.status!=='PASS')return reference;
 assertFrameIdentity(frame,identity);
 // Keep a non-optional reference for nested helpers; TypeScript cannot preserve
 // the outer guard's narrowing inside the supported() closure.
 const activeFrame=frame;
 const rules=confirmation.metricRules;
 const plan=compileSalesPlan(rules.currency??'USD',{
  refunds:rules.refundsIncluded===false,discounts:rules.discountsIncluded===false,
  returns:rules.returnTreatment==='DEDUCT_RETURNED_UNITS'
 });
 const available=new Set(activeFrame.canonicalFields.map(f=>f.concept));
 type Node=typeof plan.definitions[string]['expression'];
 function supported(node:Node,visiting=new Set<string>()):boolean{
  if(node.op==='SUM'||node.op==='DISTINCT')return available.has(node.field)&&(node.op==='DISTINCT'||activeFrame.canonicalFields.find(f=>f.concept===node.field)?.numeric===true);
  if(node.op==='REF'){
   if(visiting.has(node.key))return false;
   const d=plan.definitions[node.key];if(!d)return false;
   visiting.add(node.key);return supported(d.expression,visiting);
  }
  return supported(node.left,new Set(visiting))&&supported(node.right,new Set(visiting));
 }
 const keys=reference.outcomes.filter(m=>m.status==='READY'&&plan.definitions[m.key]&&supported(plan.definitions[m.key].expression)).map(m=>m.key);
 if(!keys.length)return reference;
 const periods=analysisComparisonPeriods(query);
 const governedFilters=reference.outcomes.find(m=>m.status==='READY')?.lineage.filters;
 const current={...query,filters:governedFilters??effectiveAnalysisFilters(query,periods),compare:false};
 const selected=await queryColumnarSales(frame,identity,confirmation,current,keys,signal);
 const Decimal=Prisma.Decimal.clone({precision:40,rounding:Prisma.Decimal.ROUND_HALF_UP});
 function parity(key:string,result:{exact:string;value:number},target:number|null){
  if(target===null)throw Error('COLUMNAR_PARITY_FAILURE');
  const metric=reference.outcomes.find(m=>m.key===key)!;
  const expected=typeof metric.lineage.exactValue==='string'?metric.lineage.exactValue:String(target);
  const left=new Decimal(result.exact),right=new Decimal(expected);
  const currency=metric.definition.format==='CURRENCY'&&rules.currency?rules.currency:null;
  const minorDigits=currency?(new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2):2;
  const tolerance=metric.definition.format==='COUNT'?new Decimal(0):
   metric.definition.format==='PERCENT'?new Decimal('0.0000000001'):
   new Decimal(10).pow(-minorDigits).div(2);
  const error=left.minus(right).abs();
  if((tolerance.isZero()&&!error.isZero())||(!tolerance.isZero()&&error.gte(tolerance)))throw Error('COLUMNAR_PARITY_FAILURE:'+key);
 }
 for(const key of keys){
  const value=selected[key];if(!value)throw Error('COLUMNAR_MISSING_RESULT:'+key);
  parity(key,value,reference.outcomes.find(m=>m.key===key)!.value);
 }
 const outcomes=reference.outcomes.map(m=>{
  const result=selected[m.key];return m.status==='READY'&&result?{...m,value:result.value,
   lineage:{...m.lineage,exactValue:result.exact,aggregation:result.aggregation}}:m;
 });
 let comparison=reference.comparison;
 if(periods){
  const date=current.filters.find(f=>f.type==='DATE_RANGE')!;
  const priorFilters=current.filters.map(f=>f===date?{...f,value:periods.previous.start,end:periods.previous.end}:f);
  const prior=await queryColumnarSales(frame,identity,confirmation,{...current,filters:priorFilters},keys,signal);
  // Comparison values must respect the reference period too, not just the
  // primary period, before they can enter a saved dashboard or export.
  for(const [key,point] of Object.entries(reference.comparison??{})){
   const fromColumnar=prior[key];
   if(fromColumnar&&point.previous!==null&&Number.isFinite(point.previous)){
    const oldValue=new Decimal(String(point.previous));
    const newValue=new Decimal(fromColumnar.exact);
    const isRatio=plan.definitions[key]?.aggregation==='RATIO';
    const precision=isRatio?new Decimal('0.0000000001'):
     new Decimal(10).pow(-((rules.currency?new Intl.NumberFormat('en',{style:'currency',currency:rules.currency}).resolvedOptions().maximumFractionDigits:2)??2)).div(2);
    if(newValue.minus(oldValue).abs().gte(precision))throw Error('COLUMNAR_PARITY_FAILURE:PREVIOUS:'+key);
   }
  }
  comparison=Object.fromEntries(Object.entries(reference.comparison??{}).map(([key,point])=>{
   const currentResult=selected[key],previousResult=prior[key];
   if(!currentResult||!previousResult||point.current===null||point.previous===null)return [key,point];
   return [key,{current:currentResult.value,previous:previousResult.value,
    ...metricComparison(currentResult.value,previousResult.value)}];
  }));
 }
 return {...reference,outcomes,comparison};
}
