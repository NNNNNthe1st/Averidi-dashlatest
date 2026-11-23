import { test } from "node:test";
import assert from "node:assert/strict";
import { exportDashboardDefinitionCsv } from "../src/features/reports/view-export";
import type { DashboardConfig } from "../src/engines/generation/dashboard-templates";

test("CSV export escapes quoted strings and formula-like widget titles",()=>{
  const config:DashboardConfig={schemaVersion:1,template:"CUSTOM",templateVersion:1,name:"Overview",widgets:[
    {id:"b",kind:"KPI",metricKey:"ORDERS",title:'=HYPERLINK("evil")',visible:true,order:1},
    {id:"a",kind:"KPI",metricKey:"REVENUE",title:'Revenue, net',visible:true,order:0},
  ]};
  const csv=exportDashboardDefinitionCsv(config);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Revenue, net"'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.indexOf('"Revenue, net"')<csv.indexOf("'=HYPERLINK"));
  assert.ok(csv.includes("\r\n"));
});
