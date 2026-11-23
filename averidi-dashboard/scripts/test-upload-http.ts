import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs-hardened';
import {dashboardDb as db} from '../src/server/db';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
const port=55440,base='http://127.0.0.1:'+port+'/dashboard/app',origin='https://upload.example.test';
let logs='',server:any,workspaceId:string|undefined,userId:string|undefined,foreignId:string|undefined,storage:string|undefined;
const suffix=randomUUID();
const entries:any[]=[];
async function main(){
 assert.match(new URL(process.env.DASHBOARD_DATABASE_URL??'').pathname,/_test$/,'Use a dedicated migrated *_test database');
 assert.equal(process.versions.node.split('.')[0],'22','Use Node 22');
 storage=await realpath(await mkdtemp(path.join(tmpdir(),'dashboard-upload-http-')));
 Object.assign(process.env,{DASHBOARD_STORAGE_ROOT:storage,DASHBOARD_STORAGE_BACKEND:'local',DASHBOARD_RELEASE_MODE:'GENERAL',DASHBOARD_PUBLIC_ORIGIN:origin,DASHBOARD_SESSION_SECRET:randomBytes(48).toString('hex'),DASHBOARD_WORKER_ENABLED:'true',DASHBOARD_ACCOUNT_ERASURE_ENABLED:'false',DASHBOARD_QUERY_CACHE_ENABLED:'false',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_DATA_CONNECTORS_ENABLED:'false',DASHBOARD_BILLING_ENABLED:'false',DASHBOARD_RATE_LIMIT_AUTH_PER_MINUTE:'100000',DASHBOARD_RATE_LIMIT_API_PER_MINUTE:'100000',NEXT_TELEMETRY_DISABLED:'1'});
 const user=await db.dashboardUser.create({data:{externalSubject:'upload-test|'+suffix,email:'upload-'+suffix+'@example.test',emailVerifiedAt:new Date()}});
 userId=user.id;
 const actor={userId:user.id,issuer:'upload-test',subject:suffix};
 const workspace=await db.dashboardWorkspace.create({data:{name:'Upload test',trialStartedAt:user.createdAt,memberships:{create:{userId:user.id,role:'OWNER'}}}});
 workspaceId=workspace.id;
 const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(actor);
 const prefix='/api/workspaces/'+workspace.id;
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port),...(process.env.AUDIT_WEBPACK==='true'?['--webpack']:[])],{env:process.env,stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',(c:Buffer)=>{logs+=c.toString();});server.stderr.on('data',(c:Buffer)=>{logs+=c.toString();});
 for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error('Next exited:\n'+logs);if(logs.includes('Ready in'))break;await new Promise(r=>setTimeout(r,500));}
 async function api(p:string,body?:any){return fetch(base+p,{method:body?'POST':'GET',headers:{cookie,origin,'sec-fetch-site':'same-origin',referer:origin+'/dashboard/app/signup',...(body instanceof FormData?{}:body?{'content-type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});}
 async function file(p:string,name:string,bytes:Buffer,sheet?:string,mode='REPLACE',identity?:string){
  const body=new FormData();body.set('file',new File([new Uint8Array(bytes)],name));
  if(sheet)body.set('worksheet',sheet);
  body.set('mode',mode);if(identity)body.set('recordIdentityField',identity);if(mode==='SYNCHRONIZE')body.set('completeSnapshot','true');
  return api(p,body);
 }
 const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('売上');sheet.addRow(['Date','Product','Revenue']);sheet.addRow([new Date('2026-01-01'),'珈琲',100]);const xlsx=Buffer.from(await workbook.xlsx.writeBuffer());
 const multi=new ExcelJS.Workbook();for(const name of ['Sales','Costs']){const sh=multi.addWorksheet(name);sh.addRow(['Name','Value']);sh.addRow(['A',10]);}const multiBytes=Buffer.from(await multi.xlsx.writeBuffer());
 const big=Buffer.from('Description,Revenue\n"'+('x'.repeat(11*1024*1024))+'",100');
 const cases=[
 {name:'csv',file:'sample.CSV',bytes:Buffer.from('Date,Product,Revenue\n2026-01-01,Coffee,100')},
 {name:'json',file:'sample.json',bytes:Buffer.from('[{"Date":"2026-01-01","Product":"Coffee","Revenue":100}]')},
 {name:'json-rows',file:'sample.json',bytes:Buffer.from('{"rows":[{"Product":"Coffee","Revenue":100}]}')},
 {name:'csv-utf16',file:'excel.csv',bytes:Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('Product,Revenue\n珈琲,100','utf16le')])},
 {name:'csv-semicolon',file:'regional.csv',bytes:Buffer.from('Product;Revenue\n珈琲;100')},
 {name:'json-bom',file:'bom.json',bytes:Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('[{"Product":"珈琲","Revenue":100}]')])},
 {name:'xlsx',file:'sample.xlsx',bytes:xlsx},
 {name:'multi-xlsx',file:'multi.xlsx',bytes:multiBytes,sheet:'Costs'},
 {name:'large-csv',file:'large.csv',bytes:big}
 ];
 for(const item of cases){
  const preview=await file(prefix+'/datasets/preview',item.file,item.bytes,item.sheet);
  const p=await preview.json();assert.equal(preview.status,200,item.name+' preview '+JSON.stringify(p));
  const created=await api(prefix+'/datasets',{name:item.name});const c=await created.json();assert.equal(created.status,201,item.name+' create '+JSON.stringify(c));
  const uploaded=await file(prefix+'/datasets/'+c.dataset.id+'/versions',item.file,item.bytes,item.sheet);
  const u=await uploaded.json();assert.equal(uploaded.status,202,item.name+' upload '+JSON.stringify(u));
  const result=await runDashboardWorkerOnce();assert.equal(result.status,'COMPLETED',item.name+' worker');
  const state=await api(prefix+'/datasets/'+c.dataset.id+'/versions');
  assert.equal(state.status,200,item.name+' versions endpoint');
  const history=await state.json();
  assert.equal(history.activeVersionId,u.version.id,item.name+' active upload version');
  assert.equal(history.versions.find((v:any)=>v.id===u.version.id)?.status,'READY',item.name+' queued job published READY version');
  const ds=await db.dashboardDataset.findUniqueOrThrow({where:{id:c.dataset.id},include:{activeVersion:true}});
  assert.equal(ds.status,'READY',item.name);assert.equal(ds.activeVersionId,u.version.id);assert.ok(ds.activeVersion!.rowCount!>0);
  entries.push({file:item.name,datasetId:c.dataset.id,preview:preview.status,upload:uploaded.status,status:ds.status,rows:ds.activeVersion!.rowCount});
  console.log('PASS',JSON.stringify(entries.at(-1)));
 }
 // Preview and final import must respect the same explicit text-field selection.
 const explicitPreview=new FormData();
 explicitPreview.set('file',new File([new Uint8Array(Buffer.from('Reference,Revenue\n12345,100'))],'selected.csv'));
 explicitPreview.set('preserveTextFields',JSON.stringify(['Reference']));
 const selected=await api(prefix+'/datasets/preview',explicitPreview);
 assert.equal(selected.status,200,'selected-field preview');
 const selectedData=await selected.json();
 assert.equal(selectedData.columns.find((c:any)=>c.name==='Reference')?.dataType,'TEXT');
 assert.equal(selectedData.preview[0].Reference,'12345');
 const invalidPreview=new FormData();
 invalidPreview.set('file',new File([new Uint8Array(Buffer.from('Reference,Revenue\n12345,100'))],'selected.csv'));
 invalidPreview.set('preserveTextFields',JSON.stringify(['not_a_column']));
 const invalidSelected=await api(prefix+'/datasets/preview',invalidPreview);
 assert.equal(invalidSelected.status,400,'reject unknown field overrides');
 const bad=await file(prefix+'/datasets/preview','bad.xlsx',Buffer.from('not a zip'));
 assert.equal(bad.status,422);
 const multiResponse=await file(prefix+'/datasets/preview','multi.xlsx',multiBytes);
 assert.equal(multiResponse.status,422);const multiError=await multiResponse.json();assert.match(multiError.message,/multiple.*worksheets/);assert.deepEqual(multiError.worksheets,['Sales','Costs']);
 // Chunked multipart has no Content-Length and must still be bounded and accepted.
 const chunkForm=new FormData();chunkForm.set('file',new File([Buffer.from('A,B\n1,2')],'chunked.csv'));
 const encoded=new Request('http://fixture',{method:'POST',body:chunkForm});const multipartBytes=new Uint8Array(await encoded.arrayBuffer());
 const chunked=await fetch(base+prefix+'/datasets/preview',{method:'POST',headers:{cookie,origin,'sec-fetch-site':'same-origin','content-type':encoded.headers.get('content-type')!},body:new ReadableStream({start(controller){controller.enqueue(multipartBytes);controller.close();}}),duplex:'half'} as RequestInit);
 assert.equal(chunked.status,200,'Chunked multipart upload');
 const chunkCreated=await api(prefix+'/datasets',{name:'Chunked CSV'});assert.equal(chunkCreated.status,201);const chunkId=(await chunkCreated.json()).dataset.id;
 const chunkUpload=await fetch(base+prefix+'/datasets/'+chunkId+'/versions',{method:'POST',headers:{cookie,origin,'sec-fetch-site':'same-origin','content-type':encoded.headers.get('content-type')!},body:new ReadableStream({start(c){c.enqueue(multipartBytes);c.close();}}),duplex:'half'} as RequestInit);
 assert.equal(chunkUpload.status,202,JSON.stringify(await chunkUpload.json()));await runDashboardWorkerOnce();
 const id=entries[0].datasetId;
 const appended=await file(prefix+'/datasets/'+id+'/versions','append.csv',Buffer.from('Date,Product,Revenue\n2026-01-02,Tea,200'),undefined,'APPEND','Date');assert.equal(appended.status,202,JSON.stringify(await appended.json()));
 await runDashboardWorkerOnce();assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id},include:{activeVersion:true}})).activeVersion!.rowCount,2);
 const synced=await file(prefix+'/datasets/'+id+'/versions','snapshot.csv',Buffer.from('Date,Product,Revenue\n2026-01-01,Coffee,150\n2026-01-03,Cocoa,300'),undefined,'SYNCHRONIZE','Date');assert.equal(synced.status,202,JSON.stringify(await synced.json()));
 await runDashboardWorkerOnce();
 const before=await db.dashboardDataset.findUniqueOrThrow({where:{id},include:{activeVersion:true}});assert.equal(before.activeVersion!.rowCount,2);
 const noChange=await db.dashboardDataset.findUniqueOrThrow({where:{id}});
 assert.equal(noChange.activeVersionId,before.activeVersionId,'Successful synchronization is active before rejected replacement');
 const rejected=await file(prefix+'/datasets/'+id+'/versions','broken.xlsx',Buffer.from('invalid workbook'));assert.equal(rejected.status,422);
 assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id}})).activeVersionId,before.activeVersionId,'Invalid replacement preserves active data');
 const oldStart=workspace.trialStartedAt;await db.dashboardWorkspace.update({where:{id:workspace.id},data:{trialStartedAt:new Date('2020-01-01')}});
 assert.equal((await file(prefix+'/datasets/preview','sample.csv',Buffer.from('A,B\n1,2'))).status,402,'Expired trials denied');
 await db.dashboardWorkspace.update({where:{id:workspace.id},data:{trialStartedAt:oldStart}});
 await db.dashboardSubscription.create({data:{workspaceId:workspace.id,planCode:'NONE',status:'INACTIVE',accessSuspended:true}});
 assert.equal((await file(prefix+'/datasets/preview','sample.csv',Buffer.from('A,B\n1,2'))).status,402,'Suspended access cannot fall back to trial');
 const foreign=await db.dashboardWorkspace.create({data:{name:'Other business',trialStartedAt:user.createdAt}});foreignId=foreign.id;
 assert.equal((await file('/api/workspaces/'+foreign.id+'/datasets/preview','sample.csv',Buffer.from('A,B\n1,2'))).status,403,'Other workspaces remain inaccessible');
 console.log('PASS chunked multipart, append, synchronize, failed replacement preservation and expired-trial denial');
 console.log('HTTP_UPLOAD_RESULTS',JSON.stringify(entries));
}
void (async()=>{try{await main();}catch(e){console.error(e);console.error(logs.slice(-14000));process.exitCode=1;}
finally{if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}if(workspaceId||foreignId)await db.dashboardWorkspace.deleteMany({where:{id:{in:[workspaceId,foreignId].filter((id):id is string=>!!id)}}});if(userId)await db.dashboardUser.deleteMany({where:{id:userId}});await db.$disconnect();if(storage)await rm(storage,{recursive:true,force:true});}})();


