import {createServer} from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stateDirectory,acquireMonitorLock} from './state.mjs';
import {monitoringConfig,deliverAlert} from './policy.mjs';
export function newWatchdogState(now=Date.now()){return {version:1,lastHeartbeat:now,lastSentAt:0,active:false,lastAlert:0,pending:null};}
export function acceptHeartbeat(state,input,now=Date.now()){
 if(!input||Object.keys(input).sort().join(',')!=='id,product,sentAt,version'||input.version!==1||input.product!=='averidi-dashboard'||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||!Number.isSafeInteger(input.sentAt)||Math.abs(now-input.sentAt)>30000||input.sentAt<=state.lastSentAt)throw Error('HEARTBEAT_REJECTED');
 return {...state,lastHeartbeat:now,lastSentAt:input.sentAt};
}
export function advanceWatchdog(state,timeoutMs,reminderMs,now=Date.now()){
 const next=structuredClone(state);if(next.pending)return next;const expired=now-next.lastHeartbeat>=timeoutMs;
 if(expired&&(!next.active||now-next.lastAlert>=reminderMs)||!expired&&next.active){next.active=expired;next.pending={id:randomUUID(),createdAt:now,changes:[{signal:'monitorHeartbeat',status:expired?'FIRING':'RESOLVED'}]};}
 return next;
}
/** @param {Record<string,string|undefined>} env */
export async function startWatchdog(env=process.env,fetcher=fetch){
 const timeout=Number(env.DASHBOARD_WATCHDOG_TIMEOUT_SECONDS??120),port=Number(env.DASHBOARD_WATCHDOG_PORT??9468),token=env.DASHBOARD_MONITOR_HEARTBEAT_TOKEN;
 if(!Number.isInteger(timeout)||timeout<15||timeout>86400||!Number.isInteger(port)||port<0||port>65535||typeof token!=='string'||token.length<32||token.length>512||/[\r\n]/.test(token))throw Error('WATCHDOG_CONFIGURATION_INVALID');
 const config=monitoringConfig(env);if(!config.webhookUrl)throw Error('WATCHDOG_ALERT_DESTINATION_REQUIRED');
 const dir=await stateDirectory(env.DASHBOARD_WATCHDOG_STATE_DIRECTORY),unlock=await acquireMonitorLock(dir),file=path.join(dir,'watchdog.json');
 let state=newWatchdogState(),queue=Promise.resolve(),timer,checking=false;
 const save=async()=>{const tmp=path.join(dir,'watchdog-'+randomUUID()+'.tmp');await writeFile(tmp,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);};
 const serial=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
 try{
  try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size>8192)throw Error('WATCHDOG_STATE_INVALID');state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||Object.keys(state).sort().join(',')!=='active,lastAlert,lastHeartbeat,lastSentAt,pending,version'||![state.lastAlert,state.lastHeartbeat,state.lastSentAt].every(v=>Number.isSafeInteger(v)&&v>=0)||typeof state.active!=='boolean'||state.lastHeartbeat>Date.now()+30000||state.pending&&(!/^[a-f0-9-]{36}$/.test(state.pending.id)||!Number.isSafeInteger(state.pending.createdAt)||!Array.isArray(state.pending.changes)||state.pending.changes.length!==1||state.pending.changes[0].signal!=='monitorHeartbeat'||!['FIRING','RESOLVED'].includes(state.pending.changes[0].status)))throw Error('WATCHDOG_STATE_INVALID');}catch(e){if(e.code!=='ENOENT')throw e;await save();}
  const tick=()=>{if(checking)return queue;checking=true;return serial(async()=>{state=advanceWatchdog(state,timeout*1000,config.reminderMs);await save();if(state.pending){try{await deliverAlert(state.pending,config,fetcher);state={...state,pending:null,lastAlert:Date.now()};await save();}catch{/* Durable retry with the same event ID. */}}}).finally(()=>{checking=false;});};
  const server=createServer((req,res)=>{void (async()=>{
   const auth=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);
   if(auth.length!==expected.length||!timingSafeEqual(auth,expected)){res.writeHead(401,{'Cache-Control':'no-store'}).end();return;}
   if(req.url==='/health'&&req.method==='GET'){res.writeHead(Date.now()-state.lastHeartbeat<timeout*1000&&!state.pending?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({product:'averidi-dashboard-watchdog',healthy:Date.now()-state.lastHeartbeat<timeout*1000&&!state.pending}));return;}
   if(req.url!=='/heartbeat'||req.method!=='POST'){res.writeHead(404).end();return;}
   let bytes=0,parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>1024){res.writeHead(413).end();req.destroy();return;}parts.push(chunk);}
   const input=JSON.parse(Buffer.concat(parts).toString('utf8'));await serial(async()=>{state=acceptHeartbeat(state,input);await save();});res.writeHead(204,{'Cache-Control':'no-store'}).end();
  })().catch(()=>{if(!res.headersSent)res.writeHead(400,{'Cache-Control':'no-store'});res.end();});});
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  timer=setInterval(()=>void tick().catch(()=>console.error(JSON.stringify({product:'averidi-dashboard-watchdog',error:'WATCHDOG_CHECK_FAILED'}))),5000);timer.unref();await tick();
  return {server,check:tick,close:async()=>{clearInterval(timer);await new Promise(resolve=>server.close(resolve));await queue;await unlock();}};
 }catch(e){if(timer)clearInterval(timer);await unlock();throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 void startWatchdog().then(watchdog=>{const stop=()=>void watchdog.close().then(()=>process.exit());process.once('SIGTERM',stop);process.once('SIGINT',stop);}).catch(()=>{console.error(JSON.stringify({product:'averidi-dashboard-watchdog',error:'WATCHDOG_START_FAILED'}));process.exitCode=1;});
}
