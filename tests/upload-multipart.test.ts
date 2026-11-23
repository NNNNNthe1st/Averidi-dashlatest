import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDashboardMultipart,DashboardUploadRequestError} from '../src/engines/ingestion/multipart';
test('chunked multipart is accepted without Content-Length and file bytes are preserved',async()=>{
 const form=new FormData();form.set('file',new File(['A,B\n1,2'],'sample.csv'));
 const encoded=new Request('http://fixture',{method:'POST',body:form}),bytes=new Uint8Array(await encoded.arrayBuffer());
 const request=new Request('http://fixture',{method:'POST',headers:{'content-type':encoded.headers.get('content-type')!},body:new ReadableStream({start(c){c.enqueue(bytes.subarray(0,20));c.enqueue(bytes.subarray(20));c.close();}}),duplex:'half'} as RequestInit);
 const parsed=await readDashboardMultipart(request);const file=parsed.get('file') as File;
 assert.equal(file.name,'sample.csv');assert.equal(await file.text(),'A,B\n1,2');
});
test('actual streamed size is bounded even if length is absent or dishonest',async()=>{
 const old=process.env.DASHBOARD_MAX_FILE_MB;process.env.DASHBOARD_MAX_FILE_MB='1';
 try{
  for(const headers of [{'content-type':'multipart/form-data; boundary=fixture'},{'content-type':'multipart/form-data; boundary=fixture','content-length':'1'}]){
   let cancelled=false;
   const request=new Request('http://fixture',{method:'POST',headers,body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(128*1024));},cancel(){cancelled=true;}}),duplex:'half'} as RequestInit);
   await assert.rejects(readDashboardMultipart(request),(e:unknown)=>e instanceof DashboardUploadRequestError&&e.status===413);
   assert.equal(cancelled,true);
  }
  await assert.rejects(readDashboardMultipart(new Request('http://fixture',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=fixture','content-length':'9999999'},body:'small'})),(e:unknown)=>e instanceof DashboardUploadRequestError&&e.status===413);
 }finally{if(old===undefined)delete process.env.DASHBOARD_MAX_FILE_MB;else process.env.DASHBOARD_MAX_FILE_MB=old;}
});
test('non-multipart, invalid length and malformed boundaries produce controlled errors',async()=>{
 for(const request of [
  new Request('http://fixture',{method:'POST',body:'not multipart'}),
  new Request('http://fixture',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=fixture','content-length':'bad'},body:'bad'}),
  new Request('http://fixture',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=fixture'},body:'bad'}),
 ])await assert.rejects(readDashboardMultipart(request),DashboardUploadRequestError);
});

