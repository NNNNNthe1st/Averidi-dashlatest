import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {BENCHMARK_SIZES,seededCsvRow,generateBenchmarkCsv,validateRows} from './generate.mjs';
test('specified benchmark sizes and capped rows',()=>{
 assert.deepEqual(BENCHMARK_SIZES,[100_000,1_000_000,10_000_000]);
 for(const invalid of [0,-1,1.5,NaN,10_000_001])assert.throws(()=>validateRows(invalid),/PERFORMANCE_ROWS_OUT_OF_RANGE/);
});
test('synthetic data is deterministic and preserves zero-padded identifiers',()=>{
 assert.equal(seededCsvRow(0),seededCsvRow(0));
 assert.match(seededCsvRow(0),/^0000000000,/);
 assert.notEqual(seededCsvRow(1),seededCsvRow(2));
});
test('two independently generated files have identical sha and content',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'averidi-benchmark-'));
 try{
  const a=await generateBenchmarkCsv(path.join(folder,'a.csv'),1234);
  const b=await generateBenchmarkCsv(path.join(folder,'b.csv'),1234);
  assert.equal(a.sha256,b.sha256);assert.equal(a.rows,1234);
  assert.equal((await readFile(path.join(folder,'a.csv'),'utf8')).split('\n').length,1236);
 }finally{await rm(folder,{recursive:true,force:true});}
});
