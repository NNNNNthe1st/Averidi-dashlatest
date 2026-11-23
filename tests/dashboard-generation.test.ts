import {aggregateSalesTrend} from "../src/components/studio/sales-trend-cadence";
import {SALES_EXTENDED_DEFINITIONS} from "../src/engines/metrics/sales-extended-metrics";
import {definitionSchema} from "../src/features/views/validation";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_TEMPLATES, generateDashboardConfig, recommendDashboardTemplates, addDashboardWidget } from "../src/engines/generation/dashboard-templates";
import { METRIC_DEFINITIONS, type MetricOutcome } from "../src/engines/metrics/metric-engine";

function ready(key: MetricOutcome["key"]): MetricOutcome {
  const definition = METRIC_DEFINITIONS.find(x => x.key === key)!;
  return { key, status: "READY", value: 100, reason: null, definition, lineage: {
    datasetVersionId: "v1", fields: ["confirmed-value"], rowCount: 2, period: null, currency: "USD",
  } };
}

test("templates retain core dashboard families", () => {
  const keys = new Set(DASHBOARD_TEMPLATES.map(x => x.key));
  for (const key of ["SALES", "EXECUTIVE", "CUSTOMER", "FINANCIAL", "PRODUCT", "MARKETING", "OPERATIONS", "INVENTORY", "CUSTOM"]) {
    assert.ok(keys.has(key as typeof DASHBOARD_TEMPLATES[number]["key"]));
  }
});

test("unknown and unsupported dashboard templates fail closed", () => {
  assert.throws(() => generateDashboardConfig("BOGUS" as "CUSTOM", []));
  assert.throws(() => generateDashboardConfig("FINANCIAL", []));
});

test("custom template uses confirmed available metrics only", () => {
  const metrics = [ready("REVENUE"), ready("ORDERS")];
  const suggestions = recommendDashboardTemplates(metrics);
  assert.ok(suggestions.some(x => x.key === "CUSTOM" && x.available));
  const config = generateDashboardConfig("CUSTOM", metrics);
  assert.equal(config.schemaVersion, 1);
  assert.deepEqual(config.widgets.map(x => x.metricKey), ["REVENUE", "ORDERS"]);
});


test("unconfirmed metric outcomes never enable dashboard templates", () => {
  const outcomes = [{...ready("REVENUE"), status: "NEEDS_CONFIRMATION" as const, value: null, reason: "Revenue definition requires confirmation."}];
  const suggestions = recommendDashboardTemplates(outcomes);
  assert.ok(suggestions.every(suggestion => !suggestion.available));
  for (const template of DASHBOARD_TEMPLATES) {
    assert.throws(() => generateDashboardConfig(template.key, outcomes));
  }
});

test("specialized templates remain unavailable without confirmed domain readiness", () => {
  const outcomes = [ready("REVENUE"), ready("ORDERS"), ready("CUSTOMERS"), ready("UNITS")];
  const suggestions = recommendDashboardTemplates(outcomes);
  for (const key of ["MARKETING", "OPERATIONS", "INVENTORY"] as const) {
    const suggestion = suggestions.find(item => item.key === key);
    assert.equal(suggestion?.available, false);
    assert.match(suggestion?.reason ?? "", /domain-specific metrics/);
    assert.throws(() => generateDashboardConfig(key, outcomes));
  }
});


test("templates reject ready-labelled metrics without finite values or source lineage", () => {
  const valid = ready("REVENUE");
  const invalid: MetricOutcome[] = [
    {...valid, value: null},
    {...valid, value: Number.NaN},
    {...valid, value: Number.POSITIVE_INFINITY},
    {...valid, lineage: {...valid.lineage, datasetVersionId: ""}},
    {...valid, lineage: {...valid.lineage, rowCount: 0}},
  ];
  for (const metric of invalid) {
    assert.ok(recommendDashboardTemplates([metric]).every(template => !template.available));
    assert.throws(() => generateDashboardConfig("CUSTOM", [metric]));
  }
});


