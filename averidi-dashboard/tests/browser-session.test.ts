import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {dashboardDb} from "../src/server/db";
import {jwtVerify} from "jose";
import {issueDashboardBrowserSession,verifyDashboardBrowserSession} from "../src/server/browser-session";

test("signed Dashboard session includes controlled issuer, audience, short expiry and generation",async()=>{
 const prev=process.env.DASHBOARD_SESSION_SECRET;
 const ver=process.env.DASHBOARD_SESSION_VERSION;
 process.env.DASHBOARD_SESSION_SECRET="a".repeat(64);
 process.env.DASHBOARD_SESSION_VERSION="v1";
 const user=await dashboardDb.dashboardUser.create({data:{externalSubject:"session-test|"+randomUUID()}});
 try {
  const signed=await issueDashboardBrowserSession({userId:user.id,issuer:"https://issuer.example/",subject:"external-1"});
  const {payload}=await jwtVerify(signed,new TextEncoder().encode("a".repeat(64)),{issuer:"averidi-dashboard",audience:"averidi-dashboard-browser",algorithms:["HS256"]});
  assert.equal(payload.sub,"external-1");
  assert.equal(payload.sessionVersion,"v1");
  assert.ok(typeof payload.jti==="string" && payload.jti.length>10);
  assert.ok(Number(payload.exp)-Number(payload.iat)<=1800);
  process.env.DASHBOARD_SESSION_VERSION="v2";
  assert.equal(await verifyDashboardBrowserSession(signed),null);
 } finally {
  await dashboardDb.dashboardUser.delete({where:{id:user.id}});
  if(prev===undefined)delete process.env.DASHBOARD_SESSION_SECRET; else process.env.DASHBOARD_SESSION_SECRET=prev;
  if(ver===undefined)delete process.env.DASHBOARD_SESSION_VERSION; else process.env.DASHBOARD_SESSION_VERSION=ver;
 }
});
