import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {ConnectorError} from './contracts';
export type ConnectorRequest={url:string;method?:'GET'|'POST'|'DELETE';headers?:Record<string,string>;body?:string;signal?:AbortSignal;approvedCustomOrigin?:string};
export type ConnectorResponse={status:number;headers:Record<string,string>;body:unknown};
export type ConnectorTransport=(request:ConnectorRequest)=>Promise<ConnectorResponse>;
const hosts=new Set(['analyticsdata.googleapis.com','googleads.googleapis.com','accounts.google.com','oauth2.googleapis.com','sheets.googleapis.com','connect.stripe.com','api.stripe.com','appcenter.intuit.com','oauth.platform.intuit.com','developer.api.intuit.com','quickbooks.api.intuit.com','app.hubspot.com','api.hubapi.com','connect.squareup.com','login.xero.com','identity.xero.com','api.xero.com']);
export function publicAddress(address:string){
 // Pin only globally routable IPv4 addresses. IPv6-only custom stores fail closed.
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function assertConnectorURL(value:string,approvedCustomOrigin?:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port)throw Error('CONNECTOR_ENDPOINT_FORBIDDEN');
 const custom=(process.env.DASHBOARD_CUSTOM_API_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean).filter(s=>{try{const value=new URL(s);return value.protocol==='https:'&&value.origin===s;}catch{return false;}});
 const woo=(process.env.DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!hosts.has(url.hostname)&&!(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(url.hostname))&&!woo.includes(url.origin)&&!(approvedCustomOrigin===url.origin&&custom.includes(url.origin)))throw Error('CONNECTOR_ENDPOINT_FORBIDDEN');
 return url;
}
/** No redirects; bounded bodies, verified TLS and a public DNS address pinned for each request. */
export const connectorTransport:ConnectorTransport=async input=>{
 const url=assertConnectorURL(input.url,input.approvedCustomOrigin);input.signal?.throwIfAborted();
 const addresses=await lookup(url.hostname,{all:true,family:4});
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('CONNECTOR_ENDPOINT_FORBIDDEN');
 return new Promise((resolve,reject)=>{
  const timeout=AbortSignal.timeout(15000),signal=input.signal?AbortSignal.any([input.signal,timeout]):timeout;
  const req=https.request(url,{method:input.method??'GET',headers:{Accept:'application/json',...input.headers},signal,agent:false,family:4,lookup:(_host,_options,callback)=>callback(null,addresses[0].address,4)},res=>{
   let size=0;const chunks:Buffer[]=[];
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8*1024*1024)req.destroy(new ConnectorError('CONNECTOR_RESPONSE_TOO_LARGE'));else chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>{
    const headers:Record<string,string>={};for(const [key,value] of Object.entries(res.headers))if(value!==undefined)headers[key]=Array.isArray(value)?value.join(','):value;
    let body:unknown=null;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{if(size)body=null;}
    resolve({status:res.statusCode??502,headers,body});
   });
  });req.on('error',error=>reject(input.signal?.aborted?input.signal.reason:error instanceof ConnectorError?error:new ConnectorError('CONNECTOR_NETWORK_ERROR')));if(input.body)req.write(input.body);req.end();
 });
};
export async function connectorRequest(input:ConnectorRequest,transport:ConnectorTransport=connectorTransport){
 assertConnectorURL(input.url,input.approvedCustomOrigin);input.signal?.throwIfAborted();const response=await transport(input);
 if(response.status===429){const raw=response.headers['retry-after'];const seconds=/^\d+$/.test(raw??'')?Number(raw):Math.ceil((Date.parse(raw??'')-Date.now())/1000);throw new ConnectorError('CONNECTOR_RATE_LIMITED',Math.min(3600,Math.max(1,Number.isFinite(seconds)?seconds:60)));}
 if(response.status===401||response.status===403)throw new ConnectorError('CONNECTOR_AUTH_REQUIRED');
 if(response.status>=500)throw new ConnectorError('CONNECTOR_PROVIDER_UNAVAILABLE');
 if(response.status<200||response.status>=300)throw new ConnectorError('CONNECTOR_REQUEST_REJECTED');
 return response;
}
export function object(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');return value as Record<string,any>;}
export function records(value:unknown):Record<string,any>[]{if(!Array.isArray(value)||value.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw new ConnectorError('CONNECTOR_INVALID_RESPONSE');return value;}