test("Sales dashboard defaults to the six executive KPIs but permits confirmed advanced widgets", () => {
 const extended=SALES_EXTENDED_DEFINITIONS.slice(0,3).map(definition=>({
  ...ready("REVENUE"),key:definition.key,definition,
 }));
 const metrics=[ready("REVENUE"),ready("ORDERS"),...extended];
 const config=generateDashboardConfig("SALES",metrics);
 assert.deepEqual(config.widgets.map(widget=>widget.metricKey),["REVENUE","ORDERS"]);
 assert.equal(definitionSchema.safeParse(config).success,true);
 const withExtended=addDashboardWidget(config,extended[0].key,"KPI",undefined,metrics,[]);
 assert.equal(withExtended.widgets.at(-1)?.metricKey,extended[0].key);
 const executive=generateDashboardConfig("EXECUTIVE",metrics);
 assert.deepEqual(executive.widgets.map(widget=>widget.metricKey),["REVENUE","ORDERS"]);
});
test("Sales dashboard does not include unconfirmed extended metrics or exceed widget limit", () => {
 const metrics=SALES_EXTENDED_DEFINITIONS.map(definition=>({...ready("REVENUE"),key:definition.key,definition}));
 metrics.push(ready("REVENUE"),ready("ORDERS"));
 const config=generateDashboardConfig("SALES",metrics);
 assert.deepEqual(config.widgets.map(widget=>widget.metricKey),["REVENUE","ORDERS"]);
 assert.ok(config.widgets.length<=30);
 assert.equal(definitionSchema.safeParse(config).success,true);
 const oneUnconfirmed={...metrics[0],status:"NEEDS_CONFIRMATION" as const,value:null};
 const filtered=generateDashboardConfig("SALES",[ready("REVENUE"),oneUnconfirmed]);
 assert.equal(filtered.widgets.some(w=>w.metricKey===oneUnconfirmed.key),false);
 assert.throws(()=>addDashboardWidget(filtered,oneUnconfirmed.key,"KPI",undefined,[oneUnconfirmed],[]));
});

test("Sales dashboard prioritizes the approved six executive KPIs without changing other templates", () => {
 const metrics=[ready("ORDERS"),ready("REVENUE"),ready("CUSTOMERS"),ready("PROFIT"),ready("GROSS_MARGIN"),ready("AVERAGE_ORDER_VALUE")];
 const sales=generateDashboardConfig("SALES",metrics);
 assert.deepEqual(sales.widgets.map(widget=>widget.metricKey),["REVENUE","PROFIT","GROSS_MARGIN","ORDERS","CUSTOMERS","AVERAGE_ORDER_VALUE"]);
 assert.ok(sales.widgets.every(widget=>widget.kind==="KPI"));
 assert.equal(definitionSchema.safeParse(sales).success,true);
 const withoutFinance=generateDashboardConfig("SALES",[ready("ORDERS"),ready("CUSTOMERS")]);
 assert.deepEqual(withoutFinance.widgets.map(widget=>widget.metricKey),["ORDERS","CUSTOMERS"]);
 const executive=generateDashboardConfig("EXECUTIVE",metrics);
 assert.deepEqual(executive.widgets.map(widget=>widget.metricKey),["REVENUE","ORDERS","CUSTOMERS","PROFIT","GROSS_MARGIN"]);
});

