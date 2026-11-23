import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldConfirmationSchema, validateFieldConfirmations } from "../src/features/datasets/field-confirmation";

const valid={versionId:"dataset-version-1",mappings:[
  {sourceField:"net_sales",canonicalConcept:"REVENUE"},
  {sourceField:"order_id",canonicalConcept:"ORDER"},
]};

test("accepts explicit field choices only from profiled source fields",()=>{
  assert.deepEqual(validateFieldConfirmations(valid,["net_sales","order_id"]),valid);
  assert.equal(validateFieldConfirmations(valid,["net_sales"]),null);
});

test("rejects duplicate mappings and unknown concepts",()=>{
  assert.equal(fieldConfirmationSchema.safeParse({...valid,mappings:[valid.mappings[0],valid.mappings[0]]}).success,false);
  assert.equal(fieldConfirmationSchema.safeParse({...valid,mappings:[{sourceField:"net_sales",canonicalConcept:"AUTOMATIC"}]}).success,false);
});

test("rejects empty versions, empty mapping sets, and unrecognized request fields",()=>{
  assert.equal(fieldConfirmationSchema.safeParse({...valid,versionId:""}).success,false);
  assert.equal(fieldConfirmationSchema.safeParse({...valid,mappings:[]}).success,false);
  assert.equal(fieldConfirmationSchema.safeParse({...valid,confirmed:true}).success,false);
});

test("does not permit the client to choose confirmation status or numeric values",()=>{
  assert.equal(fieldConfirmationSchema.safeParse({...valid,mappings:[{...valid.mappings[0],status:"AUTO_CONFIRMED"}]}).success,false);
  assert.equal(fieldConfirmationSchema.safeParse({...valid,mappings:[{...valid.mappings[0],value:100}]}).success,false);
});
