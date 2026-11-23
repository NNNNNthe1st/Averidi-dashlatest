import type {MetricKey,MetricOutcome} from "../metrics/metric-engine";
import {METRIC_DEFINITIONS,SALES_EXTENDED_DEFINITIONS,CUSTOMER_PRODUCT_METRICS,OPERATIONS_METRIC_DEFINITIONS,INVENTORY_METRIC_DEFINITIONS,MARKETING_METRIC_DEFINITIONS} from "../metrics/metric-catalog";
export type DashboardTemplateKey="SALES"|"EXECUTIVE"|"CUSTOMER"|"FINANCIAL"|"PRODUCT"|"MARKETING"|"OPERATIONS"|"INVENTORY"|"CUSTOM";
export type DashboardWidgetKind="KPI"|"BAR"|"LINE"|"TABLE"|"HORIZONTAL_BAR"|"DONUT"|"SALES_TREND";
export type DashboardWidget={id:string;kind:DashboardWidgetKind;metricKey:MetricKey;secondaryMetricKey?:MetricKey;title:string;visible:boolean;order:number;dimensionField?:string};
export const DASHBOARD_SECTION_DEFAULTS={metrics:"Dashboard metrics and charts",inventory:"Inventory performance",operations:"Operations performance",marketing:"Marketing performance",product:"Product performance",customer:"Customer overview"} as const;
export type DashboardSectionKey=keyof typeof DASHBOARD_SECTION_DEFAULTS;
export type DashboardConfig={schemaVersion:1;template:DashboardTemplateKey;templateVersion:number;name:string;sectionTitles?:Partial<Record<DashboardSectionKey,string>>;widgets:DashboardWidget[]};
export const DASHBOARD_TEMPLATES:{key:DashboardTemplateKey;name:string;description:string;primary:MetricKey[];supporting:MetricKey[];minimum:number}[]=[
 {key:"SALES",name:"Sales performance",description:"Revenue, orders and customer activity.",primary:["REVENUE","ORDERS"],supporting:["CUSTOMERS","AVERAGE_ORDER_VALUE","UNITS"],minimum:1},
 {key:"EXECUTIVE",name:"Business overview",description:"A concise summary of the business.",primary:["REVENUE","ORDERS","CUSTOMERS"],supporting:["PROFIT","GROSS_MARGIN","UNITS"],minimum:2},
 {key:"CUSTOMER",name:"Customer overview",description:"Acquisition, repeat purchases, period retention and observed historical customer value.",primary:["CUSTOMERS"],supporting:["NEW_CUSTOMERS","REPEAT_CUSTOMERS","REPEAT_PURCHASE_RATE","RETAINED_CUSTOMERS","CUSTOMER_RETENTION_RATE","OBSERVED_CUSTOMER_VALUE","ORDERS","AVERAGE_ORDER_VALUE"],minimum:1},
 {key:"FINANCIAL",name:"Financial performance",description:"Revenue, cost and profitability where defined.",primary:["REVENUE","COST","PROFIT"],supporting:["GROSS_MARGIN"],minimum:2},
 {key:"PRODUCT",name:"Product performance",description:"Product volume, net revenue, gross profit, margin and contribution.",primary:["UNITS"],supporting:["REVENUE","AVERAGE_UNIT_PRICE","PROFIT","GROSS_MARGIN","PRODUCT_REVENUE_SHARE","PRODUCT_PROFIT_SHARE"],minimum:1},
 {key:"MARKETING",name:"Marketing performance",description:"Supported commercial outcomes; no inferred ad attribution.",primary:["MARKETING_SPEND","ATTRIBUTED_CONVERSIONS","ATTRIBUTED_REVENUE"],supporting:["MARKETING_CONVERSION_RATE","MARKETING_ROAS","MARKETING_ROI"],minimum:1},
 {key:"OPERATIONS",name:"Operations overview",description:"Operational volume from available quantities.",primary:["OPERATIONS_COMPLETED_TOTAL","OPERATIONS_PRODUCTIVITY"],supporting:["OPERATIONS_LABOR_HOURS","OPERATIONS_AVG_CYCLE_HOURS","OPERATIONS_ERRORS_TOTAL","OPERATIONS_DEFECT_RATE"],minimum:1},
 {key:"CUSTOM",name:"Custom dashboard",description:"Start with confirmed metrics, then add approved charts and rearrange the layout.",primary:[],supporting:[],minimum:0},
 {key:"INVENTORY",name:"Inventory overview",description:"Latest stock levels, zero-stock exposure and confirmed product demand.",primary:["INVENTORY_STOCK_ON_HAND","INVENTORY_STOCKOUT_PRODUCTS","INVENTORY_STOCKOUT_RATE"],supporting:["INVENTORY_VALUE_TOTAL","INVENTORY_TURNOVER","INVENTORY_DEMAND_UNITS","INVENTORY_REORDER_PRODUCTS","INVENTORY_REORDER_GAP"],minimum:1},
];
export function confirmedDashboardMetricKeys(metrics:MetricOutcome[]){
 return new Set(metrics.filter(m=>m.status==="READY"&&typeof m.value==="number"&&Number.isFinite(m.value)&&Boolean(m.lineage?.datasetVersionId)&&m.lineage.rowCount>0).map(m=>m.key));
}
export function recommendDashboardTemplates(metrics:MetricOutcome[],marketingReady=false,operationsReady=false,inventoryReady=false){
 const ready=confirmedDashboardMetricKeys(metrics);
 const operationsEligible=ready.has("OPERATIONS_COMPLETED_TOTAL")&&ready.has("OPERATIONS_PRODUCTIVITY");
 const inventoryEligible=ready.has("INVENTORY_STOCK_ON_HAND")&&ready.has("INVENTORY_STOCKOUT_RATE");
 const marketingEligible=ready.has("MARKETING_SPEND")&&ready.has("ATTRIBUTED_REVENUE")&&ready.has("MARKETING_ROI");
 return DASHBOARD_TEMPLATES.map(t=>{
  const supported=t.primary.filter(key=>ready.has(key));
  const specializedGap=(t.key==="INVENTORY"&&!inventoryEligible)||(t.key==="MARKETING"&&!marketingEligible)||(t.key==="OPERATIONS"&&!operationsEligible);
  const available=(t.key==="CUSTOM"?ready.size>0:t.key==="MARKETING"?marketingEligible:t.key==="OPERATIONS"?operationsEligible:t.key==="INVENTORY"?inventoryEligible:supported.length>=t.minimum)&&!specializedGap;
  return {key:t.key,name:t.name,description:t.description,available,supported,missing:t.primary.filter(key=>!ready.has(key)),reason:available?null:specializedGap?"This template requires confirmed domain-specific metrics that are not yet part of the governed catalog.":"The required business metrics are not yet available."};
 });
}
export function generateDashboardConfig(template:DashboardTemplateKey,metrics:MetricOutcome[],name?:string,marketingReady=false,operationsReady=false,inventoryReady=false,confirmedDimensions:readonly {field:string;role:'DATE'|'DIMENSION';concept?:string}[]=[]):DashboardConfig{
 const selected=DASHBOARD_TEMPLATES.find(t=>t.key===template);
 if(!selected)throw new Error("Unknown dashboard template.");
 const recommendation=recommendDashboardTemplates(metrics,marketingReady,operationsReady,inventoryReady).find(r=>r.key===template);
 if(!recommendation?.available)throw new Error("Dashboard template is not compatible with confirmed data.");
 const ready=confirmedDashboardMetricKeys(metrics);
 const definitions=[...METRIC_DEFINITIONS,...SALES_EXTENDED_DEFINITIONS,...CUSTOMER_PRODUCT_METRICS,...MARKETING_METRIC_DEFINITIONS,...INVENTORY_METRIC_DEFINITIONS,...OPERATIONS_METRIC_DEFINITIONS];
 const productField=template==='PRODUCT'?metrics.find(m=>m.key==='PRODUCT_REVENUE_SHARE'&&m.status==='READY')?.lineage.fields[0]:undefined;
 // Sales starts with core KPIs, then includes supported extended metrics up to the
 // established 30-widget dashboard limit. Unsupported metrics are never fabricated.
 // Keep the default Sales executive row to the six reference metrics. Advanced
 // confirmed metrics remain available through the existing Add widget flow.
 const salesKeys:MetricKey[]=["REVENUE","PROFIT","GROSS_MARGIN","ORDERS","CUSTOMERS","AVERAGE_ORDER_VALUE"];
 const candidateKeys=template==="SALES"?salesKeys:[...selected.primary,...selected.supporting];
 const keys=(template==="CUSTOM"?definitions.map(m=>m.key).filter(k=>ready.has(k)).slice(0,3):candidateKeys.filter(k=>ready.has(k)||template==="CUSTOMER"&&metrics.some(m=>m.key===k&&m.requiresPeriod===true))).filter((key,index,all)=>all.indexOf(key)===index).slice(0,30);
 const salesTrend=template==="SALES"&&ready.has("REVENUE")&&ready.has("PROFIT")?confirmedDimensions.find(d=>d.concept==="TIME"&&d.role==="DATE"):undefined;
 const salesCategory=template==="SALES"&&ready.has("REVENUE")?confirmedDimensions.find(d=>d.concept==="CATEGORY"&&d.role==="DIMENSION"):undefined;
 const salesSubcategory=template==="SALES"&&ready.has("REVENUE")?confirmedDimensions.find(d=>d.concept==="SUBCATEGORY"&&d.role==="DIMENSION"):undefined;
 const salesSegment=template==="SALES"&&ready.has("REVENUE")?confirmedDimensions.find(d=>d.concept==="CUSTOMER_SEGMENT"&&d.role==="DIMENSION"):undefined;
 const salesCustomer=template==="SALES"&&ready.has("REVENUE")?confirmedDimensions.find(d=>d.concept==="CUSTOMER"&&d.role==="DIMENSION"):undefined;
 const salesProduct=template==="SALES"&&ready.has("PROFIT")?confirmedDimensions.find(d=>d.concept==="PRODUCT"&&d.role==="DIMENSION"):undefined;
 const salesRegion=template==="SALES"&&ready.has("REVENUE")?confirmedDimensions.find(d=>d.concept==="GEOGRAPHY"&&d.role==="DIMENSION"):undefined;
 const salesHeatmap=template==="SALES"&&ready.has("REVENUE")?confirmedDimensions.find(d=>d.concept==="TIME"&&d.role==="DATE"):undefined;
 const chartCount=[salesCategory,salesTrend,salesSubcategory,salesSegment,salesCustomer,salesProduct,salesRegion,salesHeatmap].filter(Boolean).length;
 const selectedKeys=keys.slice(0,30-chartCount);
 const widgets:DashboardWidget[]=selectedKeys.map((key,index)=>({id:"metric-"+key.toLowerCase(),kind:productField?"BAR":"KPI",dimensionField:productField,metricKey:key,title:(template==="SALES"?({REVENUE:"Total Sales",PROFIT:"Profit",GROSS_MARGIN:"Profit Margin",ORDERS:"Orders",CUSTOMERS:"Customers",AVERAGE_ORDER_VALUE:"Average Order Value"} as Partial<Record<MetricKey,string>>)[key]:undefined)??(definitions.find(m=>m.key===key)!.label+(productField?" by product":"")),visible:true,order:index}));
 if(salesTrend)widgets.push({id:"sales-profit-trend",kind:"SALES_TREND",metricKey:"REVENUE",secondaryMetricKey:"PROFIT",title:"Sales and Profit Trend",visible:true,order:widgets.length,dimensionField:salesTrend.field});
 if(salesCategory)widgets.push({id:"sales-revenue-category",kind:"DONUT",metricKey:"REVENUE",title:"Sales by Category",visible:true,order:widgets.length,dimensionField:salesCategory.field});
 if(salesSubcategory)widgets.push({id:"sales-top-subcategories",kind:"HORIZONTAL_BAR",metricKey:"REVENUE",title:"Top 5 Sub-Categories by Sales",visible:true,order:widgets.length,dimensionField:salesSubcategory.field});
 if(salesSegment)widgets.push({id:"sales-segment-performance",kind:"TABLE",metricKey:"REVENUE",title:"Customer Segment Performance",visible:true,order:widgets.length,dimensionField:salesSegment.field});
 if(salesRegion)widgets.push({id:"sales-region-map",kind:"BAR",metricKey:"REVENUE",title:"Sales by Region",visible:true,order:widgets.length,dimensionField:salesRegion.field});
 if(salesHeatmap)widgets.push({id:"sales-order-date-heatmap",kind:"TABLE",metricKey:"REVENUE",title:"Sales by Order Date",visible:true,order:widgets.length,dimensionField:salesHeatmap.field});
 if(salesCustomer)widgets.push({id:"sales-top-customers",kind:"TABLE",metricKey:"REVENUE",title:"Top 5 Customers by Sales",visible:true,order:widgets.length,dimensionField:salesCustomer.field});
 if(salesProduct)widgets.push({id:"sales-top-products",kind:"TABLE",metricKey:"PROFIT",title:"Top 5 Products by Profit",visible:true,order:widgets.length,dimensionField:salesProduct.field});
 if(template==="SALES"){
  const metricOrder:MetricKey[]=["REVENUE","PROFIT","GROSS_MARGIN","ORDERS","CUSTOMERS","AVERAGE_ORDER_VALUE"];
  const panelOrder=["sales-profit-trend","sales-revenue-category","sales-top-subcategories","sales-region-map","sales-segment-performance","sales-order-date-heatmap","sales-top-customers","sales-top-products"];
  const order=(w:DashboardWidget)=>w.kind==="KPI"?metricOrder.indexOf(w.metricKey):6+panelOrder.indexOf(w.id);
  widgets.sort((left,right)=>order(left)-order(right)).forEach((widget,index)=>widget.order=index);
 }
 return {schemaVersion:1,template,templateVersion:1,name:name?.trim().slice(0,120)||selected.name,widgets};
}
export function customizeDashboardConfig(original:DashboardConfig,input:{widgets?:Array<{id:string;visible?:boolean;order?:number;title?:string}>;name?:string;sectionTitles?:Partial<Record<DashboardSectionKey,string>>}):DashboardConfig{
 if(input.sectionTitles!==undefined){if(!input.sectionTitles||typeof input.sectionTitles!=="object"||Array.isArray(input.sectionTitles))throw new Error("Invalid section titles.");for(const [key,value] of Object.entries(input.sectionTitles)){if(!(key in DASHBOARD_SECTION_DEFAULTS)||typeof value!=="string"||!value.trim()||value.length>80)throw new Error("Invalid section title.");}}
 const ids=new Set(original.widgets.map(w=>w.id));
 if(input.widgets?.some(w=>!ids.has(w.id)||typeof w.visible!=="undefined"&&typeof w.visible!=="boolean"||typeof w.order!=="undefined"&&(!Number.isInteger(w.order)||w.order<0||w.order>1000)||typeof w.title!=="undefined"&&(typeof w.title!=="string"||w.title.trim().length===0||w.title.length>80)))throw new Error("Invalid dashboard customization.");
 if(input.widgets&&new Set(input.widgets.map(w=>w.id)).size!==input.widgets.length)throw new Error("Duplicate dashboard widget.");
 const byId=new Map(input.widgets?.map(w=>[w.id,w]));
 return {...original,sectionTitles:input.sectionTitles?{...original.sectionTitles,...Object.fromEntries(Object.entries(input.sectionTitles).map(([k,v])=>[k,v!.trim()]))}:original.sectionTitles,name:typeof input.name==="string"?input.name.trim().slice(0,120)||original.name:original.name,widgets:original.widgets.map(w=>{const update=byId.get(w.id);return {...w,visible:update?.visible??w.visible,order:update?.order??w.order,title:update?.title?.trim()??w.title}}).sort((a,b)=>a.order-b.order)};
}