test("Sales category chart requires a confirmed category and ready governed revenue", () => {
 const confirmed=[{field:"Category",concept:"CATEGORY",role:"DIMENSION" as const}];
 const sales=generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,confirmed);
 const chart=sales.widgets.find(w=>w.id==="sales-revenue-category");
 assert.deepEqual(chart,{id:"sales-revenue-category",kind:"DONUT",metricKey:"REVENUE",title:"Sales by Category",visible:true,order:2,dimensionField:"Category"});
 assert.equal(definitionSchema.safeParse(sales).success,true);
 assert.equal(generateDashboardConfig("SALES",[ready("ORDERS")],undefined,false,false,false,confirmed).widgets.some(w=>w.kind!=="KPI"),false);
 assert.equal(generateDashboardConfig("SALES",[ready("REVENUE")],undefined,false,false,false,[{field:"Category",concept:"UNKNOWN",role:"DIMENSION"}]).widgets.some(w=>w.kind!=="KPI"),false);
 assert.equal(generateDashboardConfig("EXECUTIVE",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,confirmed).widgets.some(w=>w.kind!=="KPI"),false);
});

test("Sales and Profit Trend uses confirmed date and two READY monetary metrics",()=>{
 const dimensions=[{field:"Order Date",concept:"TIME",role:"DATE" as const}];
 const metrics=[ready("REVENUE"),ready("PROFIT"),ready("ORDERS")];
 const sales=generateDashboardConfig("SALES",metrics,undefined,false,false,false,dimensions);
 const trend=sales.widgets.find(widget=>widget.id==="sales-profit-trend");
 assert.deepEqual(trend,{id:"sales-profit-trend",kind:"SALES_TREND",metricKey:"REVENUE",secondaryMetricKey:"PROFIT",title:"Sales and Profit Trend",visible:true,order:3,dimensionField:"Order Date"});
 assert.equal(definitionSchema.safeParse(sales).success,true);
 assert.equal(generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,dimensions).widgets.some(w=>w.kind==="SALES_TREND"),false);
 assert.equal(generateDashboardConfig("SALES",metrics).widgets.some(w=>w.kind==="SALES_TREND"),false);
 assert.equal(generateDashboardConfig("EXECUTIVE",metrics,undefined,false,false,false,dimensions).widgets.some(w=>w.kind==="SALES_TREND"),false);
});

test("Sales filter options use only confirmed region category and segment mappings",async()=>{
 const {salesFilterOptions}=await import("../src/engines/visualization/widgets");
 const rows=[{"Region":"West","Category":"Furniture","Segment":"Consumer","Private":"secret"},{"Region":"East","Category":"Technology","Segment":"Corporate","Private":"secret"},{"Region":"West","Category":"Furniture","Segment":"Consumer","Private":"secret"}];
 const dims=[{field:"Region",concept:"GEOGRAPHY",role:"DIMENSION" as const},{field:"Category",concept:"CATEGORY",role:"DIMENSION" as const},{field:"Segment",concept:"CUSTOMER_SEGMENT",role:"DIMENSION" as const}];
 const options=salesFilterOptions(rows,dims);
 assert.deepEqual(options,{GEOGRAPHY:["East","West"],CATEGORY:["Furniture","Technology"],CUSTOMER_SEGMENT:["Consumer","Corporate"]});
 assert.deepEqual(salesFilterOptions(rows,dims.filter(d=>d.concept!=="GEOGRAPHY")).GEOGRAPHY,[]);
});

test("Sales top five subcategories uses confirmed mapping and ready revenue", () => {
 const confirmed=[{field:"Sub-Category",concept:"SUBCATEGORY",role:"DIMENSION" as const}];
 const sales=generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,confirmed);
 const chart=sales.widgets.find(w=>w.id==="sales-top-subcategories");
 assert.equal(chart?.kind,"HORIZONTAL_BAR");
 assert.equal(chart?.dimensionField,"Sub-Category");
 assert.equal(chart?.metricKey,"REVENUE");
 assert.equal(definitionSchema.safeParse(sales).success,true);
 const missingRevenue=generateDashboardConfig("SALES",[ready("ORDERS")],undefined,false,false,false,confirmed);
 assert.equal(missingRevenue.widgets.some(w=>w.id==="sales-top-subcategories"),false);
 const executive=generateDashboardConfig("EXECUTIVE",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,confirmed);
 assert.equal(executive.widgets.some(w=>w.id==="sales-top-subcategories"),false);
});

