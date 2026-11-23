import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareDashboardRows } from "../src/engines/ingestion/ingest";
import { understandPreparedDataset,safeObservedRecordRules } from "../src/features/datasets/understanding";
import {analysisConfirmationSchema,retainedTextFields} from "../src/engines/analysis/pipeline";

test("independent understanding preserves the confirmation boundary", () => {
  const prepared = prepareDashboardRows([
    { order_id: "A1", revenue: 120, quantity: 2 },
    { order_id: "A2", revenue: 75, quantity: 1 },
  ]);
  const result = understandPreparedDataset(prepared);
  assert.equal(result.confirmationRequired, true);
  assert.ok(result.fields.some(field => field.sourceName === "revenue"));
  assert.ok(result.ontology);
});

test("semantic understanding never writes to another product", () => {
  const prepared = prepareDashboardRows([{ sales_amount: 25 }]);
  const result = understandPreparedDataset(prepared);
  assert.ok(Array.isArray(result.fields));
});

test("recognizes exact typed identifiers and dates without assuming financial definitions",()=>{
 const prepared=prepareDashboardRows([
  {"Order ID":"CA-001","Customer ID":"CG-001","Product ID":"P-001","Order Date":"2026-01-05","Quantity":2,"Sales":100},
  {"Order ID":"CA-001","Customer ID":"CG-001","Product ID":"P-002","Order Date":"2026-01-06","Quantity":3,"Sales":200}
 ]);
 const interpretation=understandPreparedDataset(prepared);
 const mappings=new Map(interpretation.confirmedMappings.map(item=>[item.sourceField,item.canonicalConcept]));
 assert.equal(mappings.get("Order ID"),"ORDER");
 assert.equal(mappings.get("Customer ID"),"CUSTOMER");
 assert.equal(mappings.get("Product ID"),"PRODUCT");
 assert.equal(mappings.get("Order Date"),"TIME");
 assert.equal(mappings.get("Quantity"),"QUANTITY");
 assert.equal(mappings.has("Sales"),false);
 assert.equal(interpretation.confirmationRequired,true);
});

test("does not accept a named identifier when rows lack identity values",()=>{
 const prepared=prepareDashboardRows([
  {"Order ID":"CA-001","Customer ID":"CG-001","Order Date":"2026-01-05","Quantity":2},
  {"Order ID":null,"Customer ID":"CG-002","Order Date":"2026-01-06","Quantity":3}
 ]);
 const interpretation=understandPreparedDataset(prepared);
 assert.equal(interpretation.confirmedMappings.some(m=>m.sourceField==="Order ID"),false);
 assert.equal(interpretation.confirmedMappings.some(m=>m.sourceField==="Customer ID"),true);
});

test("safe automatic rules validate while explicitly withholding all monetary assumptions",()=>{
 const prepared=prepareDashboardRows([
  {"Order ID":"A-1","Customer ID":"C-1","Quantity":2,"Sales":100},
  {"Order ID":"A-1","Customer ID":"C-1","Quantity":3,"Sales":200}
 ]);
 const mappings=understandPreparedDataset(prepared).confirmedMappings;
 const rules=safeObservedRecordRules("version-1",prepared,mappings);
 assert.ok(rules);
 assert.equal(rules.grain,"RECORD");
 assert.equal(rules.currency,null);
 assert.equal(rules.currencyMode,"UNSPECIFIED");
 assert.equal(rules.revenueBasis,"UNKNOWN");
 assert.equal(rules.refundsIncluded,null);
 assert.equal(rules.rowAmountsConfirmed,false);
});
test("unsafe datasets do not receive automatic calculation rules",()=>{
 const prepared=prepareDashboardRows([
  {"Order ID":"A-1","Quantity":2},
  {"Order ID":"A-1","Quantity":2}
 ]);
 const mappings=understandPreparedDataset(prepared).confirmedMappings;
 assert.equal(safeObservedRecordRules("version-1",prepared,mappings),null);
});

test("Sales is a revenue candidate, not an automatically confirmed net-revenue metric",()=>{
 const prepared=prepareDashboardRows([
  {Sales:120,"Order ID":"A-1"},
  {Sales:230,"Order ID":"A-2"}
 ]);
 const result=understandPreparedDataset(prepared);
 assert.equal(result.fields.find(field=>field.sourceName==="Sales")?.businessConcept,"REVENUE");
 assert.equal(result.confirmedMappings.some(mapping=>mapping.sourceField==="Sales"),false);
});

test("safe prepared rules satisfy analysis schema without turning dates into text",()=>{
 const prepared=prepareDashboardRows([
  {"Order ID":"A-1","Customer ID":"C-1","Order Date":"2026-01-05","Quantity":2},
  {"Order ID":"A-2","Customer ID":"C-2","Order Date":"2026-01-06","Quantity":3}
 ]);
 const mappings=understandPreparedDataset(prepared).confirmedMappings;
 const rules=safeObservedRecordRules("v1",prepared,mappings);
 assert.ok(rules);
 const parsed=analysisConfirmationSchema.safeParse({confirmedMappings:mappings,metricRules:rules});
 assert.equal(parsed.success,true);
 if(!parsed.success)return;
 const keepText=retainedTextFields(parsed.data);
 assert.ok(keepText.includes("Order ID"));
 assert.ok(keepText.includes("Customer ID"));
 assert.ok(!keepText.includes("Order Date"));
});
