import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {dashboardStorageBackend} from '../src/features/storage/inventory';
import {dashboardObjectConfig,signedDashboardObjectRequest} from '../src/server/object-storage';

test('S3 inventory signs pagination and conditional deletion, handles XML escapes and rejects races/redirects',async()=>{
 const previous={...process.env},original=globalThis.fetch;
 Object.assign(process.env,{DASHBOARD_STORAGE_BACKEND:'object',DASHBOARD_OBJECT_ENDPOINT:'https://storage.example.test',DASHBOARD_OBJECT_BUCKET:'dashboard-private',DASHBOARD_OBJECT_REGION:'us-east-1',DASHBOARD_OBJECT_ACCESS_KEY_ID:'dashboard_storage_fixture',DASHBOARD_OBJECT_SECRET_ACCESS_KEY:'dashboard-storage-test-secret'});
 const values=new Map([['processed/workspace/first.bin',{bytes:Buffer.from('first'),etag:'"first-etag"'}],['processed/workspace/second.bin',{bytes:Buffer.from('second'),etag:'"second-etag"'}]]);let conditional=false,requestedPages=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input)),method=init?.method??'GET',headers=init?.headers as Record<string,string>;
  assert.match(headers.authorization,/AWS4-HMAC-SHA256/);assert.equal(init?.redirect,'error');
  if(url.searchParams.get('list-type')==='2'){
   assert.match(headers.authorization,/SignedHeaders=host;x-amz-content-sha256;x-amz-date/);assert.equal(url.searchParams.get('encoding-type'),'url');
   const prefix=url.searchParams.get('prefix')!;if(prefix!=='processed/workspace/')return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
   requestedPages++;const second=!!url.searchParams.get('continuation-token');if(second)assert.equal(url.searchParams.get('continuation-token'),'page&two');const key=second?'processed/workspace/second.bin':'processed/workspace/first.bin',value=values.get(key)!;
   return new Response(`<ListBucketResult><IsTruncated>${!second}</IsTruncated><Contents><Key>${encodeURIComponent(key)}</Key><Size>${value.bytes.length}</Size><ETag>${value.etag.replaceAll('"','&quot;')}</ETag><LastModified>2026-01-01T00:00:00.123Z</LastModified></Contents>${second?'':'<NextContinuationToken>page&amp;two</NextContinuationToken>'}</ListBucketResult>`);
  }
  const key=decodeURIComponent(url.pathname.slice('/dashboard-private/'.length)),value=values.get(key);if(!value)return new Response(null,{status:404});
  if(method==='HEAD')return new Response(null,{headers:{etag:value.etag,'content-length':String(value.bytes.length),'last-modified':'Thu, 01 Jan 2026 00:00:00 GMT'}});
  if(method==='DELETE'){conditional=true;assert.equal(headers['if-match'],value.etag);assert.match(headers.authorization,/host;if-match;x-amz-content-sha256;x-amz-date/);values.delete(key);return new Response(null,{status:204});}
  return new Response(value.bytes);
 };
 try{
  const backend=dashboardStorageBackend(),objects=await backend.list('workspace');assert.equal(objects.length,2);assert.equal(requestedPages,2);
  assert.equal(objects[0].fingerprint,(await backend.stat(objects[0].key))!.fingerprint,'list milliseconds and HTTP HEAD seconds do not change content identity');
  values.get(objects[0].key)!.etag='"changed"';await assert.rejects(()=>backend.remove(objects[0]),/STORAGE_OBJECT_CHANGED/);assert.equal(values.size,2);
  await backend.remove(objects[1]);assert.equal(conditional,true);assert.equal(values.size,1);
  const request=signedDashboardObjectRequest(dashboardObjectConfig(),'', 'GET',undefined,new Date('2026-01-01T00:00:00Z'),{list:{prefix:'processed/workspace/',continuationToken:'a+b/c=='}});assert.equal(new URL(request.url).searchParams.get('continuation-token'),'a+b/c==');assert.ok(request.url.includes('%2B'));
  globalThis.fetch=async()=>new Response('<!DOCTYPE x [<!ENTITY attack SYSTEM "file:///etc/passwd">]><ListBucketResult/>');await assert.rejects(()=>backend.list('workspace'),/STORAGE_INVENTORY_INVALID/);
  globalThis.fetch=async()=>new Response(null,{status:403});await assert.rejects(()=>backend.list('workspace'),/STORAGE_UNAVAILABLE/);
  globalThis.fetch=async()=>new Response('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken></ListBucketResult>');await assert.rejects(()=>backend.list('workspace'),/STORAGE_INVENTORY_INVALID/);
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
