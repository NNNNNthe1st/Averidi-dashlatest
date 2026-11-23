import {ConnectorError,type ConnectorCredential} from '../connectors/contracts';
import {connectorRequest,connectorTransport,type ConnectorTransport} from '../connectors/http';
import {DASHBOARD_MAX_ROWS,DASHBOARD_MAX_COLUMNS,type DashboardRow,type DashboardCell} from '../../engines/ingestion/ingest';
import {customApiUrl,type ApiConfig,type WebhookConfig} from './contracts';
function at(value:unknown,path:string){if(!path)return value;let node:unknown=value;for(const key of path.split('.')){if(!node||typeof node!=='object'||Array.isArray(node)||!Object.hasOwn(node,key))throw Error('CONNECTOR_INVALID_RESPONSE');node=(node as Record<string,unknown>)[key];}return node;}
export function sourceRows(value:unknown,config:Pick<WebhookConfig,'identityField'|'fieldMapping'>){
 if(!Array.isArray(value)||!value.length)throw Error('CONNECTOR_EMPTY_SNAPSHOT');if(value.length>DASHBOARD_MAX_ROWS)throw Error('CONNECTOR_LIMIT_EXCEEDED');
 const seen=new Set<string>(),fields=new Set<string>();
 const rows=value.map((item):DashboardRow=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('CONNECTOR_INVALID_RESPONSE');const raw=item as Record<string,unknown>,identity=raw[config.identityField];
  if(!(typeof identity==='string'&&identity.trim()&&identity.length<=512||typeof identity==='number'&&Number.isSafeInteger(identity)))throw Error('CONNECTOR_INVALID_RESPONSE');const key=JSON.stringify([typeof identity,identity]);if(seen.has(key))throw Error('CONNECTOR_UNSTABLE_SNAPSHOT');seen.add(key);
  const entries=Object.entries(raw);for(const [name,value] of entries){if(!name.trim()||name!==name.trim()||name.length>120||['__proto__','prototype','constructor'].includes(name))throw Error('CONNECTOR_INVALID_HEADERS');fields.add(name);if(fields.size>DASHBOARD_MAX_COLUMNS)throw Error('CONNECTOR_LIMIT_EXCEEDED');if(value!==null&&!(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)))throw Error('CONNECTOR_INVALID_RESPONSE');}
  return Object.fromEntries(entries) as DashboardRow;
 });
 if(config.fieldMapping?.length){if(config.fieldMapping.some(m=>!fields.has(m.from)))throw Error('CONNECTOR_INVALID_MAPPING');return rows.map(row=>Object.fromEntries(config.fieldMapping!.map(m=>[m.to,row[m.from]??null])) as DashboardRow);}return rows;
}
export async function readCustomApiSnapshot(config:ApiConfig,credential:ConnectorCredential,transport:ConnectorTransport=connectorTransport,signal?:AbortSignal){
 const base=customApiUrl(config.endpoint);const headers:Record<string,string>={};if(config.auth==='BEARER')headers.Authorization='Bearer '+credential.accessToken;else if(config.auth==='API_KEY')headers[config.apiKeyHeader]=credential.accessToken;
 const all:unknown[]=[],cursors=new Set<string>();let cursor='',snapshot:string|undefined,total:number|undefined,bytes=0;
 for(let page=0;;page++){
  signal?.throwIfAborted();if(page>=500)throw Error('CONNECTOR_LIMIT_EXCEEDED');const url=new URL(base);for(const [k,v] of Object.entries(config.parameters))url.searchParams.set(k,v);if(cursor)url.searchParams.set(config.cursorParameter,cursor);
  const response=await connectorRequest({url:url.toString(),headers,signal,approvedCustomOrigin:base.origin},transport);bytes+=Buffer.byteLength(JSON.stringify(response.body));if(bytes>50*1024*1024)throw Error('CONNECTOR_LIMIT_EXCEEDED');const records=at(response.body,config.itemsPath);if(!Array.isArray(records))throw Error('CONNECTOR_INVALID_RESPONSE');if(all.length+records.length>DASHBOARD_MAX_ROWS)throw Error('CONNECTOR_LIMIT_EXCEEDED');all.push(...records);
  if(config.pagination==='SINGLE')break;
  const token=at(response.body,config.snapshotPath),count=at(response.body,config.totalPath),next=at(response.body,config.nextCursorPath);
  if(typeof token!=='string'||!token||token.length>200||!Number.isSafeInteger(count)||Number(count)<1||Number(count)>DASHBOARD_MAX_ROWS||next!==null&&!(typeof next==='string'&&next.length>0&&next.length<=4096))throw Error('CONNECTOR_INVALID_RESPONSE');
  if(snapshot!==undefined&&(snapshot!==token||total!==count))throw Error('CONNECTOR_UNSTABLE_SNAPSHOT');snapshot=token;total=Number(count);
  if(next===null){if(all.length!==total)throw Error('CONNECTOR_UNSTABLE_SNAPSHOT');break;}
  if(!records.length||all.length>=total||cursors.has(next as string))throw Error('CONNECTOR_UNSTABLE_SNAPSHOT');cursor=next as string;cursors.add(cursor);
 }
 try{return sourceRows(all,config);}catch(e){if(e instanceof ConnectorError)throw e;throw e;}
}
