import {compileSalesPlan,executeSalesPlan} from './sales-calculation-plan';
import {METRIC_DEFINITIONS,UNKNOWN_METRIC_SEMANTICS} from "./metric-catalog";
export {METRIC_DEFINITIONS,UNKNOWN_METRIC_SEMANTICS} from "./metric-catalog";
import {enforceDashboardQueryLimits,enforceDashboardQueryFilterBounds,DASHBOARD_QUERY_LIMITS} from "./query-limits";
import type { DashboardRow } from "../ingestion/ingest";
import {dashboardMetricGovernanceVersion} from "./metric-governance";
import {projectDashboardBusinessRows} from "./canonical-metric-rows";
import {dashboardInBusinessPeriod,comparablePeriods} from "./business-period";
export {comparablePeriods} from "./business-period";

export type MetricKey="SALES_FORECAST_MAE"|"SALES_FORECAST_RMSE"|"SALES_FORECAST_WAPE"|"SALES_FORECAST_GROWTH"|"SALES_COHORT_REVENUE_PER_ACTIVE_CUSTOMER"|"SALES_PRODUCT_MIX_EFFECT"|"SALES_VOLATILITY"|"SALES_GROWTH_CONTRIBUTION"|"SALES_AVG_CYCLE_DAYS"|"SALES_PRICE_EFFECT"|"SALES_VOLUME_EFFECT"|"SALES_CONVERSION_RATE"|"SALES_PIPELINE_COVERAGE"|"SALES_WIN_RATE"|"SALES_PER_REPRESENTATIVE"|"SALES_TARGET_ATTAINMENT"|"SALES_BUDGET_VARIANCE"|"SALES_PER_SELLING_DAY"|"SALES_REVENUE_PER_TRANSACTION"|"SALES_TOP_N_CONCENTRATION"|"SALES_DISCOUNT_RATE"|"SALES_REFUND_RATE"|"SALES_RETURN_RATE"|"SALES_CONTRIBUTION_SHARE"|"SALES_REVENUE_RANK"|"SALES_MTD"|"SALES_QTD"|"SALES_YTD"|"SALES_ROLLING_30D"|"SALES_ROLLING_12M"|"SALES_MOVING_30D_AVERAGE"|"SALES_CUMULATIVE"|"SALES_CAGR"|"SALES_REVENUE_PER_CUSTOMER"|"SALES_UNITS_PER_ORDER"|"NEW_CUSTOMERS"|"REPEAT_CUSTOMERS"|"REPEAT_PURCHASE_RATE"|"RETAINED_CUSTOMERS"|"CUSTOMER_RETENTION_RATE"|"OBSERVED_CUSTOMER_VALUE"|"PRODUCT_REVENUE_SHARE"|"PRODUCT_PROFIT_SHARE"|"OPERATIONS_COMPLETED_TOTAL"|"OPERATIONS_LABOR_HOURS"|"OPERATIONS_PRODUCTIVITY"|"OPERATIONS_AVG_CYCLE_HOURS"|"OPERATIONS_ERRORS_TOTAL"|"OPERATIONS_DEFECT_RATE"|"INVENTORY_STOCK_ON_HAND"|"INVENTORY_STOCKOUT_PRODUCTS"|"INVENTORY_STOCKOUT_RATE"|"INVENTORY_VALUE_TOTAL"|"INVENTORY_TURNOVER"|"INVENTORY_DEMAND_UNITS"|"INVENTORY_REORDER_PRODUCTS"|"INVENTORY_REORDER_GAP"|"MARKETING_SPEND"|"ATTRIBUTED_CONVERSIONS"|"ATTRIBUTED_REVENUE"|"MARKETING_CONVERSION_RATE"|"MARKETING_ROAS"|"MARKETING_ROI"|"MARKETING_CAC"|"REVENUE"|"COST"|"PROFIT"|"GROSS_MARGIN"|"ORDERS"|"CUSTOMERS"|"UNITS"|"AVERAGE_ORDER_VALUE"|"AVERAGE_UNIT_PRICE";
export type MetricMapping={sourceField:string;canonicalConcept:string;status:string;role:string;unit?:string|null};
export type MetricDefinition={key:MetricKey;label:string;description:string;formula:string;requires:string[];format:"CURRENCY"|"COUNT"|"PERCENT"};
export type MetricOutcome={requiresPeriod?:boolean;key:MetricKey;status:"READY"|"NEEDS_CONFIRMATION"|"UNAVAILABLE";value:number|null;reason:string|null;definition:MetricDefinition;lineage:{datasetVersionId:string;fields:string[];rowCount:number;period:{start:string;end:string}|null;currency:string|null;exactValue?:string;aggregation?:string;definitionVersion?:string;refreshedAt?:string|null;calculatedAt?:string|null;unit?:string|null;filters?:{type:"DATE_RANGE"|"CATEGORY"|"MISSING";field:string;value:string;end?:string}[]}};
export type MetricContext={arithmetic?:'DECIMAL';rows:DashboardRow[];mappings:MetricMapping[];grain:string;grainStatus:string;versionId:string;qualityStatus:"PASS"|"WARN"|"FAIL";currency:string|null;currencyMode:"UNSPECIFIED"|"SINGLE"|"MULTI";dateField?:string|null;timezone?:string|null;appliedFilters?:{type:"DATE_RANGE"|"CATEGORY"|"MISSING";field:string;value:string;end?:string}[]};

