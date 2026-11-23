import {flushObservations} from '../features/observability/metrics';
import {sweepSourceMonitoring,monitoringFailure} from '../features/monitoring/sources';
import {erasureSettings} from '../features/account-erasure/contracts';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {dashboardDb} from '../server/db';
import {cleanupDashboardAuthentication} from '../server/browser-session';
import {runDashboardWorkerOnce} from './run-once';
import {requiredWorkerCapabilities} from './contracts';
import {queryCacheSettings} from '../features/analysis/cache-contracts';
import {dashboardWorkerSettings} from './settings';
export {dashboardWorkerSettings} from './settings';
import {dispatchDueReportSchedules,dispatchDueDashboardSchedules} from './queue';

function imported<T>(value:T):T{return (value as T&{default?:T}).default??value;}

/** One active job per process; scale through independently leased worker processes. */
export async function serveDashboardWorker(signal:AbortSignal,onReady?:()=>void){
 const {poll}=dashboardWorkerSettings();
 const erasure=erasureSettings(),erasureWorker=erasure?imported(await import('../features/account-erasure/worker')):null;
 if(erasure)await imported(await import('../features/account-erasure/reconcile')).assertErasureRecoveryState();
 const cache=queryCacheSettings(),cacheWorker=cache?imported(await import('../features/analysis/query-cache')):null;
 if(cacheWorker&&cache)await cacheWorker.pruneExpiredQueryCache(cache);
 let cacheHealthy=true,lastCacheCleanup=Date.now();
 const capabilities=requiredWorkerCapabilities().filter(cap=>cap!=='QUERY_CACHE'&&cap!=='SOURCE_MONITORING');
 const id=randomUUID();
 let activeJobId:string|null=null,lastCleanup=0,lastSourceSweep=0,sourceCursor:string|undefined,sourceHealthy=false,pendingSourceSweep:Promise<void>|null=null;
 const sweep=()=>{if(pendingSourceSweep)return pendingSourceSweep;pendingSourceSweep=(async()=>{try{sourceCursor=await sweepSourceMonitoring(sourceCursor);sourceHealthy=true;lastSourceSweep=Date.now();}catch{sourceHealthy=false;monitoringFailure();}})().finally(()=>{pendingSourceSweep=null;});return pendingSourceSweep;};
 const sourceTimer=setInterval(()=>void sweep(),30000);sourceTimer.unref();
 let pendingBeat:Promise<unknown>|null=null;
 const heartbeat=async(stopping=false)=>{const current=[...capabilities,...(cacheWorker&&cacheHealthy?['QUERY_CACHE']:[]),...(sourceHealthy&&Date.now()-lastSourceSweep<90000?['SOURCE_MONITORING']:[])];return dashboardDb.dashboardWorkerHeartbeat.upsert({where:{id},create:{id,activeJobId,stopping,capabilities:current,version:2},update:{seenAt:new Date(),activeJobId,stopping,capabilities:current,version:2}});};
 const beat=setInterval(()=>{
  if(!pendingBeat)pendingBeat=heartbeat().catch(()=>console.error(JSON.stringify({event:'dashboard_worker_heartbeat_failed',workerId:id}))).finally(()=>{pendingBeat=null;});
 },10_000);
 try{
  await sweep();await heartbeat();onReady?.();
  while(!signal.aborted){
   try{
    if(cacheWorker&&cache&&Date.now()-lastCacheCleanup>=30_000){try{await cacheWorker.pruneExpiredQueryCache(cache);cacheHealthy=true;}catch{cacheHealthy=false;console.error(JSON.stringify({event:'dashboard_query_cache_cleanup_failed',workerId:id}));}lastCacheCleanup=Date.now();}
    if(erasureWorker){const result=await erasureWorker.processAccountErasureOnce(signal,async requestId=>{activeJobId='erasure_'+requestId;await heartbeat();});
     if(result.claimed){activeJobId=null;await heartbeat();continue;}
    }
    await dispatchDueDashboardSchedules();
    await dispatchDueReportSchedules();
    if(Date.now()-lastCleanup>3600_000){await cleanupDashboardAuthentication();await dashboardDb.dashboardObservationBucket.deleteMany({where:{window:{lt:new Date(Date.now()-86400000)}}});lastCleanup=Date.now();}
    const result=await runDashboardWorkerOnce(signal,async jobId=>{activeJobId=jobId;await heartbeat();});
    activeJobId=null;await heartbeat();
    if(result.claimed)console.log(JSON.stringify({event:'dashboard_job_finished',workerId:id,jobId:result.jobId,status:result.status}));
    else await delay(poll,undefined,{signal});
   }catch{
    activeJobId=null;
    if(signal.aborted)break;
    // Job diagnostics are stored on the tenant-owned job; logs never include payloads or credentials.
    console.error(JSON.stringify({event:'dashboard_worker_iteration_failed',workerId:id}));
    await delay(poll,undefined,{signal}).catch(()=>{});
   }
  }
 }finally{
  clearInterval(beat);clearInterval(sourceTimer);if(pendingSourceSweep)await pendingSourceSweep;
  if(pendingBeat)await pendingBeat;
  await flushObservations();await heartbeat(true);
 }
}
if(process.argv[1]?.endsWith('service.ts')){
 const controller=new AbortController();
 process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
 serveDashboardWorker(controller.signal).catch(()=>{console.error('Dashboard worker stopped after an infrastructure failure.');process.exitCode=1;}).finally(()=>dashboardDb.$disconnect());
}
