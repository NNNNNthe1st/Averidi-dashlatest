import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareDashboardFile} from "../src/engines/ingestion/ingest";
import {analysisConfirmationSchema,analyzeDashboardData,retainedTextFields} from "../src/engines/analysis/pipeline";
import {recommendDashboardTemplates,generateDashboardConfig,addDashboardWidget} from "../src/engines/generation/dashboard-templates";
import {buildDashboardWidgets} from "../src/engines/visualization/widgets";
import {definitionSchema} from "../src/features/views/validation";

const rules={versionId:"ops-v1",grain:"RECORD",currency:null,currencyMode:"UNSPECIFIED",revenueBasis:"UNKNOWN",costBasis:"UNKNOWN",
 refundsIncluded:null,discountsIncluded:null,taxIncluded:null,shippingIncluded:null,cancellationTreatment:"ALREADY_EXCLUDED",
 returnTreatment:"ALREADY_NETTED",operationsPeriodConfirmed:true,operationsHoursBasisConfirmed:true,
 operationsCycleTimeBasisConfirmed:true,operationsErrorsAreDefectiveUnits:true};
const mappings=[
 ["department","CATEGORY"],["completed","OPERATIONS_COMPLETED"],["hours","OPERATIONS_HOURS"],
 ["cycle","OPERATIONS_CYCLE_HOURS"],["errors","OPERATIONS_ERRORS"],["inspected","OPERATIONS_INSPECTED"]
].map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept}));
const csv="department,completed,hours,cycle,errors,inspected\nPacking,10,5,30,2,20\nDelivery,20,10,40,1,30\n";
async function calculate(overrides:Record<string,unknown>={},source=csv){
 const confirmation=analysisConfirmationSchema.parse({confirmedMappings:mappings,metricRules:{...rules,...overrides}});
 const prepared=await prepareDashboardFile({bytes:Buffer.from(source),fileName:"ops.csv",preserveTextFields:retainedTextFields(confirmation)});
 return {confirmation,prepared,analysis:analyzeDashboardData(prepared,"ops-v1",confirmation)};
}
test("1.3 computes six governed operations KPIs and enables only confirmed operations template",async()=>{
 const {analysis}=await calculate();
 const m=Object.fromEntries(analysis.outcomes.map(o=>[o.key,o]));
 assert.equal(analysis.quality.status,"PASS");
 assert.equal(m.OPERATIONS_COMPLETED_TOTAL.value,30);
 assert.equal(m.OPERATIONS_LABOR_HOURS.value,15);
 assert.equal(m.OPERATIONS_PRODUCTIVITY.value,2);
 assert.equal(m.OPERATIONS_AVG_CYCLE_HOURS.value,70/30);
 assert.equal(m.OPERATIONS_ERRORS_TOTAL.value,3);
 assert.equal(m.OPERATIONS_DEFECT_RATE.value,3/50);
 assert.deepEqual(m.OPERATIONS_PRODUCTIVITY.lineage.fields,["completed","hours"]);
 assert.equal(recommendDashboardTemplates(analysis.outcomes).find(x=>x.key==="OPERATIONS")?.available,true);
 assert.equal(definitionSchema.safeParse(generateDashboardConfig("OPERATIONS",analysis.outcomes)).success,true);
});
test("operations breakdown recalculates productivity by department",async()=>{
 const {analysis,confirmation,prepared}=await calculate();
 const dashboard=addDashboardWidget(generateDashboardConfig("OPERATIONS",analysis.outcomes),"OPERATIONS_PRODUCTIVITY","BAR","department",analysis.outcomes,["department"]);
 const widgets=buildDashboardWidgets(dashboard,prepared,"ops-v1",confirmation,{filters:[],compare:false});
 assert.deepEqual(widgets.widgets.at(-1)?.series.map(x=>[x.label,x.value]),[["Delivery",2],["Packing",2]]);
});
test("unconfirmed or missing operational periods and cycle basis fail closed",async()=>{
 const unknown=await calculate({operationsPeriodConfirmed:false});
 assert.equal(unknown.analysis.outcomes.find(x=>x.key==="OPERATIONS_COMPLETED_TOTAL")?.status,"NEEDS_CONFIRMATION");
 assert.equal(recommendDashboardTemplates(unknown.analysis.outcomes).find(x=>x.key==="OPERATIONS")?.available,false);
 const cycle=await calculate({operationsCycleTimeBasisConfirmed:false});
 assert.equal(cycle.analysis.outcomes.find(x=>x.key==="OPERATIONS_AVG_CYCLE_HOURS")?.status,"NEEDS_CONFIRMATION");
 const labor=await calculate({operationsHoursBasisConfirmed:false});
 assert.equal(labor.analysis.outcomes.find(x=>x.key==="OPERATIONS_PRODUCTIVITY")?.status,"NEEDS_CONFIRMATION");
});
test("zero denominators, defective unit scope and contradictions never fabricate rates",async()=>{
 const zero=await calculate({},"department,completed,hours,cycle,errors,inspected\nPacking,0,0,0,0,0\n");
 assert.equal(zero.analysis.outcomes.find(x=>x.key==="OPERATIONS_PRODUCTIVITY")?.status,"UNAVAILABLE");
 assert.equal(zero.analysis.outcomes.find(x=>x.key==="OPERATIONS_AVG_CYCLE_HOURS")?.status,"UNAVAILABLE");
 assert.equal(zero.analysis.outcomes.find(x=>x.key==="OPERATIONS_DEFECT_RATE")?.status,"UNAVAILABLE");
 const wrong=await calculate({operationsErrorsAreDefectiveUnits:false});
 assert.equal(wrong.analysis.outcomes.find(x=>x.key==="OPERATIONS_DEFECT_RATE")?.status,"NEEDS_CONFIRMATION");
 const contradiction=await calculate({},"department,completed,hours,cycle,errors,inspected\nPacking,1,1,1,5,4\n");
 assert.equal(contradiction.analysis.outcomes.find(x=>x.key==="OPERATIONS_DEFECT_RATE")?.status,"UNAVAILABLE");
});
test("negative and fractional counts and ambiguous confirmed fields are rejected",async()=>{
 const bad=await calculate({},"department,completed,hours,cycle,errors,inspected\nPacking,1.5,3,6,-1,4\n");
 assert.equal(bad.analysis.outcomes.find(x=>x.key==="OPERATIONS_COMPLETED_TOTAL")?.status,"UNAVAILABLE");
 assert.equal(bad.analysis.outcomes.find(x=>x.key==="OPERATIONS_ERRORS_TOTAL")?.status,"UNAVAILABLE");
 const {analysis}=await calculate();
 assert.equal(analysis.outcomes.filter(x=>["REVENUE","COST","PROFIT","GROSS_MARGIN","ORDERS","CUSTOMERS","UNITS","AVERAGE_ORDER_VALUE","AVERAGE_UNIT_PRICE"].includes(x.key)).length,9);
});
