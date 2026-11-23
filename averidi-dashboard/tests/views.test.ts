import { test } from "node:test";
import assert from "node:assert/strict";
import { definitionSchema, preservesViewMetricBindings } from "../src/features/views/validation";

const valid={schemaVersion:1,template:"CUSTOM",templateVersion:1,name:"Overview",widgets:[
  {id:"widget-1",kind:"KPI",metricKey:"REVENUE",title:"Revenue",visible:true,order:0},
]};
test("view definitions accept a valid confirmed metric widget",()=>{
  assert.equal(definitionSchema.safeParse(valid).success,true);
});
test("view definitions reject duplicated widget positions",()=>{
  const result=definitionSchema.safeParse({...valid,widgets:[valid.widgets[0],{...valid.widgets[0],id:"widget-2"}]});
  assert.equal(result.success,false);
});
test("view definitions reject unknown metrics and template names",()=>{
  assert.equal(definitionSchema.safeParse({...valid,template:"INVALID"}).success,false);
  assert.equal(definitionSchema.safeParse({...valid,widgets:[{...valid.widgets[0],metricKey:"HALLUCINATED"}]}).success,false);
});

test("view definitions reject unknown Studio sections",()=>{
  assert.equal(definitionSchema.safeParse({...valid,sectionTitles:{unknown_panel:"Surprise"}}).success,false);
  assert.equal(definitionSchema.safeParse({...valid,sectionTitles:{metrics:"Core metrics"}}).success,true);
});


test("Studio edits preserve approved source metrics and grouping fields",()=>{
  const renamed={...valid,name:"Updated",widgets:[{...valid.widgets[0],title:"Net revenue",visible:false,order:0}]};
  assert.equal(preservesViewMetricBindings(valid,renamed),true);
  assert.equal(preservesViewMetricBindings(valid,{...renamed,widgets:[{...valid.widgets[0],metricKey:"COST"}]}),false);
  assert.equal(preservesViewMetricBindings(valid,{...renamed,widgets:[...valid.widgets,{...valid.widgets[0],id:"new",order:1}]}),false);
  assert.equal(preservesViewMetricBindings(valid,{...renamed,template:"FINANCIAL"}),false);
  assert.equal(preservesViewMetricBindings(valid,{...renamed,widgets:[{...valid.widgets[0],kind:"LINE"}]}),false);
  assert.equal(preservesViewMetricBindings(valid,{...renamed,widgets:[{...valid.widgets[0],dimensionField:"unverified"}]}),false);
});

test("governed inventory and marketing metrics are valid in persisted dashboard views",()=>{
 const inventory={...valid,template:"INVENTORY",widgets:[
  {...valid.widgets[0],metricKey:"INVENTORY_STOCK_ON_HAND"},
  {...valid.widgets[0],id:"reorder",metricKey:"INVENTORY_REORDER_PRODUCTS",order:1},
 ]};
 const marketing={...valid,template:"MARKETING",widgets:[{...valid.widgets[0],metricKey:"MARKETING_ROI"}]};
 assert.equal(definitionSchema.safeParse(inventory).success,true);
 assert.equal(definitionSchema.safeParse(marketing).success,true);
 assert.equal(definitionSchema.safeParse({...inventory,widgets:[{...valid.widgets[0],metricKey:"UNVERIFIED_INVENTORY"}]}).success,false);
});
