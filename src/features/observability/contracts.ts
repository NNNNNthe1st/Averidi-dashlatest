import routes from './routes.json';
const allowedRoutes=new Set(routes.map(r=>r.replace(/\/(?:page|route)$/,'')));
export function safeObservationRoute(value:unknown){
 if(typeof value!=='string')return 'OTHER';
 const route=value.replace(/^\/dashboard\/app(?=\/|$)/,'').replace(/\/(?:page|route)$/,'')||'/';
 return allowedRoutes.has(route)?route:'OTHER';
}
export function observationOutcome(status:number){return status>=100&&status<600?Math.floor(status/100)+'xx':'UNKNOWN';}
export function safeJobKind(value:string){return /^[A-Z_]{1,48}$/.test(value)?value:'UNKNOWN';}
export function structuredDiagnostic(event:'request_failed'|'job_finished'|'instrumentation_failed'|'monitoring_failed',values:{kind?:string;outcome?:string;durationMs?:number;route?:string;correlationId?:string;code?:string}={}){
 const correlation=values.correlationId&&/^[a-f0-9]{32}$/.test(values.correlationId)?values.correlationId:undefined;
 const entry={...(correlation?{correlationId:correlation}:{}),...(values.code&&/^[A-Z_]{1,64}$/.test(values.code)?{code:values.code}:{}),product:'averidi-dashboard',event,at:new Date().toISOString(),...(values.kind?{kind:safeJobKind(values.kind)}:{}),...(values.outcome&&/^(?:[1-5]xx|COMPLETED|FAILED|QUEUED|CANCELLED|BLOCKED|UNKNOWN)$/.test(values.outcome)?{outcome:values.outcome}:{}),...(values.durationMs!==undefined&&Number.isFinite(values.durationMs)?{durationMs:Math.min(86400000,Math.max(0,Math.round(values.durationMs)))}:{}),...(values.route?{route:safeObservationRoute(values.route)}:{})};
 return JSON.stringify(entry);
}
