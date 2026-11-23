import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

export const BENCHMARK_SIZES=Object.freeze([100_000,1_000_000,10_000_000]);
const DEFAULT_SEED=0x5eed1234;
export function validateRows(rows){
 if(!Number.isSafeInteger(rows)||rows<1||rows>10_000_000)throw Error('PERFORMANCE_ROWS_OUT_OF_RANGE');
 return rows;
}
export function seededCsvRow(index,seed=DEFAULT_SEED){
 if(!Number.isSafeInteger(index)||index<0||index>=10_000_000)throw Error('PERFORMANCE_INDEX_OUT_OF_RANGE');
 let value=(index^seed)>>>0;
 value^=value<<13;value^=value>>>17;value^=value<<5;
 const amount=100+(value%1000)/100;
 const cost=40+(value%200)/100;
 const day=String(1+(index%28)).padStart(2,'0');
 const month=String(1+(Math.floor(index/28)%12)).padStart(2,'0');
 return `${String(index).padStart(10,'0')},${amount.toFixed(2)},${cost.toFixed(2)},2025-${month}-${day},C${index%20},P${index%200}\n`;
}
export async function generateBenchmarkCsv(file,rows,{seed=DEFAULT_SEED}={}){
 validateRows(rows);
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('PERFORMANCE_INVALID_SEED');
 const start=performance.now();
 const stream=createWriteStream(file,{flags:'wx',mode:0o600,highWaterMark:1024*1024});
 const digest=createHash('sha256');
 let bytes=0,records=0;
 const append=async chunk=>{
  const buffer=Buffer.from(chunk,'utf8');digest.update(buffer);bytes+=buffer.byteLength;
  if(!stream.write(buffer))await once(stream,'drain');
 };
 try{
  await append('id,amount,cost,day,channel,product\n');
  for(let i=0;i<rows;i+=1000){
   const end=Math.min(i+1000,rows);
   let chunk='';for(let n=i;n<end;n++)chunk+=seededCsvRow(n,seed);
   await append(chunk);records=end;
  }
  stream.end();await once(stream,'finish');
 }catch(e){stream.destroy();throw e;}
 return {rows:records,seed,bytes,sha256:digest.digest('hex'),elapsedMs:Math.round(performance.now()-start)};
}
