import {test} from "node:test";
import assert from "node:assert/strict";
import {dashboardObjectConfig,signedDashboardObjectRequest,validDashboardObjectKey} from "../src/server/object-storage";
const config={DASHBOARD_OBJECT_ENDPOINT:"https://objects.example.test",DASHBOARD_OBJECT_BUCKET:"dashboard-private",DASHBOARD_OBJECT_REGION:"us-east-1",DASHBOARD_OBJECT_ACCESS_KEY_ID:"dashboard_test_key",DASHBOARD_OBJECT_SECRET_ACCESS_KEY:"only-dashboard-object-secret"};
test("object storage fails closed without independent credentials",()=>{
 assert.throws(()=>dashboardObjectConfig({}));
 assert.throws(()=>dashboardObjectConfig({...config,DASHBOARD_OBJECT_ENDPOINT:"http://objects.example.test"}));
 assert.throws(()=>dashboardObjectConfig({...config,DASHBOARD_OBJECT_ENDPOINT:"https://objects.example.test@evil.test"}));
});
test("object requests use strictly scoped keys and signed credentials",()=>{
 const settings=dashboardObjectConfig(config);
 assert.equal(validDashboardObjectKey("reports/ws_1/report_2.bin"),true);
 for(const key of ["../website/data","reports/ws1/../secret.bin","analyst/ws/x.bin","uploads/ws/source.bin"])assert.equal(validDashboardObjectKey(key),false);
 const request=signedDashboardObjectRequest(settings,"reports/ws_1/report_2.bin","PUT",Buffer.from("test"),new Date("2026-10-22T00:00:00Z"));
 assert.equal(request.url,"https://objects.example.test/dashboard-private/reports/ws_1/report_2.bin");
 assert.match(request.headers.authorization,/AWS4-HMAC-SHA256 Credential=dashboard_test_key/);
 assert.equal(request.headers["if-none-match"],"*");
 assert.equal(request.headers.authorization.includes(settings.secretAccessKey),false);
});

test('object transport reports permission failures and bounds streamed reads',async()=>{
 const {requestDashboardObject}=await import('../src/server/object-storage');
 const previous={...process.env};
 const original=globalThis.fetch;
 Object.assign(process.env,config);
 try{
  globalThis.fetch=async()=>new Response(null,{status:403});
  await assert.rejects(()=>requestDashboardObject('reports/ws/report.bin','HEAD'),/403/);
  globalThis.fetch=async()=>new Response(null,{status:404});
  assert.equal(await requestDashboardObject('reports/ws/report.bin','HEAD'),false);
  let cancelled=false;
  globalThis.fetch=async()=>new Response(new ReadableStream({
   pull(controller){controller.enqueue(new Uint8Array(1024*1024));},
   cancel(){cancelled=true;}
  }));
  await assert.rejects(()=>requestDashboardObject('reports/ws/report.bin','GET'),/read limit/);
  assert.equal(cancelled,true);
  await assert.rejects(()=>requestDashboardObject('reports/ws/report.bin','DELETE'),/Only temporary/);
 }finally{
  globalThis.fetch=original;
  for(const key of Object.keys(config))if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
 }
});
