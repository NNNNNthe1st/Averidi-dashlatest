import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyDashboardAdminBridgeToken} from "../src/server/admin-bridge";
test("bridge is disabled unless explicitly configured and never trusts unsigned claims",async()=>{
 const old=process.env.DASHBOARD_ADMIN_BRIDGE_ENABLED;
 try {
  delete process.env.DASHBOARD_ADMIN_BRIDGE_ENABLED;
  assert.equal(await verifyDashboardAdminBridgeToken("forged","dashboard:manage"),null);
  process.env.DASHBOARD_ADMIN_BRIDGE_ENABLED="true";
  assert.equal(await verifyDashboardAdminBridgeToken("forged","dashboard:manage"),null);
 }finally{
  if(old===undefined)delete process.env.DASHBOARD_ADMIN_BRIDGE_ENABLED;else process.env.DASHBOARD_ADMIN_BRIDGE_ENABLED=old;
 }
});
