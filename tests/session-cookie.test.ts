import {test} from "node:test";
import assert from "node:assert/strict";
import {DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions,extractDashboardSessionCookie} from "../src/server/session-cookie";

test("browser cookie uses secure host-only Dashboard-path settings",()=>{
  assert.ok(DASHBOARD_SESSION_COOKIE.startsWith("__Secure-"));
  assert.deepEqual(dashboardSessionCookieOptions(),{httpOnly:true,secure:true,sameSite:"lax",path:"/dashboard/app",maxAge:1800});
});
test("cookie parser rejects duplicates, malformed and oversized tokens",()=>{
  const request=(raw:string)=>new Request("https://dashboard.example.test",{headers:{cookie:raw}});
  assert.equal(extractDashboardSessionCookie(request(DASHBOARD_SESSION_COOKIE+"=abc.def")),"abc.def");
  assert.equal(extractDashboardSessionCookie(request(DASHBOARD_SESSION_COOKIE+"=one; "+DASHBOARD_SESSION_COOKIE+"=two")),null);
  assert.equal(extractDashboardSessionCookie(request(DASHBOARD_SESSION_COOKIE+"=bad%20value")),null);
  assert.equal(extractDashboardSessionCookie(request(DASHBOARD_SESSION_COOKIE+"="+"x".repeat(4097))),null);
});
