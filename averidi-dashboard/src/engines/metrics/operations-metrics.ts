import {OPERATIONS_METRIC_DEFINITIONS} from "./metric-catalog";
export {OPERATIONS_METRIC_DEFINITIONS} from "./metric-catalog";
import {createHash} from "node:crypto";
import {projectDashboardBusinessRows} from "./canonical-metric-rows";
import {eligibleMetricMappings,type MetricContext,type MetricDefinition,type MetricOutcome} from "./metric-engine";

/** Governed operations metrics only use explicitly confirmed period-aligned totals.
 * Never infer working time or completion status from arbitrary IDs/row labels. */

export type OperationsPolicy={
 operationsPeriodConfirmed?:boolean;
 operationsHoursBasisConfirmed?:boolean;
 operationsCycleTimeBasisConfirmed?:boolean;
 operationsErrorsAreDefectiveUnits?:boolean;
};
export function calculateDashboardOperationsMetrics(ctx:MetricContext,policy:OperationsPolicy):MetricOutcome[]{
 const projected=projectDashboardBusinessRows(ctx.rows,ctx.mappings);
 return OPERATIONS_METRIC_DEFINITIONS.map(definition=>{
  const matched=definition.requires.map(k=>eligibleMetricMappings(ctx.mappings,k));
  const lineage={datasetVersionId:ctx.versionId,fields:matched.flatMap(xs=>xs.map(x=>x.sourceField)),rowCount:ctx.rows.length,period:null,currency:null,definitionVersion:"operations-v1-"+createHash("sha256").update(JSON.stringify({definition,policy})).digest("hex").slice(0,20),filters:ctx.appliedFilters??[]};
  const reject=(reason:string,status:"NEEDS_CONFIRMATION"|"UNAVAILABLE"="NEEDS_CONFIRMATION"):MetricOutcome=>({key:definition.key,status,value:null,reason,definition,lineage});
  if(ctx.qualityStatus==="FAIL")return reject("Data-quality checks failed.","UNAVAILABLE");
  if(!ctx.rows.length)return reject("No operational records available.","UNAVAILABLE");
  if(!["CONFIRMED","AUTO_CONFIRMED"].includes(ctx.grainStatus))return reject("Confirm row grain.");
  if(policy.operationsPeriodConfirmed!==true)return reject("Confirm operational fields measure the same observation period and are not duplicated.");
  if(matched.some(xs=>xs.length!==1))return reject("Confirm exactly one source field for each required operational measure.");
  if(definition.requires.includes("OPERATIONS_HOURS")&&policy.operationsHoursBasisConfirmed!==true)
   return reject("Confirm labor hours refer to the same completed-work period.");
  if(definition.requires.includes("OPERATIONS_CYCLE_HOURS")&&policy.operationsCycleTimeBasisConfirmed!==true)
   return reject("Confirm cycle hours are total hours of the counted completed jobs.");
  if(definition.key==="OPERATIONS_DEFECT_RATE"&&policy.operationsErrorsAreDefectiveUnits!==true)
   return reject("Confirm error counts represent defective inspected units (not incidents or repeated errors).");
  const totals=new Map<string,number>();
  for(const concept of definition.requires){
   let total=0;
   for(const row of projected){
    const n=row[concept];
    if(typeof n!=="number"||!Number.isFinite(n)||n<0||
       (["OPERATIONS_COMPLETED","OPERATIONS_ERRORS","OPERATIONS_INSPECTED"].includes(concept)&&!Number.isSafeInteger(n)))
      return reject("Operational measures must be complete and nonnegative, and counts must be safe whole numbers.","UNAVAILABLE");
    total+=n;
    if(!Number.isFinite(total)||(["OPERATIONS_COMPLETED","OPERATIONS_ERRORS","OPERATIONS_INSPECTED"].includes(concept)&&!Number.isSafeInteger(total)))
     return reject("Operational totals exceed supported precision.","UNAVAILABLE");
   }
   totals.set(concept,total);
  }
  const count=totals.get("OPERATIONS_COMPLETED")??0,hours=totals.get("OPERATIONS_HOURS")??0,errors=totals.get("OPERATIONS_ERRORS")??0,inspected=totals.get("OPERATIONS_INSPECTED")??0;
  if(definition.key==="OPERATIONS_DEFECT_RATE"&&errors>inspected)return reject("Defective units exceed inspected units.","UNAVAILABLE");
  let value:number|null=null;
  switch(definition.key){
   case "OPERATIONS_COMPLETED_TOTAL":value=count;break;
   case "OPERATIONS_LABOR_HOURS":value=hours;break;
   case "OPERATIONS_PRODUCTIVITY":value=hours>0?count/hours:null;break;
   case "OPERATIONS_AVG_CYCLE_HOURS":value=count>0?totals.get("OPERATIONS_CYCLE_HOURS")!/count:null;break;
   case "OPERATIONS_ERRORS_TOTAL":value=errors;break;
   case "OPERATIONS_DEFECT_RATE":value=inspected>0?errors/inspected:null;break;
  }
  if(value===null||!Number.isFinite(value))return reject("A denominator is zero or the calculated result is invalid.","UNAVAILABLE");
  return {key:definition.key,status:"READY",value,reason:null,definition,lineage};
 });
}
