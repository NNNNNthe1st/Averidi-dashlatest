import {MARKETING_METRIC_DEFINITIONS} from "./metric-catalog";
export {MARKETING_METRIC_DEFINITIONS} from "./metric-catalog";
import type {DashboardRow} from "../ingestion/ingest";
import {dashboardMetricGovernanceVersion} from "./metric-governance";
import {eligibleMetricMappings,type MetricContext,type MetricDefinition,type MetricOutcome,type MetricSemantics} from "./metric-engine";
import {projectDashboardBusinessRows} from "./canonical-metric-rows";

/** Campaign figures are only calculated from explicit, user-confirmed source-reported attribution.
 * ROI here is revenue-based return on marketing spend, NOT net-profit ROI.
 * Do not mix row-grains or infer credit from channel names. */

export type MarketingPolicy={marketingAttribution?:"UNCONFIRMED"|"SOURCE_REPORTED";marketingSpendDeduplicated?:boolean;marketingAcquisitionsConfirmed?:boolean};
export function calculateDashboardMarketingMetrics(ctx:MetricContext,policy:MarketingPolicy,semantics:MetricSemantics):MetricOutcome[]{
 const projected=projectDashboardBusinessRows(ctx.rows,ctx.mappings);
 return MARKETING_METRIC_DEFINITIONS.map(definition=>{
  const mappings=definition.requires.map(concept=>eligibleMetricMappings(ctx.mappings,concept));
  const fields=mappings.flatMap(list=>list.map(item=>item.sourceField));
  const lineage={datasetVersionId:ctx.versionId,fields,rowCount:ctx.rows.length,period:null,currency:ctx.currency,definitionVersion:dashboardMetricGovernanceVersion(definition,semantics)+"-marketing-v1-"+(policy.marketingAttribution??"UNCONFIRMED")+"-"+String(policy.marketingSpendDeduplicated),filters:ctx.appliedFilters??[]};
  const fail=(reason:string,status:"UNAVAILABLE"|"NEEDS_CONFIRMATION"="NEEDS_CONFIRMATION"):MetricOutcome=>({key:definition.key,definition,status,value:null,reason,lineage});
  if(definition.key==='MARKETING_CAC')lineage.definitionVersion+='-new-customers-'+String(policy.marketingAcquisitionsConfirmed);
  if(ctx.qualityStatus==="FAIL")return fail("Data-quality checks failed.","UNAVAILABLE");
  if(!ctx.rows.length)return fail("No records available.","UNAVAILABLE");
  if(!["CONFIRMED","AUTO_CONFIRMED"].includes(ctx.grainStatus))return fail("Confirm row grain before calculating marketing results.");
  if(mappings.some(list=>list.length!==1))return fail("Confirm exactly one source field for every required marketing concept.");
  if(definition.requires.some(field=>field==="MARKETING_SPEND")&&policy.marketingSpendDeduplicated!==true)
   return fail("Confirm that marketing spend is not repeated across source rows.");
  if(definition.key==='MARKETING_CAC'&&policy.marketingAttribution!=='SOURCE_REPORTED')return fail('Confirm source-reported acquisition attribution; new-customer credit is never inferred.');
  if(definition.requires.some(field=>field==="ATTRIBUTED_REVENUE"||field==="MARKETING_CONVERSIONS")&&policy.marketingAttribution!=="SOURCE_REPORTED")
   return fail("Confirm that revenue and conversions are attributed by the original data source; Dashboard never infers attribution.");
  if(definition.key==='MARKETING_CAC'&&policy.marketingAcquisitionsConfirmed!==true)return fail('Confirm that acquisition counts are source-attributed unique NEW customers and do not overlap across rows. Conversions and repeat customers are not new acquisitions.');
  if(definition.format==="CURRENCY"||definition.requires.some(field=>["MARKETING_SPEND","ATTRIBUTED_REVENUE"].includes(field))){
   if(ctx.currencyMode!=="SINGLE"||!ctx.currency)return fail("A single marketing currency must be confirmed. Currency conversion is not assumed.");
  }
  const totals=new Map<string,number>();
  for(const concept of definition.requires){
   let sum=0;
   for(const row of projected){
    const n=row[concept];
    if(typeof n!=="number"||!Number.isFinite(n)||n<0||(["MARKETING_LEADS","MARKETING_CONVERSIONS","MARKETING_ACQUISITIONS"].includes(concept)&&!Number.isSafeInteger(n)))
     return fail("Marketing figures must be complete, nonnegative and finite; counts must be whole numbers.","UNAVAILABLE");
    sum+=n;
    if(concept==='MARKETING_ACQUISITIONS'&&!Number.isSafeInteger(sum))return fail('Acquisition count exceeds supported whole-number precision.','UNAVAILABLE');
    if(!Number.isFinite(sum))return fail("Marketing total exceeds supported numeric precision.","UNAVAILABLE");
   }
   totals.set(concept,sum);
  }
  const spend=totals.get("MARKETING_SPEND")??0;
  const revenue=totals.get("ATTRIBUTED_REVENUE")??0;
  const conversions=totals.get("MARKETING_CONVERSIONS")??0;
  const leads=totals.get("MARKETING_LEADS")??0;
  if(definition.key==="MARKETING_CONVERSION_RATE"&&conversions>leads)return fail("Attributed conversions exceed leads; check attribution scope and grain.","UNAVAILABLE");
  let value:number|null=null;
  switch(definition.key){
   case "MARKETING_SPEND":value=spend;break;
   case "ATTRIBUTED_CONVERSIONS":value=conversions;break;
   case "ATTRIBUTED_REVENUE":value=revenue;break;
   case "MARKETING_CONVERSION_RATE":value=leads>0?conversions/leads:null;break;
   case "MARKETING_ROAS":value=spend>0?revenue/spend:null;break;
   case "MARKETING_ROI":value=spend>0?(revenue-spend)/spend:null;break;
   case 'MARKETING_CAC':{const acquisitions=totals.get('MARKETING_ACQUISITIONS')??0;value=acquisitions>0?spend/acquisitions:null;break;}
  }
  if(value===null||!Number.isFinite(value))return fail("Metric cannot be calculated with a zero denominator or invalid inputs.","UNAVAILABLE");
  return {key:definition.key,definition,status:"READY",value,reason:null,lineage};
 });
}