export type MetricSemantics={units?:import("./units").UnitRules;rowGrain?:string;rowAmountsConfirmed?:boolean;revenueBasis:"NET"|"GROSS"|"UNKNOWN";costBasis:"COGS"|"UNKNOWN";refundsIncluded:boolean|null;discountsIncluded:boolean|null;taxIncluded:boolean|null;shippingIncluded:boolean|null;cancellationTreatment?:"UNKNOWN"|"ALREADY_EXCLUDED"|"EXCLUDE_ROWS";returnTreatment?:"UNKNOWN"|"ALREADY_NETTED"|"DEDUCT_RETURNED_UNITS"};

export function eligibleMetricMappings(mappings:MetricMapping[],concept:string){
 return mappings.filter(m=>m.canonicalConcept===concept&&m.role!=="IGNORE"&&["CONFIRMED","AUTO_CONFIRMED"].includes(m.status));
}
function numberAt(row:DashboardRow,field:string){const value=row[field];return typeof value==="number"&&Number.isFinite(value)?value:null}
function validatedRows(ctx:MetricContext,period?:{start:string;end:string}){
 if(!period)return ctx.rows;
 if(!ctx.dateField||!ctx.timezone)throw new Error("Period metrics require a confirmed business timezone and a date field.");
 try{comparablePeriods(period.start,period.end)}catch{throw new Error("Invalid comparison period.")}
 return ctx.rows.filter(row=>{return dashboardInBusinessPeriod(row[ctx.dateField!],ctx.timezone!,period.start,period.end)});
}
export function calculateDashboardMetrics(ctx:MetricContext,semantics:MetricSemantics=UNKNOWN_METRIC_SEMANTICS,period?:{start:string;end:string}):MetricOutcome[]{
 enforceDashboardQueryLimits({rows:ctx.rows.length,columns:ctx.rows[0]?Object.keys(ctx.rows[0]).length:0,mappings:ctx.mappings.length});
 if(ctx.appliedFilters)enforceDashboardQueryFilterBounds(ctx.appliedFilters,ctx.arithmetic==='DECIMAL'&&ctx.mappings.some(m=>m.canonicalConcept==='CURRENCY'&&ctx.appliedFilters!.some(f=>f.field===m.sourceField&&f.type==='CATEGORY'&&/^[A-Z]{3}$/.test(f.value)))?1:0);
 if(period){
  if(typeof period.start!=="string"||typeof period.end!=="string"||
    period.start.length>DASHBOARD_QUERY_LIMITS.maxFilterValueLength||
    period.end.length>DASHBOARD_QUERY_LIMITS.maxFilterValueLength)
   throw new Error("Dashboard period filter is too large.");
 }
 const rawRows=validatedRows(ctx,period);
 const projected=projectDashboardBusinessRows(rawRows,ctx.mappings);
 const statusMappings=eligibleMetricMappings(ctx.mappings,"STATUS");
 const treatment=semantics.cancellationTreatment??"UNKNOWN";
 const statusValues=statusMappings.length===1?projected.map(row=>row.STATUS):null;
 const validStatuses=new Set(["CANCELLED","CANCELED","VOID","VOIDED","COMPLETE","COMPLETED","PAID","FULFILLED","SHIPPED","PROCESSING","PENDING","OPEN"]);
 const normalized=statusValues?.map(value=>typeof value==="string"?value.trim().toUpperCase():null);
 const requiresDecision=Boolean(statusMappings.length)&&treatment==="UNKNOWN";
 const invalidStatuses=Boolean(normalized?.some(value=>value===null||!validStatuses.has(value)));
 const cancellationRows=treatment==="EXCLUDE_ROWS"&&normalized&&!invalidStatuses&&ctx.grain==="ORDER"
  ?projected.filter((_,i)=>!["CANCELLED","CANCELED","VOID","VOIDED"].includes(normalized[i]!)):null;
 const rows=cancellationRows??projected;
 const decimalPlan=ctx.arithmetic==='DECIMAL'?compileSalesPlan(ctx.currency??'currency',{refunds:semantics.refundsIncluded===false,discounts:semantics.discountsIncluded===false,returns:semantics.returnTreatment==='DEDUCT_RETURNED_UNITS'}):null;
 const decimalMemo=new Map<string,import('@prisma/client').Prisma.Decimal>();
 return METRIC_DEFINITIONS.map(definition=>{
  const lineage={datasetVersionId:ctx.versionId,fields:[] as string[],rowCount:rows.length,period:period??null,currency:ctx.currency,definitionVersion:dashboardMetricGovernanceVersion(definition,semantics),filters:ctx.appliedFilters??(period&&ctx.dateField?[{type:"DATE_RANGE" as const,field:ctx.dateField,value:period.start,end:period.end}]:[])};
  const unavailable=(reason:string,status:"UNAVAILABLE"|"NEEDS_CONFIRMATION"="NEEDS_CONFIRMATION"):MetricOutcome=>({key:definition.key,status,value:null,reason,definition,lineage});
  if(ctx.qualityStatus==="FAIL")return unavailable("Data-quality checks failed.","UNAVAILABLE");
  if(requiresDecision)return unavailable("Confirm whether cancelled orders are already excluded from this dataset.");
  if(treatment==="EXCLUDE_ROWS"&&(statusMappings.length!==1||invalidStatuses||ctx.grain!=="ORDER"))
   return unavailable("Excluding cancelled orders requires order-grain data and one confirmed status field containing recognized statuses.");
  if(cancellationRows)lineage.fields.push(statusMappings[0].sourceField);
  if(!["CONFIRMED","AUTO_CONFIRMED"].includes(ctx.grainStatus))return unavailable("Dataset row grain must be confirmed.");
  if(["ORDER_ITEM","INVOICE_ITEM"].includes(ctx.grain)&&definition.requires.some(c=>["REVENUE","COST"].includes(c))&&semantics.rowAmountsConfirmed!==true)return unavailable("Confirm that all monetary inputs, including refunds and discounts, are amounts per line, not repeated document totals.");
  if(definition.format!=="COUNT"&&ctx.currencyMode==="MULTI")return unavailable("Currency conversion or a single-currency filter must be confirmed.");
  const found=definition.requires.map(concept=>eligibleMetricMappings(ctx.mappings,concept));
  if(found.some(list=>list.length!==1))return unavailable("Required business fields are missing or ambiguous.");
  const fields=found.map(list=>list[0].sourceField);lineage.fields=[...lineage.fields,...fields];
  if(definition.requires.includes("REVENUE")&&(semantics.revenueBasis!=="NET"||semantics.refundsIncluded===null||semantics.discountsIncluded===null||semantics.taxIncluded===null||semantics.shippingIncluded===null))return unavailable("Revenue definition and treatment of discounts, refunds, tax, and shipping require confirmation.");
  if(definition.requires.includes("COST")&&semantics.costBasis!=="COGS"&&["PROFIT","GROSS_MARGIN"].includes(definition.key))return unavailable("The cost field must be confirmed as cost of goods sold.");
  if(definition.format==="CURRENCY"&&!ctx.currency)return unavailable("Business currency must be confirmed.");
  // Refunds already included in NET revenue must never be subtracted twice.
  // When excluded, only a separately confirmed positive refund amount is safe.
  const refundMappings=eligibleMetricMappings(ctx.mappings,"REFUND");
  if(definition.requires.includes("REVENUE")&&semantics.refundsIncluded===false&&refundMappings.length!==1)
   return unavailable("Revenue excludes refunds. Confirm exactly one refund amount field before calculating net revenue.");

  // Discount deductions use explicitly confirmed positive amount fields.
  // Never deduct a discount twice if the revenue column already includes it.
  const discountMappings=eligibleMetricMappings(ctx.mappings,"DISCOUNT");
  if(definition.requires.includes("REVENUE")&&semantics.discountsIncluded===false&&discountMappings.length!==1)
   return unavailable("Revenue excludes discounts. Confirm exactly one discount amount field before calculating net revenue.");

  // Calculations consume canonical concepts only. Source names remain in lineage.
  const byConcept=new Map(definition.requires.map(concept=>[concept,concept]));
  const sum=(concept:string)=>{const field=byConcept.get(concept);if(!field)return null;let total=0;for(const row of rows){const value=numberAt(row,field);if(value===null)return null;total+=value}return Number.isFinite(total)?total:null};
  const distinct=(concept:string)=>{const field=byConcept.get(concept);if(!field)return null;const ids=new Set<string>();for(const row of rows){const value=row[field];if(value===null||value===undefined||String(value).trim()==="")return null;ids.add(String(value))}return ids.size};
  // Returns affect net units, not revenue: monetary refunds are governed
  // separately, so a returned item must never trigger a second refund.
  const returnMappings=eligibleMetricMappings(ctx.mappings,"RETURN_QUANTITY");
  const returnPolicy=semantics.returnTreatment??"UNKNOWN";
  const quantityAffected=definition.requires.includes("QUANTITY");
  if(quantityAffected&&returnMappings.length>0&&returnPolicy==="UNKNOWN")
   return unavailable("Confirm whether the quantity field already excludes returned units.");
  if(quantityAffected&&returnPolicy==="DEDUCT_RETURNED_UNITS"&&returnMappings.length!==1)
   return unavailable("Confirm exactly one returned-units field before calculating net quantity.");
  const returned=quantityAffected&&returnPolicy==="DEDUCT_RETURNED_UNITS"
   ?rows.map(row=>numberAt(row,"RETURN_QUANTITY")):null;
  if(returned&&returned.some(value=>value===null||value<0||(!semantics.units&& !Number.isInteger(value))))
   return unavailable("Returned units must be nonnegative whole numbers for every row.");
  if(returned)lineage.fields.push(returnMappings[0].sourceField);
  const returnedTotal=returned?returned.reduce<number>((total,value)=>total+(value??0),0):0;
  const revenueBeforeRefund=sum("REVENUE");
  const refundValues=semantics.refundsIncluded===false&&definition.requires.includes("REVENUE")
   ?rows.map(row=>numberAt(row,"REFUND")):null;
  if(refundValues&&refundValues.some(amount=>amount===null||amount!<0))
   return unavailable("Refund amounts must be complete, nonnegative values. Confirm the refund field and sign convention.");
  const refunds=refundValues?refundValues.reduce<number>((total,amount)=>total+(amount??0),0):0;
  if(refundValues)lineage.fields.push(refundMappings[0].sourceField);
  const discountValues=semantics.discountsIncluded===false&&definition.requires.includes("REVENUE")
   ?rows.map(row=>numberAt(row,"DISCOUNT")):null;
  if(discountValues&&discountValues.some(amount=>amount===null||amount<0))
   return unavailable("Discount amounts must be complete, nonnegative values. Confirm the discount field and sign convention.");
  const discounts=discountValues?discountValues.reduce<number>((total,amount)=>total+(amount??0),0):0;
  if(discountValues)lineage.fields.push(discountMappings[0].sourceField);
  const revenue=revenueBeforeRefund===null?null:revenueBeforeRefund-refunds-discounts;
  const cost=sum("COST"),grossUnits=sum("QUANTITY"),units=grossUnits===null?null:grossUnits-returnedTotal;
  if(returned&&((grossUnits??0)<returnedTotal||units===null||units<0))return unavailable("Returned units exceed confirmed sold units.");
  const orders=definition.requires.includes("ORDER")?distinct("ORDER"):null;
  let value:number|null=null;
  switch(definition.key){
   case "REVENUE":value=revenue;break;
   case "COST":value=cost;break;
   case "PROFIT":value=revenue!==null&&cost!==null?revenue-cost:null;break;
   case "GROSS_MARGIN":value=revenue!==null&&cost!==null&&revenue!==0?(revenue-cost)/revenue:null;break;
   case "ORDERS":value=orders;break;
   case "CUSTOMERS":value=distinct("CUSTOMER");break;
   case "UNITS":value=units;break;
   case "AVERAGE_ORDER_VALUE":value=revenue!==null&&orders!==null&&orders>0?revenue/orders:null;break;
   case "AVERAGE_UNIT_PRICE":value=revenue!==null&&units!==null&&units!==0?revenue/units:null;break;
  }
  if(ctx.arithmetic==='DECIMAL'&&['REVENUE','COST','PROFIT','GROSS_MARGIN','ORDERS','CUSTOMERS','UNITS','AVERAGE_ORDER_VALUE','AVERAGE_UNIT_PRICE'].includes(definition.key)){
   try{const calculated=executeSalesPlan(rows,decimalPlan!,definition.key,decimalMemo);value=calculated.value;Object.assign(lineage,{exactValue:calculated.exact,aggregation:calculated.aggregation});}
   catch{return unavailable('The calculation requires valid compatible inputs and a nonzero denominator.','UNAVAILABLE');}
  }
  if(value===null||!Number.isFinite(value))return unavailable("Metric has missing or invalid inputs, or a zero denominator.","UNAVAILABLE");
  return {key:definition.key,status:"READY",value,reason:null,definition,lineage};
 });
}

