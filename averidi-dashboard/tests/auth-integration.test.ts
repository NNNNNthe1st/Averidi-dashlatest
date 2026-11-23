import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
import {issueDashboardBrowserSession,verifyDashboardBrowserSession,revokeDashboardBrowserSession} from "../src/server/browser-session";

test("standalone database sessions are individually revocable",async()=>{
 const oldSecret=process.env.DASHBOARD_SESSION_SECRET;
 const oldVersion=process.env.DASHBOARD_SESSION_VERSION;
 const suffix=randomUUID();
 const issuer="https://identity.example/";
 const subject="test-"+suffix;
 const externalSubject=issuer+"|"+subject;
 process.env.DASHBOARD_SESSION_SECRET="x".repeat(64);
 process.env.DASHBOARD_SESSION_VERSION="integration";
 const user=await dashboardDb.dashboardUser.create({data:{externalSubject},select:{id:true}});
 try{
  const actor={userId:user.id,issuer,subject};
  const first=await issueDashboardBrowserSession(actor);
  const second=await issueDashboardBrowserSession(actor);
  assert.deepEqual(await verifyDashboardBrowserSession(first),actor);
  await revokeDashboardBrowserSession(first);
  assert.equal(await verifyDashboardBrowserSession(first),null);
  assert.deepEqual(await verifyDashboardBrowserSession(second),actor);
  await revokeDashboardBrowserSession(second);
  assert.equal(await verifyDashboardBrowserSession(second),null);
 }finally{
  await dashboardDb.dashboardUser.delete({where:{id:user.id}});
  if(oldSecret===undefined)delete process.env.DASHBOARD_SESSION_SECRET;else process.env.DASHBOARD_SESSION_SECRET=oldSecret;
  if(oldVersion===undefined)delete process.env.DASHBOARD_SESSION_VERSION;else process.env.DASHBOARD_SESSION_VERSION=oldVersion;
 }
});
