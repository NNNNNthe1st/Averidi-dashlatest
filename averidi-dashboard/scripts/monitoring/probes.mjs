import os from 'node:os';
import {statfs,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function probeApplication(url,fetcher=fetch){
 try{const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(!r.ok){await r.body?.cancel();return false;}
  if(!r.body)return false;const reader=r.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>32768){await reader.cancel();return false;}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  const v=JSON.parse(text);return v.product==='averidi-dashboard'&&v.ready===true&&['database','storage','worker','billing'].every(k=>v.checks?.[k]===true);
 }catch{return false;}
}
/** Fresh child isolates ORM/native stalls, with an OS process deadline. No child errors/credentials escape. */
export function probeChild(args,env=process.env,timeout=20000){return new Promise(resolve=>{
 const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','ignore','ignore'],detached:process.platform!=='win32'});
 let settled=false;const finish=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};
 const timer=setTimeout(()=>{try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}finish(false);},timeout);
 child.once('error',()=>finish(false));child.once('close',code=>finish(code===0));
});}
export async function collectSamples(config,env=process.env){
 const pairs=await Promise.all([
  probeApplication(config.readyUrl).then(v=>['application',v]),
  probeChild(['--import','tsx','scripts/check-storage.mjs'],{...env,DASHBOARD_STORAGE_WRITE_CHECK:'true'}).then(v=>['storage',v]),
  probeChild(['--import','tsx','scripts/check-database.mjs'],env).then(v=>['database',v]),
  probeChild(['--import','tsx','scripts/check-worker.mjs'],env).then(v=>['worker',v]),
  collectInfrastructureMetrics(env).then(value=>['infrastructure',infrastructureHealthy(value,config)]).catch(()=>['infrastructure',false]),
  ...['failedJobs','queueDelay','expiredLeases','operationalErrors','refreshFailures','metricFailures','requestErrors','requestLatency','jobLatency'].map(signal=>probeChild(['--import','tsx','scripts/monitoring/database.mjs',signal],env).then(v=>[signal,v])),
 ]);return Object.fromEntries(pairs);
}

export async function collectInfrastructureMetrics(env=process.env){
 let total=os.totalmem(),used=total-os.freemem();
 try{const [limit,current]=await Promise.all([readFile('/sys/fs/cgroup/memory.max','utf8'),readFile('/sys/fs/cgroup/memory.current','utf8')]);const cap=Number(limit.trim()),actual=Number(current.trim());if(Number.isFinite(cap)&&cap>0&&cap<total&&Number.isFinite(actual)){total=cap;used=actual;}}catch{}
 const disk=await statfs(env.DASHBOARD_STORAGE_ROOT||process.cwd());
 return {loadPerCore:os.loadavg()[0]/Math.max(1,os.availableParallelism()),usedMemoryPercent:used/total*100,usedDiskPercent:disk.blocks?(disk.blocks-disk.bavail)/disk.blocks*100:NaN};
}
export function infrastructureHealthy(value,config){return [value.loadPerCore,value.usedMemoryPercent,value.usedDiskPercent].every(Number.isFinite)&&value.loadPerCore<=config.cpuLoadPerCore&&value.usedMemoryPercent<=config.memoryPercent&&value.usedDiskPercent<=config.diskPercent;}
