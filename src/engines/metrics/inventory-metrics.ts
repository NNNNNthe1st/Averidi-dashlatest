import {INVENTORY_METRIC_DEFINITIONS} from "./metric-catalog";
export {INVENTORY_METRIC_DEFINITIONS} from "./metric-catalog";
import {createHash} from "node:crypto";
import {projectDashboardBusinessRows} from "./canonical-metric-rows";
import {eligibleMetricMappings,type MetricContext,type MetricDefinition,type MetricOutcome} from "./metric-engine";

/** Inventory is a point-in-time product snapshot, never a sum of historical snapshots.
 * Demand and COGS inputs must cover the explicitly confirmed matching observation period.
 * A user must confirm the stock snapshot and observation periods; no default is inferred. */

export type InventoryPolicy={
 inventorySnapshotConfirmed?:boolean;
 inventorySnapshotUniqueProducts?:boolean;
 inventoryDemandPeriodDays?:number;
 inventoryLeadTimeDays?:number;
 inventorySafetyDays?:number;
 inventoryTurnoverPeriodConfirmed?:boolean;
};
const inventoryVersion=(definition:MetricDefinition,policy:InventoryPolicy)=>
 "inventory-v1-"+createHash("sha256").update(JSON.stringify({key:definition.key,formula:definition.formula,requires:definition.requires,policy})).digest("hex").slice(0,20);

