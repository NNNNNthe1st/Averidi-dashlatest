import {createHash,createHmac} from "node:crypto";
import {dashboardStorageKey,dashboardWorkspaceArtifactKey} from "./storage";

export type DashboardObjectConfig=Readonly<{endpoint:string;bucket:string;region:string;accessKeyId:string;secretAccessKey:string}>;
export function dashboardObjectConfig(env:Partial<NodeJS.ProcessEnv>=process.env):DashboardObjectConfig{
 const endpoint=env.DASHBOARD_OBJECT_ENDPOINT, bucket=env.DASHBOARD_OBJECT_BUCKET,
 region=env.DASHBOARD_OBJECT_REGION,accessKeyId=env.DASHBOARD_OBJECT_ACCESS_KEY_ID,
 secretAccessKey=env.DASHBOARD_OBJECT_SECRET_ACCESS_KEY;
 if(!endpoint||!bucket||!region||!accessKeyId||!secretAccessKey)throw new Error("Independent Dashboard object credentials are incomplete.");
 let url:URL;try{url=new URL(endpoint);}catch{throw new Error("Invalid Dashboard object endpoint.");}
 if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search||url.pathname!=="/"||!url.hostname)throw new Error("Dashboard object endpoint must be an HTTPS origin.");
 if(!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket)||!/^[a-z0-9-]{1,40}$/.test(region)||!/^[A-Za-z0-9_-]{8,128}$/.test(accessKeyId)||secretAccessKey.length<16)throw new Error("Invalid Dashboard object credentials.");
 return {endpoint:url.origin,bucket,region,accessKeyId,secretAccessKey};
}
export function validDashboardObjectKey(key:string){
 return /^(?:uploads\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/source\.bin|(?:processed|snapshots|reports|exports|temporary)\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\.bin)$/.test(key);
}
const hash=(v:Uint8Array|string)=>createHash("sha256").update(v).digest("hex");
const hmac=(key:Uint8Array|string,value:string)=>createHmac("sha256",key).update(value).digest();
export function signedDashboardObjectRequest(config:DashboardObjectConfig,key:string,method:"GET"|"PUT"|"HEAD"|"DELETE",body:Uint8Array=new Uint8Array(),now=new Date(),options:{list?:{prefix:string;continuationToken?:string};ifMatch?:string}={}):{url:string;headers:Record<string,string>}{
 if(options.list?method!=="GET"||key!==""||! /^(uploads|processed|snapshots|reports|exports|temporary)\/(?:[A-Za-z0-9_-]{1,128}\/)?$/.test(options.list.prefix):!validDashboardObjectKey(key))throw new Error("Invalid Dashboard object key.");
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,""),day=stamp.slice(0,8);
 const uri="/"+config.bucket+(options.list?"":"/"+key.split("/").map(encodeURIComponent).join("/"));
 const encode=(v:string)=>encodeURIComponent(v).replace(/[!\'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
 const query=options.list?Object.entries({"list-type":"2",prefix:options.list.prefix,"encoding-type":"url","max-keys":"1000",...(options.list.continuationToken?{"continuation-token":options.list.continuationToken}:{})}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>encode(k)+"="+encode(v)).join("&"):"";
 const url=new URL(config.endpoint+uri);
 url.search=query;
 if(options.ifMatch&&(!/^"[^"\r\n]{1,128}"$/.test(options.ifMatch)))throw new Error("Invalid object fingerprint.");
 const digest=hash(method==="PUT"?body:new Uint8Array());
 const signedHeaders=(method==="PUT"?"host;if-none-match;":options.ifMatch?"host;if-match;":"host;")+"x-amz-content-sha256;x-amz-date";
 const canonicalHeaders="host:"+url.host+"\n"+(method==="PUT"?"if-none-match:*\n":options.ifMatch?"if-match:"+options.ifMatch+"\n":"")+"x-amz-content-sha256:"+digest+"\n"+"x-amz-date:"+stamp+"\n";
 const canonical=[method,uri,query,canonicalHeaders,signedHeaders,digest].join("\n");
 const scope=day+"/"+config.region+"/s3/aws4_request";
 const stringToSign=["AWS4-HMAC-SHA256",stamp,scope,hash(canonical)].join("\n");
 const signature=createHmac("sha256",hmac(hmac(hmac(hmac("AWS4"+config.secretAccessKey,day),config.region),"s3"),"aws4_request")).update(stringToSign).digest("hex");
 return {url:url.toString(),headers:{
  "x-amz-date":stamp,"x-amz-content-sha256":digest,
  "authorization":"AWS4-HMAC-SHA256 Credential="+config.accessKeyId+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature,
  ...(method==="PUT"?{"if-none-match":"*"}:options.ifMatch?{"if-match":options.ifMatch}:{})
 }};
}
export async function requestDashboardObject(key:string,method:"GET"|"PUT"|"HEAD"|"DELETE",bytes?:Uint8Array){
 if(method==="DELETE"&&!key.startsWith("temporary/"))throw new Error("Only temporary objects can be deleted.");
 const config=dashboardObjectConfig();
 const body=bytes??new Uint8Array();
 const req=signedDashboardObjectRequest(config,key,method,body);
 const result=await fetch(req.url,{method,headers:req.headers,body:method==="PUT"?Buffer.from(body):undefined,signal:AbortSignal.timeout(15000),cache:"no-store",redirect:"error"});
 if(method==="HEAD"&&result.status===404)return false;
 if(method==="HEAD"&&result.ok)return true;
 if(method==="GET"&&result.status===404)throw Object.assign(new Error("Dashboard storage object not found."),{code:"DASHBOARD_OBJECT_NOT_FOUND"});
 if(!result.ok)throw new Error("Dashboard storage request failed: HTTP "+result.status);
 if(method==="GET"){
  const maxBytes=50*1024*1024;
  const length=Number(result.headers.get("content-length"));
  if(length>maxBytes){await result.body?.cancel();throw new Error("Dashboard object exceeds read limit.");}
  const chunks: Uint8Array[]=[];
  let size=0;
  if(!result.body)throw new Error("Dashboard storage returned no body.");
  const reader=result.body.getReader();
  try {
   for(;;){const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>maxBytes){await reader.cancel();throw new Error("Dashboard object exceeds read limit.");}
    chunks.push(value);
   }
  }finally{reader.releaseLock();}
  return Buffer.concat(chunks,size);
 }
}
export const dashboardObjectKey={upload:dashboardStorageKey,artifact:dashboardWorkspaceArtifactKey};
