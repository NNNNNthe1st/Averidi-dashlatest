import {test} from "node:test";
import assert from "node:assert/strict";
import {dashboardReleaseConfig,isDashboardWorkspaceReleased} from "../src/server/release-gate";

test("default release is OFF even when code is deployed",()=>{
  const release=dashboardReleaseConfig({});
  assert.equal(release.mode,"OFF");
  assert.equal(isDashboardWorkspaceReleased("workspace",release),false);
});
test("beta grants only explicitly allowlisted workspaces",()=>{
  const release=dashboardReleaseConfig({DASHBOARD_RELEASE_MODE:"BETA",DASHBOARD_BETA_WORKSPACE_IDS:"a,b"});
  assert.equal(isDashboardWorkspaceReleased("a",release),true);
  assert.equal(isDashboardWorkspaceReleased("other",release),false);
});
test("general release requires explicit value and rejects invalid configuration",()=>{
  assert.equal(isDashboardWorkspaceReleased("w",dashboardReleaseConfig({DASHBOARD_RELEASE_MODE:"GENERAL"})),true);
  assert.throws(()=>dashboardReleaseConfig({DASHBOARD_RELEASE_MODE:"true"}));
  assert.throws(()=>dashboardReleaseConfig({DASHBOARD_BETA_WORKSPACE_IDS:"../unsafe"}));
  assert.throws(()=>dashboardReleaseConfig({DASHBOARD_BETA_WORKSPACE_IDS:"a,a"}));
});

test("BETA mode does not release unlisted workspaces through inferred identity",()=>{
 const config=dashboardReleaseConfig({DASHBOARD_RELEASE_MODE:"BETA",DASHBOARD_BETA_WORKSPACE_IDS:"allowed"});
 assert.equal(isDashboardWorkspaceReleased("unlisted",config),false);
 assert.equal(isDashboardWorkspaceReleased("",config),false);
});
