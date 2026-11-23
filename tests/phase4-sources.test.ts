import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {DASHBOARD_SOURCE_CATALOG,assertDashboardSourceAvailable,dashboardSourceHealth} from "../src/features/data-sources/catalog";
import {sealDashboardCredential,openDashboardCredential} from "../src/features/data-sources/credentials";

test("file sources are available and implemented external providers stay disabled by default",()=>{
 assert.equal(DASHBOARD_SOURCE_CATALOG.FILE.availability,"AVAILABLE");
 for(const [kind,value] of Object.entries(DASHBOARD_SOURCE_CATALOG)){
  if(kind==="FILE")continue;
  assert.equal(value.availability,"IMPLEMENTED");
  assert.throws(()=>assertDashboardSourceAvailable(kind),/CONNECTOR_NOT_ENABLED/);
 }
 assert.doesNotThrow(()=>assertDashboardSourceAvailable("FILE"));
});
test("source health handles documented states and rejects unknown values",()=>{
 for(const value of ["CONNECTED","SYNCING","EXPIRED","DELAYED","FAILED","DISCONNECTED"])assert.equal(dashboardSourceHealth(value),value);
 assert.equal(dashboardSourceHealth("ready"),"FAILED");
});
test("credential envelopes are encrypted, authenticated and bound to tenant/source",()=>{
 const key=randomBytes(32).toString("hex");
 const token="private-credential-fixture";
 const sealed=sealDashboardCredential(token,"workspaceA","sourceA",key);
 assert.ok(!sealed.includes(token));
 assert.equal(openDashboardCredential(sealed,"workspaceA","sourceA",key),token);
 assert.throws(()=>openDashboardCredential(sealed,"workspaceB","sourceA",key));
 assert.throws(()=>openDashboardCredential(sealed,"workspaceA","sourceB",key));
 assert.throws(()=>openDashboardCredential(sealed+"A","workspaceA","sourceA",key));
 assert.throws(()=>sealDashboardCredential(token,"workspaceA","sourceA","short-key"));
});