export function metricComparison(current:number,previous:number){return {absolute:current-previous,percentage:previous===0?null:(current-previous)/Math.abs(previous)}}
export function metricTarget(current:number,target:number,direction:"HIGHER"|"LOWER"="HIGHER"){if(!Number.isFinite(target)||target<=0)throw new Error("Targets must be positive finite numbers.");return {target,progress:direction==="HIGHER"?current/target:target/(current||Number.EPSILON),met:direction==="HIGHER"?current>=target:current<=target}}

/** Calendar-month comparison uses full months, not an arbitrary 30-day window. */
export function previousCalendarMonth(start:string,end:string){
 comparablePeriods(start,end);
 const match=/^(\d{4})-(\d{2})-01$/.exec(start);
 if(!match)throw new Error("Previous-month comparison requires a complete calendar month.");
 const year=Number(match[1]),month=Number(match[2]);
 const expectedEnd=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 if(end!==expectedEnd)throw new Error("Previous-month comparison requires a complete calendar month.");
 const priorStart=new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,10);
 const priorEnd=new Date(Date.UTC(year,month-1,0)).toISOString().slice(0,10);
 return {start:priorStart,end:priorEnd};
}

/** Compare a complete calendar year with the preceding complete calendar year. */
export function previousCalendarYear(start:string,end:string){
 comparablePeriods(start,end);
 const match=/^(\d{4})-01-01$/.exec(start);
 if(!match||end!==match[1]+"-12-31")throw new Error("Previous-year comparison requires a complete calendar year.");
 const year=Number(match[1]);
 if(year<=1)throw new Error("Previous-year comparison is outside the supported date range.");
 return {start:String(year-1).padStart(4,"0")+"-01-01",end:String(year-1).padStart(4,"0")+"-12-31"};
}