export function resetDashboardConfig(current:DashboardConfig,metrics:MetricOutcome[]):DashboardConfig{
 const defaults=generateDashboardConfig(current.template,metrics,current.name);
 // Restore the template layout and labels while keeping the customer-chosen dashboard name.
 // sectionTitles intentionally reset to their default fallback (undefined).
 return {...defaults,sectionTitles:undefined};
}
export function addDashboardWidget(current:DashboardConfig,metricKey:MetricKey,kind:DashboardWidgetKind,dimensionField:string|undefined,readyMetrics:MetricOutcome[],approvedDimensions:string[]):DashboardConfig{
 if(!(["KPI","BAR","LINE","TABLE","HORIZONTAL_BAR","DONUT","SALES_TREND"] as string[]).includes(kind))throw new Error("Unsupported dashboard widget type.");
 if(current.widgets.length>=30)throw new Error("Dashboard widget limit reached.");
 const metric=readyMetrics.find(m=>m.key===metricKey&&m.status==="READY");
 if(!metric)throw new Error("Metric is not available for this widget.");
 if(kind==="SALES_TREND")throw new Error("The combined trend is generated from confirmed Sales metrics only.");
 if(kind!=="KPI"&&(!dimensionField||!approvedDimensions.includes(dimensionField)))throw new Error("Choose a confirmed grouping field.");
 const id="widget-"+Math.random().toString(36).slice(2)+"-"+Date.now().toString(36);
 return {...current,widgets:[...current.widgets,{id,kind,metricKey,title:metric.definition.label,visible:true,order:current.widgets.length,dimensionField:kind==="KPI"?undefined:dimensionField}]};
}