test("Sales segment performance requires confirmed segment and revenue",()=>{
 const segment=[{field:"Segment",concept:"CUSTOMER_SEGMENT",role:"DIMENSION" as const}];
 const dashboard=generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,segment);
 const widget=dashboard.widgets.find(item=>item.id==="sales-segment-performance");
 assert.equal(widget?.kind,"TABLE");
 assert.equal(widget?.dimensionField,"Segment");
 assert.equal(widget?.metricKey,"REVENUE");
 assert.equal(definitionSchema.safeParse(dashboard).success,true);
 assert.equal(generateDashboardConfig("SALES",[ready("ORDERS")],undefined,false,false,false,segment).widgets.some(item=>item.id==="sales-segment-performance"),false);
 assert.equal(generateDashboardConfig("EXECUTIVE",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,segment).widgets.some(item=>item.id==="sales-segment-performance"),false);
});

test("Sales top customers and products use confirmed dimensions and governed metrics",()=>{
 const confirmed=[
  {field:"Customer ID",concept:"CUSTOMER",role:"DIMENSION" as const},
  {field:"Product ID",concept:"PRODUCT",role:"DIMENSION" as const},
 ];
 const metrics=[ready("REVENUE"),ready("PROFIT"),ready("ORDERS")];
 const dashboard=generateDashboardConfig("SALES",metrics,undefined,false,false,false,confirmed);
 assert.deepEqual(dashboard.widgets.filter(w=>w.id==="sales-top-customers"||w.id==="sales-top-products").map(w=>[w.id,w.metricKey,w.dimensionField]),[
  ["sales-top-customers","REVENUE","Customer ID"],
  ["sales-top-products","PROFIT","Product ID"],
 ]);
 assert.equal(definitionSchema.safeParse(dashboard).success,true);
 const noProfit=generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,confirmed);
 assert.equal(noProfit.widgets.some(w=>w.id==="sales-top-products"),false);
 const executive=generateDashboardConfig("EXECUTIVE",metrics,undefined,false,false,false,confirmed);
 assert.equal(executive.widgets.some(w=>w.id==="sales-top-customers"||w.id==="sales-top-products"),false);
});

test("Sales region map uses confirmed geography and ready revenue",()=>{
 const geography=[{field:"State",concept:"GEOGRAPHY",role:"DIMENSION" as const}];
 const dashboard=generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,geography);
 const map=dashboard.widgets.find(item=>item.id==="sales-region-map");
 assert.equal(map?.kind,"BAR");
 assert.equal(map?.metricKey,"REVENUE");
 assert.equal(map?.dimensionField,"State");
 assert.equal(definitionSchema.safeParse(dashboard).success,true);
 assert.equal(generateDashboardConfig("SALES",[ready("ORDERS")],undefined,false,false,false,geography).widgets.some(item=>item.id==="sales-region-map"),false);
 assert.equal(generateDashboardConfig("EXECUTIVE",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,geography).widgets.some(item=>item.id==="sales-region-map"),false);
});

test("Sales date heatmap requires ready revenue and confirmed time",()=>{
 const time=[{field:"Order Date",concept:"TIME",role:"DATE" as const}];
 const sales=generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")],undefined,false,false,false,time);
 const heatmap=sales.widgets.find(w=>w.id==="sales-order-date-heatmap");
 assert.equal(heatmap?.kind,"TABLE");
 assert.equal(heatmap?.metricKey,"REVENUE");
 assert.equal(heatmap?.dimensionField,"Order Date");
 assert.equal(definitionSchema.safeParse(sales).success,true);
 const noRevenue=generateDashboardConfig("SALES",[ready("ORDERS")],undefined,false,false,false,time);
 assert.equal(noRevenue.widgets.some(w=>w.id==="sales-order-date-heatmap"),false);
 const noTime=generateDashboardConfig("SALES",[ready("REVENUE"),ready("ORDERS")]);
 assert.equal(noTime.widgets.some(w=>w.id==="sales-order-date-heatmap"),false);
});

