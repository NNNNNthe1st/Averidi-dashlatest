import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const hmac=(key:Buffer|string,value:string)=>createHmac('sha256',key).update(value).digest();
const encode=(v:string)=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const xml=(v:string)=>v.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
/** Disposable HTTPS S3 protocol fixture: independently verifies SigV4 and conditional requests. */
export async function startStorageProvider(){
 const accessKey='dashboard_storage_fixture',secret='dashboard-storage-fixture-secret',bucket='dashboard-private';
 const objects=new Map<string,{bytes:Buffer;modifiedAt:Date;etag:string}>();let signedRequests=0,deleteFailures=0,successfulDeletes=0;
 const server=https.createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},async(req,res)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks),url=new URL(req.url!,'https://fixture');
   const authorization=req.headers.authorization??'',match=/^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(authorization);
   if(!match||match[1]!==accessKey){res.writeHead(403);res.end();return;}
   const scope=match[2],signed=match[3].split(';'),stamp=String(req.headers['x-amz-date']??''),digest=String(req.headers['x-amz-content-sha256']??'');
   const canonicalHeaders=signed.map(name=>name+':'+String(req.headers[name]??'').trim().replace(/\s+/g,' ')+'\n').join('');
   const query=[...url.searchParams].map(([k,v])=>[encode(k),encode(v)]).sort(([ak,av],[bk,bv])=>ak<bk?-1:ak>bk?1:av<bv?-1:av>bv?1:0).map(([k,v])=>k+'='+v).join('&');
   const canonical=[req.method,url.pathname,query,canonicalHeaders,match[3],digest].join('\n');const parts=scope.split('/');
   const signingKey=hmac(hmac(hmac(hmac('AWS4'+secret,parts[0]),parts[1]),parts[2]),parts[3]);
   const signature=createHmac('sha256',signingKey).update(['AWS4-HMAC-SHA256',stamp,scope,hash(canonical)].join('\n')).digest('hex');
   if(digest!==hash(body)||!timingSafeEqual(Buffer.from(signature),Buffer.from(match[4]))){res.writeHead(403);res.end();return;}signedRequests++;
   if(url.pathname==='/'+bucket&&url.searchParams.get('list-type')==='2'){
    const prefix=url.searchParams.get('prefix')??'',offset=Number(url.searchParams.get('continuation-token')??0),items=[...objects].filter(([key])=>key.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b));const page=items.slice(offset,offset+2),more=offset+page.length<items.length;
    res.setHeader('content-type','application/xml');res.end(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${page.map(([key,value])=>`<Contents><Key>${encodeURIComponent(key)}</Key><Size>${value.bytes.length}</Size><ETag>${xml(value.etag)}</ETag><LastModified>${value.modifiedAt.toISOString()}</LastModified></Contents>`).join('')}${more?`<NextContinuationToken>${offset+page.length}</NextContinuationToken>`:''}</ListBucketResult>`);return;
   }
   if(!url.pathname.startsWith('/'+bucket+'/')){res.writeHead(404);res.end();return;}
   const key=decodeURIComponent(url.pathname.slice(bucket.length+2)),stored=objects.get(key);
   if(req.method==='PUT'){
    if(req.headers['if-none-match']!=='*'){res.writeHead(400);res.end();return;}
    if(stored){res.writeHead(412);res.end();return;}
    objects.set(key,{bytes:body,modifiedAt:new Date(),etag:'"'+hash(body)+'"'});res.writeHead(200);res.end();return;
   }
   if(!stored){res.writeHead(404);res.end();return;}
   if(req.method==='DELETE'){
    if(req.headers['if-match']!==stored.etag){res.writeHead(412);res.end();return;}
    if(deleteFailures){deleteFailures--;res.writeHead(503);res.end();return;}
    objects.delete(key);successfulDeletes++;res.writeHead(204);res.end();return;
   }
   res.setHeader('etag',stored.etag);res.setHeader('last-modified',stored.modifiedAt.toUTCString());res.setHeader('content-length',String(stored.bytes.length));
   if(req.method==='HEAD'){res.writeHead(200);res.end();return;}
   if(req.method==='GET'){res.writeHead(200);res.end(stored.bytes);return;}
   res.writeHead(405);res.end();
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 return {settings:{DASHBOARD_STORAGE_BACKEND:'object',DASHBOARD_OBJECT_ENDPOINT:`https://127.0.0.1:${port}`,DASHBOARD_OBJECT_BUCKET:bucket,DASHBOARD_OBJECT_REGION:'us-east-1',DASHBOARD_OBJECT_ACCESS_KEY_ID:accessKey,DASHBOARD_OBJECT_SECRET_ACCESS_KEY:secret},objects,failDeleteOnce:()=>{deleteFailures++;},get signedRequests(){return signedRequests;},get successfulDeletes(){return successfulDeletes;},close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
