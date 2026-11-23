import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareDashboardFile} from "../src/engines/ingestion/ingest";
import {analysisConfirmationSchema,analyzeDashboardData,retainedTextFields} from "../src/engines/analysis/pipeline";
import {generateDashboardConfig,recommendDashboardTemplates,addDashboardWidget} from "../src/engines/generation/dashboard-templates";
import {buildDashboardWidgets} from "../src/engines/visualization/widgets";

const rules={versionId:"inv-v1",grain:"PRODUCT",currency:"USD",currencyMode:"SINGLE",
 revenueBasis:"UNKNOWN",costBasis:"UNKNOWN",refundsIncluded:null,discountsIncluded:null,
 taxIncluded:null,shippingIncluded:null,cancellationTreatment:"ALREADY_EXCLUDED",returnTreatment:"ALREADY_NETTED",
 inventorySnapshotConfirmed:true,inventorySnapshotUniqueProducts:true,inventoryTurnoverPeriodConfirmed:true,
 inventoryDemandPeriodDays:30,inventoryLeadTimeDays:7,inventorySafetyDays:3};
const fields=[
 ["sku","PRODUCT"],["stock","INVENTORY_ON_HAND"],["demand","INVENTORY_DEMAND"],
 ["flag","INVENTORY_STOCKOUT"],["value","INVENTORY_VALUE"],
 ["cost","INVENTORY_COGS"],["average","INVENTORY_AVG_VALUE"]
].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept}));
const csv="sku,stock,demand,flag,value,cost,average\nSKU001,20,120,0,200,150,100\nSKU002,0,30,1,0,60,50\n";
async function calculate(override:Record<string,unknown>={},source=csv){
 const confirmation=analysisConfirmationSchema.parse({confirmedMappings:fields,metricRules:{...rules,...override}});
 const prepared=await prepareDashboardFile({bytes:Buffer.from(source),fileName:"stock.csv",preserveTextFields:retainedTextFields(confirmation)});
 return {confirmation,prepared,analysis:analyzeDashboardData(prepared,"inv-v1",confirmation)};
}
test("1.2 calculates current inventory, stockout, valuation, turnover, demand and reorder gap",async()=>{
 const {analysis}=await calculate();
 const m=Object.fromEntries(analysis.outcomes.map(item=>[item.key,item]));
 assert.equal(analysis.quality.status,"PASS");
 assert.equal(m.INVENTORY_STOCK_ON_HAND.value,20);
 assert.equal(m.INVENTORY_STOCKOUT_PRODUCTS.value,1);
 assert.equal(m.INVENTORY_STOCKOUT_RATE.value,.5);
 assert.equal(m.INVENTORY_VALUE_TOTAL.value,200);
 assert.equal(m.INVENTORY_TURNOVER.value,210/150);
 assert.equal(m.INVENTORY_DEMAND_UNITS.value,150);
 assert.equal(m.INVENTORY_REORDER_GAP.value,30);
 assert.equal(m.INVENTORY_REORDER_PRODUCTS.value,2);
 assert.deepEqual(m.INVENTORY_TURNOVER.lineage.fields,["sku","cost","average"]);
 assert.equal(recommendDashboardTemplates(analysis.outcomes).find(t=>t.key==="INVENTORY")?.available,true);
 const dashboard=generateDashboardConfig("INVENTORY",analysis.outcomes);
 assert.ok(dashboard.widgets.some(item=>item.metricKey==="INVENTORY_STOCK_ON_HAND"));
});
test("inventory stock grouping recalculates by SKU and never sums historical snapshot totals",async()=>{
 const {confirmation,prepared,analysis}=await calculate();
 const dashboard=addDashboardWidget(generateDashboardConfig("INVENTORY",analysis.outcomes),"INVENTORY_STOCK_ON_HAND","BAR","sku",analysis.outcomes,["sku"]);
 const widgets=buildDashboardWidgets(dashboard,prepared,"inv-v1",confirmation,{filters:[],compare:false});
 assert.deepEqual(widgets.widgets.at(-1)?.series.map(x=>[x.label,x.value]),[["SKU001",20],["SKU002",0]]);
});
test("historical or duplicate snapshots refuse instead of double counting",async()=>{
 const a=await calculate({inventorySnapshotConfirmed:false});
 assert.equal(a.analysis.outcomes.find(x=>x.key==="INVENTORY_STOCK_ON_HAND")?.status,"NEEDS_CONFIRMATION");
 const b=await calculate({}, "sku,stock,demand,flag,value,cost,average\nSKU001,20,120,0,200,150,100\nSKU001,10,60,0,100,80,40\n");
 assert.equal(b.analysis.quality.status,"FAIL");
 assert.equal(b.analysis.outcomes.find(x=>x.key==="INVENTORY_STOCK_ON_HAND")?.status,"UNAVAILABLE");
});
test("inventory formulas refuse unknown period, missing valuation and conflicting stockout indicator",async()=>{
 const period=await calculate({inventoryDemandPeriodDays:undefined});
 assert.equal(period.analysis.outcomes.find(x=>x.key==="INVENTORY_REORDER_GAP")?.status,"NEEDS_CONFIRMATION");
 const valuation=await calculate({inventoryTurnoverPeriodConfirmed:false});
 assert.equal(valuation.analysis.outcomes.find(x=>x.key==="INVENTORY_TURNOVER")?.status,"NEEDS_CONFIRMATION");
 const flags=await calculate({}, "sku,stock,demand,flag,value,cost,average\nSKU001,10,30,1,100,20,30\n");
 assert.equal(flags.analysis.outcomes.find(x=>x.key==="INVENTORY_STOCKOUT_RATE")?.status,"UNAVAILABLE");
});
test("invalid negative counts, zero average value and mixed currency fail closed",async()=>{
 const negative=await calculate({}, "sku,stock,demand,flag,value,cost,average\nSKU001,-1,30,0,100,20,30\n");
 assert.equal(negative.analysis.outcomes.find(x=>x.key==="INVENTORY_STOCK_ON_HAND")?.status,"UNAVAILABLE");
 const zero=await calculate({}, "sku,stock,demand,flag,value,cost,average\nSKU001,10,30,0,100,20,0\n");
 assert.equal(zero.analysis.outcomes.find(x=>x.key==="INVENTORY_TURNOVER")?.status,"UNAVAILABLE");
 const mixed=await calculate({currency:null,currencyMode:"MULTI"});
 assert.equal(mixed.analysis.outcomes.find(x=>x.key==="INVENTORY_VALUE_TOTAL")?.status,"NEEDS_CONFIRMATION");
});

test("out-of-range demand and coverage cannot fabricate replenishment totals",async()=>{
 const unsafe=await calculate({},
  "sku,stock,demand,flag,value,cost,average\nSKU001,0,9007199254740992,1,0,10,10\n");
 assert.equal(unsafe.analysis.outcomes.find(x=>x.key==="INVENTORY_REORDER_GAP")?.status,"UNAVAILABLE");
 await assert.rejects(()=>calculate({inventoryDemandPeriodDays:0}));
});
test("saved-view schema accepts governed inventory widgets but rejects invented metric keys",async()=>{
 const {analysis}=await calculate();
 const {definitionSchema}=await import("../src/features/views/validation");
 const view=generateDashboardConfig("INVENTORY",analysis.outcomes);
 assert.equal(definitionSchema.safeParse(view).success,true);
 assert.equal(definitionSchema.safeParse({...view,widgets:[{...view.widgets[0],metricKey:"INVENTORY_IMAGINARY"}]}).success,false);
});
