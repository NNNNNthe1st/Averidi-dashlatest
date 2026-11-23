import { test } from "node:test";
import assert from "node:assert/strict";
import { metricRulesSchema,metricRulesToEngineSemantics } from "../src/features/datasets/metric-rules";

const valid={
 versionId:"version-1",grain:"ORDER",currency:"USD",currencyMode:"SINGLE",
 revenueBasis:"NET",costBasis:"COGS",refundsIncluded:true,discountsIncluded:true,
 taxIncluded:false,shippingIncluded:false,cancellationTreatment:"ALREADY_EXCLUDED",
 returnTreatment:"ALREADY_NETTED",
};

test("explicit business-rule choices match the governed metric engine",()=>{
 const result=metricRulesSchema.parse(valid);
 assert.equal(result.grain,"ORDER");
 assert.equal(metricRulesToEngineSemantics(result).revenueBasis,"NET");
 assert.equal(metricRulesToEngineSemantics(result).costBasis,"COGS");
});
test("currency decisions cannot imply a single currency without its code",()=>{
 assert.equal(metricRulesSchema.safeParse({...valid,currency:null}).success,false);
 assert.equal(metricRulesSchema.safeParse({...valid,currencyMode:"MULTI"}).success,false);
 assert.equal(metricRulesSchema.safeParse({...valid,currency:"US dollars"}).success,false);
});
test("business rules reject fabricated statuses and implicit confirmations",()=>{
 assert.equal(metricRulesSchema.safeParse({...valid,grain:"INFERRED"}).success,false);
 assert.equal(metricRulesSchema.safeParse({...valid,revenueBasis:"PROBABLY_NET"}).success,false);
 assert.equal(metricRulesSchema.safeParse({...valid,qualityStatus:"PASS"}).success,false);
 assert.equal(metricRulesSchema.safeParse({...valid,versionId:""}).success,false);
});
