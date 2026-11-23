import {readdir,lstat,realpath,unlink} from 'node:fs/promises';
import path from 'node:path';
import {XMLParser} from 'fast-xml-parser';
import {dashboardStorageRoot,dashboardStoragePath,readDashboardObject,writeDashboardObject} from '../../server/storage';
import {dashboardObjectConfig,signedDashboardObjectRequest,validDashboardObjectKey} from '../../server/object-storage';
export type StoredObject={key:string;size:bigint;modifiedAt:Date;fingerprint:string;etag?:string;partial:boolean};
export type StorageBackend={list:(workspaceId?:string)=>Promise<StoredObject[]>;stat:(key:string)=>Promise<StoredObject|null>;read:(key:string)=>Promise<Buffer>;write:(key:string,bytes:Buffer)=>Promise<void>;remove:(object:StoredObject)=>Promise<void>};
const areas=['uploads','processed','snapshots','reports','exports','temporary'];
const id=/^[A-Za-z0-9_-]{1,128}$/;
export function storageMaintenanceKey(key:string){return validDashboardObjectKey(key)||(/\.tmp-[0-9a-f-]{36}$/.test(key)&&validDashboardObjectKey(key.replace(/\.tmp-[0-9a-f-]{36}$/,'')));}
function localPath(key:string){if(!storageMaintenanceKey(key))throw Error('INVALID_STORAGE_SCOPE');const suffix=key.match(/\.tmp-[0-9a-f-]{36}$/)?.[0]??'';return dashboardStoragePath(suffix?key.slice(0,-suffix.length):key)+suffix;}
async function rootExists(){try{const root=dashboardStorageRoot();if(await realpath(root)!==root)throw Error('INVALID_STORAGE_ROOT');const stat=await lstat(root);if(!stat.isDirectory()||(stat.mode&0o077))throw Error('INVALID_STORAGE_ROOT');return root;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
async function localStat(key:string):Promise<StoredObject|null>{
 const file=localPath(key);try{if(!await rootExists())return null;if(await realpath(path.dirname(file))!==path.dirname(file))throw Error('INVALID_STORAGE_SCOPE');const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('INVALID_STORAGE_SCOPE');return {key,size:BigInt(stat.size),modifiedAt:stat.mtime,fingerprint:JSON.stringify([stat.dev,stat.ino,stat.mtimeMs,stat.size]),partial:!validDashboardObjectKey(key)};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function localList(workspaceId?:string,signal?:AbortSignal){
 if(workspaceId&&!id.test(workspaceId))throw Error('INVALID_STORAGE_SCOPE');const root=await rootExists();if(!root)return [];
 const result:StoredObject[]=[];let visited=0;
 async function walk(relative:string,depth:number){
  signal?.throwIfAborted();if(++visited>200000||depth>5)throw Error('STORAGE_INVENTORY_LIMIT');const absolute=path.join(/* turbopackIgnore: true */ root!,relative);
  let entries;try{entries=await readdir(/* turbopackIgnore: true */ absolute,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  if(await realpath(/* turbopackIgnore: true */ absolute)!==absolute)throw Error('INVALID_STORAGE_SCOPE');
  for(const entry of entries){signal?.throwIfAborted();if(entry.isSymbolicLink())throw Error('INVALID_STORAGE_SCOPE');const key=relative+'/'+entry.name;
   if(entry.isDirectory()){if(!id.test(entry.name))throw Error('INVALID_STORAGE_SCOPE');await walk(key,depth+1);}
   else{const value=await localStat(key);if(value)result.push(value);if(result.length>100000)throw Error('STORAGE_INVENTORY_LIMIT');}
  }
 }
 for(const area of areas)await walk(workspaceId?area+'/'+workspaceId:area,workspaceId?2:1);
 return result.sort((a,b)=>a.key.localeCompare(b.key));
}
const decode=(value:string)=>value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
async function objectFetch(key:string,method:'GET'|'HEAD'|'DELETE',options:Parameters<typeof signedDashboardObjectRequest>[5]={},signal?:AbortSignal){
 const request=signedDashboardObjectRequest(dashboardObjectConfig(),key,method,undefined,new Date(),options);
 return fetch(request.url,{method,headers:request.headers,cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
}
async function boundedText(response:Response,max=4*1024*1024){if(Number(response.headers.get('content-length'))>max)throw Error('STORAGE_INVENTORY_LIMIT');const reader=response.body?.getReader();if(!reader)throw Error('STORAGE_UNAVAILABLE');let size=0;const chunks:Uint8Array[]=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('STORAGE_INVENTORY_LIMIT');}chunks.push(value);}}finally{reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');}
async function objectStat(key:string,signal?:AbortSignal):Promise<StoredObject|null>{
 const response=await objectFetch(key,'HEAD',{},signal);if(response.status===404)return null;if(!response.ok)throw Error('STORAGE_UNAVAILABLE');const etag=response.headers.get('etag'),size=response.headers.get('content-length'),date=response.headers.get('last-modified');if(!etag||!/^"[^"\r\n]{1,128}"$/.test(etag)||!size||!/^\d+$/.test(size)||!date||!Number.isFinite(Date.parse(date)))throw Error('STORAGE_INVENTORY_INVALID');
 return {key,size:BigInt(size),modifiedAt:new Date(date),etag,fingerprint:JSON.stringify([etag,String(BigInt(size))]),partial:false};
}
async function objectList(workspaceId?:string,signal?:AbortSignal){
 if(workspaceId&&!id.test(workspaceId))throw Error('INVALID_STORAGE_SCOPE');const result:StoredObject[]=[];const keys=new Set<string>();
 for(const area of areas){let cursor='';const seen=new Set<string>();for(let page=0;;page++){
  signal?.throwIfAborted();if(page>=1000)throw Error('STORAGE_INVENTORY_LIMIT');const prefix=area+'/'+(workspaceId?workspaceId+'/':'');const response=await objectFetch('','GET',{list:{prefix,continuationToken:cursor||undefined}},signal);if(!response.ok)throw Error('STORAGE_UNAVAILABLE');
  const xml=await boundedText(response);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('STORAGE_INVENTORY_INVALID');
  const data=new XMLParser({parseTagValue:false,processEntities:false,isArray:name=>name==='Contents'}).parse(xml)?.ListBucketResult;
  if(!data||!['true','false'].includes(data.IsTruncated))throw Error('STORAGE_INVENTORY_INVALID');
  for(const item of data.Contents??[]){const key=decodeURIComponent(String(item.Key));if(!validDashboardObjectKey(key)||!key.startsWith(prefix)||keys.has(key)||!/^\d+$/.test(String(item.Size)))throw Error('STORAGE_INVENTORY_INVALID');
   const etag=decode(String(item.ETag)),modifiedAt=new Date(item.LastModified);if(!/^"[^"\r\n]{1,128}"$/.test(etag)||!Number.isFinite(modifiedAt.getTime()))throw Error('STORAGE_INVENTORY_INVALID');keys.add(key);result.push({key,size:BigInt(item.Size),modifiedAt,etag,fingerprint:JSON.stringify([etag,String(BigInt(item.Size))]),partial:false});if(result.length>100000)throw Error('STORAGE_INVENTORY_LIMIT');
  }
  if(data.IsTruncated==='false')break;const next=decode(String(data.NextContinuationToken??''));if(!next||next.length>4096||seen.has(next))throw Error('STORAGE_INVENTORY_INVALID');seen.add(next);cursor=next;
 }}return result;
}
export function dashboardStorageBackend(signal?:AbortSignal):StorageBackend{
 const object=process.env.DASHBOARD_STORAGE_BACKEND==='object';if(!object&&process.env.DASHBOARD_STORAGE_BACKEND&&process.env.DASHBOARD_STORAGE_BACKEND!=='local')throw Error('INVALID_STORAGE_BACKEND');
 return {list:workspaceId=>object?objectList(workspaceId,signal):localList(workspaceId,signal),stat:key=>object?objectStat(key,signal):localStat(key),read:readDashboardObject,write:writeDashboardObject,remove:async observed=>{
  signal?.throwIfAborted();const current=await (object?objectStat(observed.key,signal):localStat(observed.key));if(!current)return;if(current.fingerprint!==observed.fingerprint)throw Error('STORAGE_OBJECT_CHANGED');
  if(object){const result=await objectFetch(observed.key,'DELETE',{ifMatch:current.etag},signal);if(result.status===412)throw Error('STORAGE_OBJECT_CHANGED');if(!result.ok&&result.status!==404)throw Error('STORAGE_UNAVAILABLE');}
  else await unlink(localPath(observed.key));
 }};
}
