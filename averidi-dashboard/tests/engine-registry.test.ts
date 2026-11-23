import {test} from "node:test";
import assert from "node:assert/strict";
import {DASHBOARD_ENGINES,dashboardEngineManifest,requireDashboardEngine} from "../src/engines/engine-registry";
test("Dashboard engine manifest is versioned and contains only independent capabilities",()=>{
 assert.deepEqual(Object.keys(DASHBOARD_ENGINES).sort(),["analysis","generation","ingestion","metrics","reporting","understanding","visualization"]);
 assert.equal(dashboardEngineManifest().version,1);
 assert.equal(requireDashboardEngine("metrics",1).id,"metrics");
 assert.throws(()=>requireDashboardEngine("analyst",1),/Unknown Dashboard engine/);
 assert.throws(()=>requireDashboardEngine("metrics",2),/Unsupported Dashboard engine version/);
});