/** A status communicates direction and trustworthiness without inferring schedule pace. */
export function dashboardTargetStatus(progress:ReturnType<typeof dashboardTargetProgress>){
 if(progress.status!=="READY"||progress.met===null)return {code:"UNAVAILABLE" as const,label:"Target status unavailable",description:"The metric cannot be confirmed."};
 if(progress.met)return {code:"MET" as const,label:"Target met",description:"The confirmed value meets or exceeds the goal in the chosen direction."};
 return {code:"NOT_MET" as const,label:"Target not met",description:"The confirmed value has not yet met the goal."};
}

/** Safe target progress: unconfirmed and nonfinite measurements never produce a percentage. */
export function dashboardTargetProgress(value:number|null,target:number,direction:"HIGHER"|"LOWER"){
 if(!Number.isFinite(target)||target<=0||!["HIGHER","LOWER"].includes(direction))throw new Error("Invalid target.");
 if(value===null||!Number.isFinite(value))return {status:"UNAVAILABLE" as const,progress:null,completion:null,met:null};
 const met=direction==="HIGHER"?value>=target:value<=target;
 // Progress below zero or against a zero lower-is-better baseline is not meaningful.
 const progress=direction==="HIGHER"?Math.max(0,value/target):value<=0?1:Math.max(0,target/value);
 return {status:"READY" as const,progress,completion:Math.min(1,progress),met};
}
