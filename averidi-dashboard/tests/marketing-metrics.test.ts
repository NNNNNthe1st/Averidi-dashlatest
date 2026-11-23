import {buildDashboardWidgets} from "../src/engines/visualization/widgets";
import {addDashboardWidget} from "../src/engines/generation/dashboard-templates";
import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareDashboardFile} from "../src/engines/ingestion/ingest";
import {analyzeDashboardData,analysisConfirmationSchema,retainedTextFields} from "../src/engines/analysis/pipeline";
import {recommendDashboardTemplates,generateDashboardConfig} from "../src/engines/generation/dashboard-templates";
import {metricRulesSchema} from "../src/features/datasets/metric-rules";

const confirmed={
 confirmedMappings:[
  {sourceField:"campaign",canonicalConcept:"CHANNEL"},
  {sourceField:"spend",canonicalConcept:"MARKETING_SPEND"},
  {sourceField:"leads",canonicalConcept:"MARKETING_LEADS"},
  {sourceField:"conversions",canonicalConcept:"MARKETING_CONVERSIONS"},
  {sourceField:"attributed",canonicalConcept:"ATTRIBUTED_REVENUE"},
 ],
 metricRules:{
  versionId:"marketing-v1",grain:"RECORD",currency:"USD",currencyMode:"SINGLE",
  revenueBasis:"UNKNOWN",costBasis:"UNKNOWN",refundsIncluded:null,discountsIncluded:null,
  taxIncluded:null,shippingIncluded:null,cancellationTreatment:"ALREADY_EXCLUDED",
  returnTreatment:"ALREADY_NETTED",marketingAttribution:"SOURCE_REPORTED",
  marketingSpendDeduplicated:true,timezone:"America/New_York",
 }
};
const csv="campaign,spend,leads,conversions,attributed\nSearch,100,20,4,400\nSocial,50,10,2,100\n";
async function run(payload:unknown=confirmed,data=csv){
 const c=analysisConfirmationSchema.parse(payload);
 const rows=await prepareDashboardFile({bytes:Buffer.from(data),fileName:"marketing.csv",preserveTextFields:retainedTextFields(c)});
 return analyzeDashboardData(rows,"marketing-v1",c);
}
test("1.1 calculates reported spend, conversions, conversion rate, ROAS and revenue-based ROI",async()=>{
 const result=await run();assert.equal(result.quality.status,"PASS");
 const outcomes=Object.fromEntries(result.outcomes.map(x=>[x.key,x]));
 assert.equal(outcomes.MARKETING_SPEND.value,150);
 assert.equal(outcomes.ATTRIBUTED_CONVERSIONS.value,6);
 assert.equal(outcomes.ATTRIBUTED_REVENUE.value,500);
 assert.equal(outcomes.MARKETING_CONVERSION_RATE.value,.2);
 assert.equal(outcomes.MARKETING_ROAS.value,500/150);
 assert.equal(outcomes.MARKETING_ROI.value,(500-150)/150);
 assert.deepEqual(outcomes.MARKETING_ROI.lineage.fields,["attributed","spend"]);
 assert.ok(outcomes.MARKETING_ROI.lineage.definitionVersion);
 assert.equal(outcomes.REVENUE.status,"NEEDS_CONFIRMATION");
 assert.equal(recommendDashboardTemplates(result.outcomes).find(t=>t.key==="MARKETING")?.available,true);
 const config=generateDashboardConfig("MARKETING",result.outcomes);
 assert.ok(config.widgets.some(w=>w.metricKey==="MARKETING_ROI"));
});
test("marketing does not infer attribution from data or field names",async()=>{
 const c=structuredClone(confirmed);c.metricRules.marketingAttribution="UNCONFIRMED";
 const outcomes=(await run(c)).outcomes;
 assert.equal(outcomes.find(m=>m.key==="MARKETING_ROI")?.status,"NEEDS_CONFIRMATION");
 assert.equal(outcomes.find(m=>m.key==="ATTRIBUTED_CONVERSIONS")?.status,"NEEDS_CONFIRMATION");
 assert.equal(recommendDashboardTemplates(outcomes).find(t=>t.key==="MARKETING")?.available,false);
});
test("unknown duplicate spend, missing currency and zero denominator do not fabricate ROI",async()=>{
 const duplicate=structuredClone(confirmed);duplicate.metricRules.marketingSpendDeduplicated=false;
 assert.equal((await run(duplicate)).outcomes.find(m=>m.key==="MARKETING_ROI")?.status,"NEEDS_CONFIRMATION");
 const currency={...structuredClone(confirmed),metricRules:{...confirmed.metricRules,currency:null,currencyMode:"UNSPECIFIED"}};
 assert.equal((await run(currency)).outcomes.find(m=>m.key==="MARKETING_ROI")?.status,"NEEDS_CONFIRMATION");
 const zero=(await run(confirmed,"campaign,spend,leads,conversions,attributed\nSearch,0,10,2,100\n"));
 assert.equal(zero.outcomes.find(m=>m.key==="MARKETING_ROI")?.status,"UNAVAILABLE");
});
test("invalid attribution, integer counts and impossible lead attribution fail closed",async()=>{
 assert.equal(metricRulesSchema.safeParse({...confirmed.metricRules,marketingAttribution:"INFER_FROM_CHANNEL"}).success,false);
 const impossible=await run(confirmed,"campaign,spend,leads,conversions,attributed\nSearch,10,2,3,100\n");
 assert.equal(impossible.outcomes.find(m=>m.key==="MARKETING_CONVERSION_RATE")?.status,"UNAVAILABLE");
 const fractional=await run(confirmed,"campaign,spend,leads,conversions,attributed\nSearch,10,10,2.5,100\n");
 assert.equal(fractional.outcomes.find(m=>m.key==="ATTRIBUTED_CONVERSIONS")?.status,"UNAVAILABLE");
});
test("legacy confirmations retain original business metric results",async()=>{
 const legacy={...confirmed,metricRules:{...confirmed.metricRules,marketingAttribution:undefined,marketingSpendDeduplicated:undefined}};
 const result=await run(legacy);
 assert.equal(result.outcomes.find(m=>m.key==="MARKETING_ROI")?.status,"NEEDS_CONFIRMATION");
 assert.equal(result.outcomes.filter(m=>["REVENUE","COST","PROFIT","GROSS_MARGIN","ORDERS","CUSTOMERS","UNITS","AVERAGE_ORDER_VALUE","AVERAGE_UNIT_PRICE"].includes(m.key)).length,9);
});

test("campaign grouping calculates separate ROI without averaging aggregate ratios",async()=>{
 const c=analysisConfirmationSchema.parse(confirmed);
 const prepared=await prepareDashboardFile({bytes:Buffer.from(csv),fileName:"campaign.csv",preserveTextFields:retainedTextFields(c)});
 const result=analyzeDashboardData(prepared,"marketing-v1",c);
 const view=addDashboardWidget(generateDashboardConfig("MARKETING",result.outcomes),"MARKETING_ROI","BAR","campaign",result.outcomes,["campaign"]);
 const display=buildDashboardWidgets(view,prepared,"marketing-v1",c,{filters:[],compare:false});
 const campaign=display.widgets.at(-1)?.series??[];
 assert.deepEqual(campaign.map(p=>[p.label,p.value]),[["Search",3],["Social",1]]);
});
