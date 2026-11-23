import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {BENCHMARK_SIZES,generateBenchmarkCsv,validateRows} from './performance/generate.mjs';
const output=process.env.DASHBOARD_PERFORMANCE_REPORT_DIR || path.join(process.cwd(),'.local','performance',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
const keep=process.env.DASHBOARD_PERFORMANCE_KEEP_FILES==='true';
const rows=process.env.DASHBOARD_PERFORMANCE_ROWS?process.env.DASHBOARD_PERFORMANCE_ROWS.split(',').map(x=>validateRows(Number(x))):BENCHMARK_SIZES;
if(rows.length===0||new Set(rows).size!==rows.length)throw Error('PERFORMANCE_INVALID_ROW_SIZES');
const budgetFile=process.env.DASHBOARD_PERFORMANCE_BUDGETS;
if(budgetFile&&!path.isAbsolute(budgetFile))throw Error('PERFORMANCE_BUDGETS_MUST_BE_ABSOLUTE');
const budgets=budgetFile?JSON.parse(await readFile(budgetFile,'utf8')):null;
if(budgets&&(!budgets.rows||typeof budgets.rows!=='object'))throw Error('PERFORMANCE_INVALID_BUDGETS');
await mkdir(output,{recursive:true,mode:0o700});
const summary={version:1,status:'RUNNING',seed:0x5eed1234,node:process.version,startedAt:new Date().toISOString(),budgets:budgetFile?'configured':'UNSET_BASELINE_REQUIRED',cases:[]};
const record=()=>writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
await record();
try{
 for(const count of rows){
  const file=path.join(output,`seeded-${count}.csv`);
  const generated=await generateBenchmarkCsv(file,count);
  const begin=performance.now();let actual=0,header=null,first=null,last=null;
  for await(const line of createInterface({input:createReadStream(file,{highWaterMark:1024*1024}),crlfDelay:Infinity})){
   if(!header){header=line;if(header!=='id,amount,cost,day,channel,product')throw Error('PERFORMANCE_HEADER_MISMATCH');continue;}
   if(!line)throw Error('PERFORMANCE_BLANK_RECORD');
   if(!first)first=line;last=line;actual++;
  }
  if(actual!==count)throw Error('PERFORMANCE_ROW_MISMATCH');
  const elapsedMs=Math.round(performance.now()-begin);
  const limits=budgets?.rows?.[String(count)];
  const checked=limits?['generateMs','readMs','maxRssBytes'].every(k=>Number.isFinite(limits[k])&&limits[k]>0):false;
  if(limits&&!checked)throw Error('PERFORMANCE_INVALID_ROW_BUDGET');
  const rssBytes=process.memoryUsage().rss;
  const passed=checked?(generated.elapsedMs<=limits.generateMs&&elapsedMs<=limits.readMs&&rssBytes<=limits.maxRssBytes):null;
  const result={rows:count,seed:generated.seed,bytes:generated.bytes,sha256:generated.sha256,generateMs:generated.elapsedMs,readMs:elapsedMs,rssBytes,first,last,budget:checked?'EVALUATED':'UNSET',budgetPassed:passed,engineExecution:'NOT_BENCHMARKED_EXISTING_50000_ROW_CAP'};
  summary.cases.push(result);await record();console.log(JSON.stringify(result));
  if(!keep)await rm(file,{force:true});
  if(checked&&!passed)throw Error('PERFORMANCE_BUDGET_EXCEEDED:'+count);
 }
 summary.status='PASSED_GENERATOR_AND_STREAM_READ';summary.finishedAt=new Date().toISOString();await record();
 console.log('Seeded generator and stream-read checks passed; engine performance is NOT verified. Baseline evidence: '+path.join(output,'summary.json'));
}catch(error){summary.status='FAILED';summary.error=error instanceof Error?error.message:String(error);summary.finishedAt=new Date().toISOString();await record();console.error(summary.error);process.exitCode=1;}