/** Only compatible presentations of an existing, governed breakdown are interchangeable. */
export function chartAlternatives(kind:DashboardWidgetKind,role:"DATE"|"DIMENSION"):DashboardWidgetKind[]{
 if(kind==="KPI"||kind==="SALES_TREND")return [];
 return role==="DATE"?["LINE","TABLE"]:["BAR","HORIZONTAL_BAR","TABLE","DONUT"];
}
export function changeDashboardWidgetKind(current:DashboardConfig,id:string,kind:DashboardWidgetKind,role:"DATE"|"DIMENSION"):DashboardConfig{
 const widget=current.widgets.find(w=>w.id===id);
 if(!widget||!widget.dimensionField||!chartAlternatives(widget.kind,role).includes(kind))
  throw new Error("This chart alternative is not compatible with its confirmed dimension.");
 return {...current,widgets:current.widgets.map(w=>w.id===id?{...w,kind}:w)};
}

/** Canonical Sales panels replace obsolete visual layouts while retaining saved extra widgets for exports/tools. */
export function salesPresentationConfig(stored:DashboardConfig,metrics:MetricOutcome[],dimensions:readonly {field:string;role:'DATE'|'DIMENSION';concept?:string}[]):DashboardConfig{
 if(stored.template!=='SALES')return stored;
 const canonical=generateDashboardConfig('SALES',metrics,stored.name,false,false,false,dimensions);
 const ids=new Set(canonical.widgets.map(widget=>widget.id));
 const extras=stored.widgets.filter(widget=>!ids.has(widget.id));
 return {...canonical,widgets:[...canonical.widgets,...extras].slice(0,30).map((widget,order)=>({...widget,order}))};
}
