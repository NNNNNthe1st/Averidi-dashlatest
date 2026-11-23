import {randomUUID} from 'node:crypto';

/** @typedef {{id:string,createdAt:number,changes:Array<{signal:string,status:string}>}} MonitorEvent */
/** @typedef {{version:number,updatedAt:number,signals:Record<string,{active:boolean,failures:number,successes:number,lastSent:number}>,pending:MonitorEvent|null}} MonitorState */

export const signalNames=['application','storage','database','worker','failedJobs','queueDelay','expiredLeases','operationalErrors','refreshFailures','metricFailures','requestErrors','requestLatency','jobLatency','infrastructure'];
export function monitoringConfig(env){
 const integer=(key,fallback,min,max)=>{const raw=env[key]??String(fallback);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min||Number(raw)>max)throw Error('MONITOR_CONFIGURATION_INVALID');return Number(raw);};
 let url;try{url=new URL(env.DASHBOARD_MONITOR_READY_URL);}catch{throw Error('MONITOR_CONFIGURATION_INVALID');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/dashboard/app/api/health/ready')throw Error('MONITOR_CONFIGURATION_INVALID');
 let webhook=null;
 if(env.DASHBOARD_MONITOR_WEBHOOK_URL){try{webhook=new URL(env.DASHBOARD_MONITOR_WEBHOOK_URL);}catch{throw Error('MONITOR_CONFIGURATION_INVALID');}
  if(webhook.protocol!=='https:'||webhook.username||webhook.password||webhook.hash)throw Error('MONITOR_CONFIGURATION_INVALID');}
 const token=env.DASHBOARD_MONITOR_WEBHOOK_TOKEN;
 if(token&&(!webhook||token.length>4096||/[\r\n]/.test(token)))throw Error('MONITOR_CONFIGURATION_INVALID');
 return {readyUrl:url.href,webhookUrl:webhook?.href??null,webhookToken:token??null,
  failureSamples:integer('DASHBOARD_MONITOR_FAILURE_SAMPLES',2,1,20),recoverySamples:integer('DASHBOARD_MONITOR_RECOVERY_SAMPLES',2,1,20),
  reminderMs:integer('DASHBOARD_MONITOR_REMINDER_SECONDS',1800,60,86400)*1000,
  windowSeconds:integer('DASHBOARD_MONITOR_WINDOW_SECONDS',900,60,86400),queueSeconds:integer('DASHBOARD_MONITOR_QUEUE_SECONDS',300,30,86400),
  refreshFailures:integer('DASHBOARD_MONITOR_REFRESH_FAILURES',1,1,1000000),metricFailures:integer('DASHBOARD_MONITOR_METRIC_FAILURES',1,1,1000000),requestErrors:integer('DASHBOARD_MONITOR_REQUEST_ERRORS',1,1,1000000),requestMaxMs:integer('DASHBOARD_MONITOR_REQUEST_MAX_MS',15000,1,3600000),jobMaxMs:integer('DASHBOARD_MONITOR_JOB_MAX_MS',600000,1000,86400000),cpuLoadPerCore:integer('DASHBOARD_MONITOR_CPU_LOAD_PER_CORE',2,1,100),memoryPercent:integer('DASHBOARD_MONITOR_MEMORY_PERCENT',95,1,100),diskPercent:integer('DASHBOARD_MONITOR_DISK_PERCENT',90,1,100),
  failedJobs:integer('DASHBOARD_MONITOR_FAILED_JOBS',1,1,1000000),expiredLeases:integer('DASHBOARD_MONITOR_EXPIRED_LEASES',1,1,1000000),operationalErrors:integer('DASHBOARD_MONITOR_OPERATIONAL_ERRORS',1,1,1000000)};
}
/** @returns {MonitorState} */
export function initialState(){return {version:1,updatedAt:0,signals:{},pending:null};}
export function validateState(state){
 if(!state||state.version!==1||!Number.isSafeInteger(state.updatedAt)||state.updatedAt<0||!state.signals||typeof state.signals!=='object'||Array.isArray(state.signals)||Object.keys(state).some(k=>!['version','updatedAt','signals','pending'].includes(k)))throw Error('MONITOR_STATE_INVALID');
 for(const [name,v] of Object.entries(state.signals))if(!signalNames.includes(name)||!v||typeof v.active!=='boolean'||![v.failures,v.successes,v.lastSent].every(n=>Number.isSafeInteger(n)&&n>=0)||Object.keys(v).sort().join(',')!=='active,failures,lastSent,successes')throw Error('MONITOR_STATE_INVALID');
 if(state.pending){const p=state.pending;if(!/^[0-9a-f-]{36}$/.test(p.id)||!Number.isSafeInteger(p.createdAt)||p.createdAt<0||!Array.isArray(p.changes)||!p.changes.length||p.changes.length>signalNames.length||Object.keys(p).sort().join(',')!=='changes,createdAt,id'||new Set(p.changes.map(c=>c.signal)).size!==p.changes.length||p.changes.some(c=>!signalNames.includes(c.signal)||!['FIRING','RESOLVED'].includes(c.status)||Object.keys(c).sort().join(',')!=='signal,status'))throw Error('MONITOR_STATE_INVALID');}
 else if(state.pending!==null)throw Error('MONITOR_STATE_INVALID');
 return state;
}
/** Pending delivery is immutable until acknowledged. A restart retries the same ID. */
/** @returns {MonitorState} */
export function advanceState(input,signals,config,now=Date.now()){
 const state=structuredClone(validateState(input));
 if(!Number.isSafeInteger(now)||now<state.updatedAt||Object.keys(signals).sort().join(',')!==[...signalNames].sort().join(',')||Object.values(signals).some(v=>typeof v!=='boolean'))throw Error('MONITOR_SAMPLE_INVALID');
 if(state.pending)return state;
 const changes=[];
 for(const name of signalNames){const v=state.signals[name]??{active:false,failures:0,successes:0,lastSent:0};
  if(signals[name]){v.successes=Math.min(config.recoverySamples,v.successes+1);v.failures=0;if(v.active&&v.successes>=config.recoverySamples){v.active=false;changes.push({signal:name,status:'RESOLVED'});}}
  else{v.failures=Math.min(config.failureSamples,v.failures+1);v.successes=0;if(v.failures>=config.failureSamples&&(!v.active||now-v.lastSent>=config.reminderMs)){v.active=true;changes.push({signal:name,status:'FIRING'});}}
  state.signals[name]=v;
 }
 state.updatedAt=now;
 if(changes.length)state.pending={id:randomUUID(),createdAt:now,changes};
 return state;
}
/** @returns {MonitorState} */
export function acknowledgeState(input,now=Date.now()){
 const state=structuredClone(validateState(input));if(!state.pending||!Number.isSafeInteger(now)||now<state.pending.createdAt)throw Error('MONITOR_ACK_INVALID');
 for(const change of state.pending.changes)state.signals[change.signal].lastSent=now;
 state.pending=null;return state;
}
export async function deliverAlert(event,config,fetcher=fetch){
 if(!config.webhookUrl)throw Error('MONITOR_DELIVERY_UNCONFIGURED');
 const response=await fetcher(config.webhookUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','Idempotency-Key':event.id,...(config.webhookToken?{Authorization:'Bearer '+config.webhookToken}:{})},body:JSON.stringify({version:1,product:'averidi-dashboard',eventId:event.id,occurredAt:new Date(event.createdAt).toISOString(),changes:event.changes})});
 await response.body?.cancel();if(!response.ok)throw Error('MONITOR_DELIVERY_FAILED');
}
