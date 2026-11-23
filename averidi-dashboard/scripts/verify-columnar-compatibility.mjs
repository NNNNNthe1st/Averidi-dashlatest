import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DuckDBInstance} from '@duckdb/node-api';

if(Number(process.versions.node.split('.')[0])!==22)throw Error('COLUMNAR_REQUIRES_NODE22');
const folder=await mkdtemp(path.join(tmpdir(),'dashboard-columnar-native-'));
try{
 const parquet=path.join(folder,'compatibility.parquet').replaceAll("'","''");
 const db=await DuckDBInstance.create(':memory:',{threads:'2',memory_limit:'512MB'});
 const connection=await db.connect();
 try{
  await connection.run(`COPY (SELECT '00000001'::VARCHAR AS id,CAST('100.25' AS DECIMAL(38,12)) AS amount,DATE '2026-01-01' AS business_day) TO '${parquet}' (FORMAT PARQUET,COMPRESSION ZSTD)`);
  const data=(await connection.runAndReadAll(`SELECT id,CAST(amount AS VARCHAR) AS amount,CAST(business_day AS VARCHAR) AS day FROM read_parquet('${parquet}')`)).getRowObjectsJson();
  assert.equal(data.length,1);
  assert.equal(data[0].id,'00000001');
  assert.equal(Number(data[0].amount),100.25);
  assert.equal(data[0].day,'2026-01-01');
 }finally{connection.closeSync();}
 const raw=await readFile(path.join(folder,'compatibility.parquet'));
 assert.equal(raw.subarray(0,4).toString(),'PAR1');
 assert.equal(raw.subarray(-4).toString(),'PAR1');
 console.log(JSON.stringify({status:'PASSED',runtime:process.version,parquetBytes:raw.length,format:'Parquet',native:'DuckDB Node API',scope:'native packaging, Parquet and decimal smoke compatibility'}));
}finally{await rm(folder,{recursive:true,force:true});}