export function calculateDashboardInventoryMetrics(ctx:MetricContext,policy:InventoryPolicy):MetricOutcome[]{
 const continuous=ctx.mappings.some(m=>['INVENTORY_ON_HAND','INVENTORY_DEMAND'].includes(m.canonicalConcept)&&m.unit&&!['items','cases'].includes(m.unit));
 const round=(value:number)=>continuous?value:Math.ceil(value);
 const projected=projectDashboardBusinessRows(ctx.rows,ctx.mappings);
 return INVENTORY_METRIC_DEFINITIONS.map(definition=>{
  if(continuous&&definition.key==='INVENTORY_REORDER_PRODUCTS')definition={...definition,formula:'COUNT(products where current stock < daily demand * coverage days)'};
  if(continuous&&definition.key==='INVENTORY_REORDER_GAP')definition={...definition,formula:'SUM(MAX(0, period demand / period days * (lead days + safety days) - current on-hand))'};
  const mappings=definition.requires.map(concept=>eligibleMetricMappings(ctx.mappings,concept));
  const lineage={datasetVersionId:ctx.versionId,fields:mappings.flatMap(m=>m.map(x=>x.sourceField)),rowCount:ctx.rows.length,period:null,currency:ctx.currency,definitionVersion:inventoryVersion(definition,policy),filters:ctx.appliedFilters??[]};
  const unavailable=(reason:string,status:"NEEDS_CONFIRMATION"|"UNAVAILABLE"="NEEDS_CONFIRMATION"):MetricOutcome=>({key:definition.key,definition,status,value:null,reason,lineage});
  if(ctx.qualityStatus==="FAIL")return unavailable("Data-quality checks failed.","UNAVAILABLE");
  if(!ctx.rows.length)return unavailable("No inventory records available.","UNAVAILABLE");
  if(policy.inventorySnapshotConfirmed!==true||policy.inventorySnapshotUniqueProducts!==true)
   return unavailable("Confirm one current stock snapshot with exactly one row per product. Historical snapshots cannot be summed.");
  if(!["CONFIRMED","AUTO_CONFIRMED"].includes(ctx.grainStatus))return unavailable("Confirm dataset row grain.");
  if(ctx.grain!=="PRODUCT"&&ctx.grain!=="RECORD")return unavailable("Inventory KPIs require product-grain or one-record-per-product snapshots.");
  if(mappings.some(list=>list.length!==1))return unavailable("Confirm exactly one source field per required inventory concept.");
  const productValues=projected.map(row=>row.PRODUCT);
  if(productValues.some(x=>typeof x!=="string"&&typeof x!=="number"||!String(x).trim())||new Set(productValues.map(String)).size!==ctx.rows.length)
   return unavailable("Inventory snapshot must have one unique nonempty product identifier per row.","UNAVAILABLE");
  const requiresMoney=definition.requires.some(c=>c==="INVENTORY_VALUE"||c==="INVENTORY_COGS"||c==="INVENTORY_AVG_VALUE");
  if(requiresMoney&&(ctx.currencyMode!=="SINGLE"||!ctx.currency))
   return unavailable("Confirm one currency for inventory valuation and period costs.");
  const values=new Map<string,number[]>();
  for(const concept of definition.requires.filter(c=>c!=="PRODUCT")){
   const data:number[]=[];
   for(const row of projected){
    const value=row[concept];
    if(typeof value!=="number"||!Number.isFinite(value)||value<0||
      (["INVENTORY_ON_HAND","INVENTORY_DEMAND"].includes(concept)&&!continuous&&!Number.isSafeInteger(value)))
     return unavailable("Inventory quantities must be nonnegative whole numbers; monetary values must be finite and nonnegative.","UNAVAILABLE");
    data.push(value);
   }
   values.set(concept,data);
  }
  if(definition.key==="INVENTORY_TURNOVER"&&policy.inventoryTurnoverPeriodConfirmed!==true)
   return unavailable("Confirm that COGS and average inventory value refer to the same observation period.");
  if((definition.key==="INVENTORY_DEMAND_UNITS"||definition.key==="INVENTORY_REORDER_GAP"||definition.key==="INVENTORY_REORDER_PRODUCTS")&&
    (!Number.isInteger(policy.inventoryDemandPeriodDays)||!(policy.inventoryDemandPeriodDays!>0)||policy.inventoryDemandPeriodDays!>366))
   return unavailable("Confirm a demand observation period of 1–366 days.");
  if((definition.key==="INVENTORY_REORDER_GAP"||definition.key==="INVENTORY_REORDER_PRODUCTS")&&
    (typeof policy.inventoryLeadTimeDays!=="number"||!Number.isFinite(policy.inventoryLeadTimeDays)||policy.inventoryLeadTimeDays<=0||policy.inventoryLeadTimeDays>365||
     typeof policy.inventorySafetyDays!=="number"||!Number.isFinite(policy.inventorySafetyDays)||policy.inventorySafetyDays<0||policy.inventorySafetyDays>365))
   return unavailable("Confirm positive replenishment lead time and nonnegative safety days.");
  // Avoid unsafe financial totals or silently rounded unit counts.
  for(const [concept,amounts] of values){
   const total=amounts.reduce((a,b)=>a+b,0);
   if(!Number.isFinite(total)||(["INVENTORY_ON_HAND","INVENTORY_DEMAND"].includes(concept)&&!continuous&&!Number.isSafeInteger(total)))
    return unavailable("Inventory totals exceed supported numeric precision.","UNAVAILABLE");
  }
  if(definition.key==="INVENTORY_REORDER_GAP"||definition.key==="INVENTORY_REORDER_PRODUCTS"){
   const coverage=policy.inventoryLeadTimeDays!+policy.inventorySafetyDays!;
   const period=policy.inventoryDemandPeriodDays!;
   if((values.get("INVENTORY_DEMAND")??[]).some(demand=>(!Number.isFinite(round(demand/period*coverage))||Math.abs(round(demand/period*coverage))>Number.MAX_SAFE_INTEGER||!continuous&&!Number.isSafeInteger(round(demand/period*coverage)))))
    return unavailable("Required coverage exceeds supported numeric precision.","UNAVAILABLE");
  }
  const sum=(concept:string)=>values.get(concept)?.reduce((a,b)=>a+b,0)??0;
  const onHand=values.get("INVENTORY_ON_HAND")??[];
  const stockout=onHand.filter(v=>v===0).length;
  if(definition.key==="INVENTORY_STOCKOUT_PRODUCTS"||definition.key==="INVENTORY_STOCKOUT_RATE"){
   const flags=eligibleMetricMappings(ctx.mappings,"INVENTORY_STOCKOUT");
   if(flags.length>1)return unavailable("Duplicate stockout-flag mappings are ambiguous.");
   if(flags.length===1){
    const flagsData=projected.map(r=>r.INVENTORY_STOCKOUT);
    if(flagsData.some(x=>x!==0&&x!==1&&x!==false&&x!==true))return unavailable("Stockout flags must be explicitly 0/1 or true/false.","UNAVAILABLE");
    if(flagsData.some((x,i)=>(x===1||x===true)!==(onHand[i]===0)))return unavailable("Stockout flags conflict with on-hand units; resolve source disagreement.","UNAVAILABLE");
    lineage.fields.push(flags[0].sourceField);
   }
  }
  let value:number|null=null;
  switch(definition.key){
   case "INVENTORY_STOCK_ON_HAND":value=sum("INVENTORY_ON_HAND");break;
   case "INVENTORY_STOCKOUT_PRODUCTS":value=stockout;break;
   case "INVENTORY_STOCKOUT_RATE":value=stockout/ctx.rows.length;break;
   case "INVENTORY_VALUE_TOTAL":value=sum("INVENTORY_VALUE");break;
   case "INVENTORY_TURNOVER":{const average=sum("INVENTORY_AVG_VALUE");value=average>0?sum("INVENTORY_COGS")/average:null;break;}
   case "INVENTORY_DEMAND_UNITS":value=sum("INVENTORY_DEMAND");break;
   case "INVENTORY_REORDER_PRODUCTS":{
    const period=policy.inventoryDemandPeriodDays!,coverage=policy.inventoryLeadTimeDays!+policy.inventorySafetyDays!;
    value=(values.get("INVENTORY_DEMAND")??[]).filter((demand,i)=>onHand[i]<round(demand/period*coverage)).length;
    break;
   }
   case "INVENTORY_REORDER_GAP":{
    const period=policy.inventoryDemandPeriodDays!,coverage=policy.inventoryLeadTimeDays!+policy.inventorySafetyDays!;
    value=(values.get("INVENTORY_DEMAND")??[]).reduce((total,demand,i)=>total+Math.max(0,round(demand/period*coverage)-onHand[i]),0);
    break;
   }
  }
  if(value===null||!Number.isFinite(value)||!Number.isSafeInteger(value)&&definition.format==="COUNT"&&definition.key!=="INVENTORY_TURNOVER"&&!(continuous&&["INVENTORY_STOCK_ON_HAND","INVENTORY_DEMAND_UNITS","INVENTORY_REORDER_GAP"].includes(definition.key)))
   return unavailable("Inventory metric has an invalid result or zero denominator.","UNAVAILABLE");
  return {key:definition.key,definition,status:"READY",value,reason:null,lineage};
 });
}
