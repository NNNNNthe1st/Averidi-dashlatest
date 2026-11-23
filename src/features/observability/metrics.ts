import {dashboardDb as db} from '../../server/db';
import {safeObservationRoute,safeJobKind,observationOutcome,structuredDiagnostic} from './contracts';
type Sample={kind:'REQUEST'|'JOB';name:string;outcome:string;count:number;totalMs:number;maxMs:number;window:Date};
const pending=new Map<string,Sample>();let timer:ReturnType<typeof setTimeout>|undefined,flushing:Promise<void>|null=null;
const WINDOW=60000,MAX_PENDING=2048;
/** Aggregates only controlled route/job names and result classes. Nothing from URLs, headers, bodies or exceptions is retained. */
export function observeDuration(kind:Sample['kind'],name:string,outcome:string,durationMs:number,now=Date.now()){
 if(!Number.isFinite(durationMs)||durationMs<0||durationMs>86400000||!Number.isFinite(now))return;
 const safeName=kind==='REQUEST'?safeObservationRoute(name):safeJobKind(name),safeOutcome=/^(?:[1-5]xx|UNKNOWN|COMPLETED|FAILED|QUEUED|CANCELLED|BLOCKED)$/.test(outcome)?outcome:'UNKNOWN';
 const window=new Date(Math.floor(now/WINDOW)*WINDOW),key=JSON.stringify([window.toISOString(),kind,safeName,safeOutcome]);
 const item=pending.get(key);if(item){item.count++;item.totalMs+=durationMs;item.maxMs=Math.max(item.maxMs,durationMs);}else if(pending.size<MAX_PENDING)pending.set(key,{kind,name:safeName,outcome:safeOutcome,count:1,totalMs:durationMs,maxMs:durationMs,window});
 if(!timer){timer=setTimeout(()=>{timer=undefined;void flushObservations();},1000);timer.unref();}
}
export function flushObservations():Promise<void>{
 if(flushing)return flushing.then(()=>pending.size?flushObservations():undefined);
 const batch=[...pending.values()];pending.clear();
 flushing=(async()=>{for(const s of batch){try{
  await db.$executeRaw`INSERT INTO "DashboardObservationBucket" ("window","kind","name","outcome","count","totalMs","maxMs") VALUES (${s.window.toISOString()}::timestamp,${s.kind},${s.name},${s.outcome},${s.count},${s.totalMs},${s.maxMs}) ON CONFLICT ("window","kind","name","outcome") DO UPDATE SET "count"="DashboardObservationBucket"."count"+EXCLUDED."count","totalMs"="DashboardObservationBucket"."totalMs"+EXCLUDED."totalMs","maxMs"=GREATEST("DashboardObservationBucket"."maxMs",EXCLUDED."maxMs")`;
 }catch{console.error(structuredDiagnostic('instrumentation_failed'));}}})().finally(()=>{flushing=null;});return flushing;
}
export function requestSpanProcessor(){return {
 onStart(){},onEnd(span:{attributes:Record<string,unknown>;duration:[number,number];kind:number;spanContext?:()=>{traceId:string}}){
  if(span.kind!==1||span.attributes['next.span_type']!=='BaseServer.handleRequest')return;
  const route=safeObservationRoute(span.attributes['next.route']??span.attributes['http.route']),status=Number(span.attributes['http.status_code']??span.attributes['http.response.status_code']),duration=span.duration[0]*1000+span.duration[1]/1e6;
  observeDuration('REQUEST',route,observationOutcome(status),duration);
  if(status>=500)console.error(structuredDiagnostic('request_failed',{route,outcome:observationOutcome(status),durationMs:duration,correlationId:span.spanContext?.().traceId}));
 },forceFlush:flushObservations,shutdown:flushObservations,
};}
export async function operationalSnapshot(){
 const since=new Date(Date.now()-3600000);const buckets=await db.dashboardObservationBucket.findMany({where:{window:{gte:since}},orderBy:{window:'desc'},take:1000});
 return {windowMinutes:60,buckets:buckets.map(b=>({...b,meanMs:b.count?b.totalMs/b.count:0})),limited:buckets.length===1000};
}
