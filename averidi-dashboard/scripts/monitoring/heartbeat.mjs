import {randomUUID} from 'node:crypto';
/** @param {Record<string,string|undefined>} env */
export function heartbeatSettings(env=process.env){
 const endpoint=env.DASHBOARD_MONITOR_HEARTBEAT_URL,token=env.DASHBOARD_MONITOR_HEARTBEAT_TOKEN;
 if(!endpoint&&!token)return null;
 let url;try{url=new URL(endpoint);}catch{throw Error('MONITOR_HEARTBEAT_CONFIGURATION_INVALID');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/heartbeat'||typeof token!=='string'||token.length<32||token.length>512||/[\r\n]/.test(token))throw Error('MONITOR_HEARTBEAT_CONFIGURATION_INVALID');
 return {url:url.href,token};
}
export async function sendHeartbeat(settings,fetcher=fetch){if(!settings)return;const r=await fetcher(settings.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+settings.token,'Content-Type':'application/json'},body:JSON.stringify({version:1,product:'averidi-dashboard',id:randomUUID(),sentAt:Date.now()})});await r.body?.cancel();if(!r.ok)throw Error('MONITOR_HEARTBEAT_DELIVERY_FAILED');}
