import { test } from "node:test";
import assert from "node:assert/strict";
import { METRIC_DEFINITIONS, eligibleMetricMappings, metricComparison, metricTarget } from "../src/engines/metrics/metric-engine";
import { dashboardConceptExists, recognizeDashboardConcept } from "../src/engines/understanding/concept-registry";

test("Dashboard metric catalog retains essential business KPIs", () => {
  const keys = new Set(METRIC_DEFINITIONS.map(m => m.key));
  for (const key of ["REVENUE", "COST", "PROFIT", "GROSS_MARGIN", "ORDERS", "CUSTOMERS", "UNITS"] as const) {
    assert.equal(keys.has(key), true, key);
  }
});

test("unconfirmed field mappings never contribute to metrics", () => {
  const eligible = eligibleMetricMappings([
    {sourceField:"sales",canonicalConcept:"REVENUE",status:"CONFIRMED",role:"MEASURE"},
    {sourceField:"guess",canonicalConcept:"REVENUE",status:"SUGGESTED",role:"MEASURE"},
  ], "REVENUE");
  assert.deepEqual(eligible.map(x=>x.sourceField),["sales"]);
});

test("metric comparison and targets retain deterministic semantics", () => {
  assert.deepEqual(metricComparison(120,100),{absolute:20,percentage:0.2});
  assert.equal(metricTarget(120,100).met,true);
  assert.throws(()=>metricTarget(100,0));
});

test("concept recognition remains owned by standalone Dashboard", () => {
  assert.equal(dashboardConceptExists("REVENUE"),true);
  assert.equal(typeof recognizeDashboardConcept("revenue"),"string");
});