test("Sales executive labels match approved reference without changing metric bindings",()=>{
 const dashboard=generateDashboardConfig("SALES",(["REVENUE","PROFIT","GROSS_MARGIN","ORDERS","CUSTOMERS","AVERAGE_ORDER_VALUE"] as MetricOutcome["key"][]).map(ready));
 assert.deepEqual(dashboard.widgets.filter(w=>w.kind==="KPI").map(w=>[w.metricKey,w.title]),[
  ["REVENUE","Total Sales"],["PROFIT","Profit"],["GROSS_MARGIN","Profit Margin"],["ORDERS","Orders"],["CUSTOMERS","Customers"],["AVERAGE_ORDER_VALUE","Average Order Value"],
 ]);
 assert.equal(definitionSchema.safeParse(dashboard).success,true);
});

test("Sales analytical panels retain reference ordering with every confirmed dimension",()=>{
 const dimensions=[
  {field:"Order Date",concept:"TIME",role:"DATE" as const},
  {field:"Category",concept:"CATEGORY",role:"DIMENSION" as const},
  {field:"Sub-Category",concept:"SUBCATEGORY",role:"DIMENSION" as const},
  {field:"Region",concept:"GEOGRAPHY",role:"DIMENSION" as const},
  {field:"Segment",concept:"CUSTOMER_SEGMENT",role:"DIMENSION" as const},
  {field:"Customer",concept:"CUSTOMER",role:"DIMENSION" as const},
  {field:"Product",concept:"PRODUCT",role:"DIMENSION" as const},
 ];
 const config=generateDashboardConfig("SALES",(["REVENUE","PROFIT","GROSS_MARGIN","ORDERS","CUSTOMERS","AVERAGE_ORDER_VALUE"] as MetricOutcome["key"][]).map(ready),undefined,false,false,false,dimensions);
 assert.deepEqual(config.widgets.map(w=>w.id),[
  "metric-revenue","metric-profit","metric-gross_margin","metric-orders","metric-customers","metric-average_order_value",
  "sales-profit-trend","sales-revenue-category","sales-top-subcategories","sales-region-map",
  "sales-segment-performance","sales-order-date-heatmap","sales-top-customers","sales-top-products",
 ]);
 assert.deepEqual(config.widgets.map(w=>w.order),config.widgets.map((_,index)=>index));
 assert.equal(definitionSchema.safeParse(config).success,true);
});

test("Sales cadence correctly sums confirmed monthly sales and profit into quarters and years",()=>{
 const points=[{label:"2022-01",value:10,secondaryValue:2},{label:"2022-02",value:20,secondaryValue:5},{label:"2022-04",value:7,secondaryValue:3}];
 assert.deepEqual(aggregateSalesTrend(points,"QUARTERLY"),[
  {label:"2022 Q1",value:30,secondaryValue:7},
  {label:"2022 Q2",value:7,secondaryValue:3}
 ]);
 assert.deepEqual(aggregateSalesTrend(points,"YEARLY"),[{label:"2022",value:37,secondaryValue:10}]);
 assert.deepEqual(aggregateSalesTrend(points,"MONTHLY"),points);
});
test("Sales cadence never fabricates a missing profit value",()=>{
 const rows=[{label:"2022-01",value:100,secondaryValue:null},{label:"2022-02",value:50,secondaryValue:8}];
 assert.deepEqual(aggregateSalesTrend(rows,"QUARTERLY"),[{label:"2022 Q1",value:150,secondaryValue:null}]);
 assert.throws(()=>aggregateSalesTrend([{label:"invalid",value:10,secondaryValue:2}],"QUARTERLY"));
});
