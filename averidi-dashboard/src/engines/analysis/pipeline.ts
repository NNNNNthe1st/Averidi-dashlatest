import {selectAnalysisRows} from './selection';
import {ANALYSIS_ENGINE_VERSION,analysisConfirmationSchema,type AnalysisConfirmation,analysisComparisonPeriods,effectiveAnalysisFilters} from "./query-contracts";
export {ANALYSIS_ENGINE_VERSION,analysisConfirmationSchema,type AnalysisConfirmation,analysisComparisonPeriods,effectiveAnalysisFilters} from "./query-contracts";
import {analysisQuerySchema,type AnalysisQuery} from "./query-contracts";
export {analysisQuerySchema,type AnalysisQuery} from "./query-contracts";
import {normalizeBusinessUnits,canonicalUnit} from '../metrics/units';
import {calculateCustomerProductMetrics} from '../metrics/customer-product-metrics';
import {calculateSalesExtendedMetrics} from '../metrics/sales-extended-metrics';
import {z} from 'zod';
import {newRowGrainValid} from '../understanding/row-grain';
import type {DashboardPreparedData,DashboardRow} from '../ingestion/ingest';
import {calculateDashboardMetrics,comparablePeriods,metricComparison,type MetricOutcome} from '../metrics/metric-engine';
import {calculateDashboardOperationsMetrics} from '../metrics/operations-metrics';
import {calculateDashboardInventoryMetrics} from '../metrics/inventory-metrics';
import {calculateDashboardMarketingMetrics} from '../metrics/marketing-metrics';
import {dashboardBusinessDay} from '../metrics/business-period';
import {metricRulesSchema,metricRulesToEngineSemantics} from '../../features/datasets/metric-rules';
import {fieldConfirmationSchema} from '../../features/datasets/field-confirmation';
import {comparisonOptionsSchema,resolveComparisonPeriods,type ComparisonPeriods} from '../metrics/comparison-periods';







const measures=new Set(['REVENUE','COST','QUANTITY','REFUND','DISCOUNT','RETURN_QUANTITY','PRE_DISCOUNT_SALES','REFUND_ELIGIBLE_SALES','GROSS_SOLD_QUANTITY','SALES_OPEN_PIPELINE_VALUE','MARKETING_SPEND','MARKETING_LEADS','MARKETING_CONVERSIONS','MARKETING_ACQUISITIONS','ATTRIBUTED_REVENUE','INVENTORY_ON_HAND','INVENTORY_DEMAND','INVENTORY_STOCKOUT','INVENTORY_COGS','INVENTORY_VALUE','INVENTORY_AVG_VALUE','OPERATIONS_COMPLETED','OPERATIONS_HOURS','OPERATIONS_CYCLE_HOURS','OPERATIONS_ERRORS','OPERATIONS_INSPECTED']);
const dimensions=new Set(['PRODUCT','CUSTOMER','SALES_REPRESENTATIVE','SALES_OPPORTUNITY_OPENED','SALES_OPPORTUNITY_CLOSED','SALES_OPPORTUNITY_ID','SALES_OPPORTUNITY_STAGE','SALES_OPPORTUNITY_QUALIFIED','CUSTOMER_SEGMENT','CATEGORY','SUBCATEGORY','CHANNEL','GEOGRAPHY','STATUS','CURRENCY','TIME']);
export function confirmedDimensions(confirmation:AnalysisConfirmation){return confirmation.confirmedMappings.filter(m=>dimensions.has(m.canonicalConcept)).map(m=>({field:m.sourceField,concept:m.canonicalConcept,role:m.canonicalConcept==='TIME'?'DATE' as const:'DIMENSION' as const}));}
export function retainedTextFields(confirmation:AnalysisConfirmation){return confirmation.confirmedMappings.filter(m=>!measures.has(m.canonicalConcept)&&m.canonicalConcept!=='IGNORE'&&m.canonicalConcept!=='TIME').map(m=>m.sourceField);}
export type DashboardAnalysis={frame?:import('../columnar/engine').ColumnarFrame;engineVersion:number;quality:{status:'FAIL'|'PASS';issues:{code:string;message:string}[];sourceRows:number;selectedRows:number;duplicateRows:number};outcomes:MetricOutcome[];dimensions:ReturnType<typeof confirmedDimensions>;comparison:Record<string,{current:number|null;previous:number|null;absolute:number|null;percentage:number|null}>|null;comparisonPeriods?:ComparisonPeriods};
export function analyzeDashboardData(prepared:DashboardPreparedData,versionId:string,confirmation:AnalysisConfirmation,query:AnalysisQuery={filters:[],compare:false},historyRows:DashboardRow[]=prepared.rows,scope:'ALL'|'SALES_CHART'='ALL'):DashboardAnalysis{
 const mappings=confirmation.confirmedMappings.map(m=>({...m,status:'CONFIRMED',role:m.canonicalConcept==='IGNORE'?'IGNORE':measures.has(m.canonicalConcept)?'MEASURE':'DIMENSION'}));
 let rules=confirmation.metricRules;
 for(const m of mappings){const rule=rules.units?.[m.sourceField];if(rule)(m as typeof m&{unit?:string}).unit=canonicalUnit(rule).label;}
 const normalized=normalizeBusinessUnits(prepared.rows,mappings,rules.units);let historical=normalizeBusinessUnits(historyRows,mappings,rules.units).rows;
 const periods=analysisComparisonPeriods(query);let filters=effectiveAnalysisFilters(query,periods);
 const issues:{code:string;message:string}[]=[];
 const names=new Set(prepared.columns.map(c=>c.name));
 if(!mappings.length||mappings.some(m=>!names.has(m.sourceField)))throw Error('INVALID_CONFIRMED_FIELDS');
 if(prepared.duplicateCount)issues.push({code:'DUPLICATE_ROWS',message:'Identical rows must be resolved before calculation.'});
 const grainConcept=({ORDER:'ORDER',TRANSACTION:'IDENTIFIER',CUSTOMER:'CUSTOMER',PRODUCT:'PRODUCT',PERIOD:'TIME',RECORD:null,INVOICE:null,INVOICE_ITEM:null,ORDER_ITEM:null,DAY:null} as const)[rules.grain];
 if(grainConcept){
  const identity=mappings.filter(m=>m.canonicalConcept===grainConcept);
  const values=identity.length===1?prepared.rows.map(r=>r[identity[0].sourceField]):[];
  if(identity.length!==1||values.some(v=>v===null||v===undefined||String(v).trim()===''||typeof v==='number'&&!Number.isSafeInteger(v))||new Set(values.map(String)).size!==prepared.rows.length)
   issues.push({code:'ROW_GRAIN',message:`${rules.grain} rows require one complete, unique ${grainConcept} field. Choose the actual row grain or correct the data.`});
 }
 if(["INVOICE","INVOICE_ITEM","ORDER_ITEM","DAY"].includes(rules.grain)&&!newRowGrainValid(prepared.rows,mappings,rules.grain,rules.timezone))
  issues.push({code:"ROW_GRAIN",message:"Confirmed row grain requires complete, unique document/line keys, or one valid business day per row in the confirmed timezone. Review identity fields and grain."});
 const dims=confirmedDimensions(confirmation);
 let rows=selectAnalysisRows(normalized.rows,dims,rules.timezone,filters);
 let resolvedQuery=query;
 // A selected single-currency population can be measured safely without
 // converting another currency. Bind history and comparison to that same code.
 if(confirmation.salesEngine){
  const currencyFields=mappings.filter(m=>m.canonicalConcept==='CURRENCY');
  if(currencyFields.length===1&&rows.length){
   const field=currencyFields[0].sourceField,values=[...new Set(rows.map(row=>String(row[field]??'').trim().toUpperCase()))];
   if(values.length===1&&/^[A-Z]{3}$/.test(values[0])&&Intl.supportedValuesOf('currency').includes(values[0])){
    rules={...rules,currency:values[0],currencyMode:'SINGLE'};
    historical=historical.filter(row=>String(row[field]??'').trim().toUpperCase()===values[0]);
    if(confirmation.metricRules.currencyMode==='MULTI'&&!filters.some(f=>f.field===field)){
     const currencyFilter={type:'CATEGORY' as const,field,value:values[0]};filters=[...filters,currencyFilter];resolvedQuery={...query,filters:[...query.filters,currencyFilter]};
    }
   }else rules={...rules,currency:null,currencyMode:'MULTI'};
  }
 }
 const quality={status:issues.length?'FAIL' as const:'PASS' as const,issues,sourceRows:prepared.rows.length,selectedRows:rows.length,duplicateRows:prepared.duplicateCount};
 const calculate=(subset:DashboardRow[])=>calculateDashboardMetrics({arithmetic:confirmation.salesEngine?.arithmetic,rows:subset,mappings,grain:rules.grain,grainStatus:'CONFIRMED',versionId,qualityStatus:quality.status,currency:rules.currency,currencyMode:rules.currencyMode,timezone:rules.timezone,appliedFilters:filters},metricRulesToEngineSemantics(rules));
 const metricsContext={arithmetic:confirmation.salesEngine?.arithmetic,rows,mappings,grain:rules.grain,grainStatus:'CONFIRMED',versionId,qualityStatus:quality.status,currency:rules.currency,currencyMode:rules.currencyMode,timezone:rules.timezone,appliedFilters:filters} as const;
 // Sales charts need governed core metrics, not a fresh full-history forecast/CRM run for every customer or month.
 // Default scope is unchanged for every other caller/template.
 if(scope==='SALES_CHART'){
  const outcomes=calculate(rows).map(m=>rows.length?m:{...m,status:'UNAVAILABLE' as const,value:null,reason:'No rows match the selected filters.'}).map(m=>m.definition.requires.includes('QUANTITY')&&normalized.units.has('QUANTITY')?{...m,lineage:{...m.lineage,unit:normalized.units.get('QUANTITY')}}:m);
  let comparison:DashboardAnalysis['comparison']=null;
  if(periods){const date=resolvedQuery.filters.find(f=>f.type==='DATE_RANGE')!;const prior=analyzeDashboardData(prepared,versionId,confirmation,{filters:resolvedQuery.filters.map(f=>f===date?{...f,value:periods.previous.start,end:periods.previous.end}:f),compare:false},historyRows,scope).outcomes;
   comparison=Object.fromEntries(outcomes.map(m=>{const p=prior.find(p=>p.key===m.key),a=m.status==='READY'?m.value:null,b=p?.status==='READY'?p.value:null;return [m.key,{current:a,previous:b,...(a!==null&&b!==null?metricComparison(a,b):{absolute:null,percentage:null})}];}));
  }
  return {engineVersion:ANALYSIS_ENGINE_VERSION,quality,outcomes,dimensions:dims,comparison,...(periods?{comparisonPeriods:periods}:{})};
 }
 const marketing=calculateDashboardMarketingMetrics(metricsContext,{marketingAttribution:rules.marketingAttribution,marketingSpendDeduplicated:rules.marketingSpendDeduplicated,marketingAcquisitionsConfirmed:rules.marketingAcquisitionsConfirmed},metricRulesToEngineSemantics(rules));
 const inventory=calculateDashboardInventoryMetrics(metricsContext,rules);
 const operations=calculateDashboardOperationsMetrics(metricsContext,rules);
 const totalFilters=filters.filter(f=>!mappings.some(m=>m.sourceField===f.field&&m.canonicalConcept==='PRODUCT'));
 const totals=historical.filter(row=>totalFilters.every(f=>f.type==='DATE_RANGE'?Boolean(f.end&&rules.timezone&&dashboardBusinessDay(row[f.field],rules.timezone)!>=f.value&&dashboardBusinessDay(row[f.field],rules.timezone)!<=f.end):f.type==='MISSING'?row[f.field]===null||row[f.field]===undefined:row[f.field]!==null&&row[f.field]!==undefined&&String(row[f.field])===f.value));
 const behavior=calculateCustomerProductMetrics(metricsContext,metricRulesToEngineSemantics(rules),historical,totals,rules.customerHistoryConfirmed===true,normalized.rows.filter(row=>filters.filter(f=>f.type!=='DATE_RANGE').every(f=>f.type==='MISSING'?row[f.field]===null||row[f.field]===undefined:row[f.field]!==null&&row[f.field]!==undefined&&String(row[f.field])===f.value)));
 const sales=calculateSalesExtendedMetrics(metricsContext,metricRulesToEngineSemantics(rules),historical,rules.salesHistoryConfirmed===true,{salesTopN:rules.salesTopN,salesConcentrationConcept:rules.salesConcentrationConcept,salesDiscountBasisConfirmed:rules.salesDiscountBasisConfirmed,salesRefundBasisConfirmed:rules.salesRefundBasisConfirmed,salesReturnBasisConfirmed:rules.salesReturnBasisConfirmed,salesTargetAmount:rules.salesTargetAmount,salesBudgetAmount:rules.salesBudgetAmount,salesEligibleSellingDays:rules.salesEligibleSellingDays,salesPlanningPeriodStart:rules.salesPlanningPeriodStart,salesPlanningPeriodEnd:rules.salesPlanningPeriodEnd,salesPlanningBasisConfirmed:rules.salesPlanningBasisConfirmed,salesRepresentativeAttributionConfirmed:rules.salesRepresentativeAttributionConfirmed,salesOpportunityCohortConfirmed:rules.salesOpportunityCohortConfirmed,salesPipelineSnapshotConfirmed:rules.salesPipelineSnapshotConfirmed,salesCycleBasisConfirmed:rules.salesCycleBasisConfirmed,salesPriceVolumeBasisConfirmed:rules.salesPriceVolumeBasisConfirmed,salesVolatilityPeriodConfirmed:rules.salesVolatilityPeriodConfirmed,salesGrowthContributionBasisConfirmed:rules.salesGrowthContributionBasisConfirmed,salesForecastBasisConfirmed:rules.salesForecastBasisConfirmed,salesForecastSeasonDays:rules.salesForecastSeasonDays,salesForecastHorizonDays:rules.salesForecastHorizonDays,salesCohortMonth:rules.salesCohortMonth});
 const outcomes=[...calculate(rows),...marketing,...inventory,...operations,...behavior,...sales].map(m=>rows.length?m:{...m,status:'UNAVAILABLE' as const,value:null,reason:'No rows match the selected filters.'});
 let comparison:Record<string,{current:number|null;previous:number|null;absolute:number|null;percentage:number|null}>|null=null;
 if(periods){
  const date=resolvedQuery.filters.find(f=>f.type==='DATE_RANGE')!;
  const previousQuery={filters:resolvedQuery.filters.map(f=>f===date?{...f,value:periods.previous.start,end:periods.previous.end}:f),compare:false};
  const prior=analyzeDashboardData(prepared,versionId,confirmation,previousQuery,historyRows).outcomes;
  comparison=Object.fromEntries(outcomes.map(m=>{const p=prior.find(p=>p.key===m.key);const a=m.status==='READY'?m.value:null,b=p?.status==='READY'?p.value:null;return [m.key,{current:a,previous:b,...(a!==null&&b!==null?metricComparison(a,b):{absolute:null,percentage:null})}];}));
 }
return {engineVersion:ANALYSIS_ENGINE_VERSION,quality,outcomes:outcomes.map(m=>{const quantity=m.definition.requires.includes('QUANTITY')?'QUANTITY':m.key==='INVENTORY_STOCK_ON_HAND'||m.key==='INVENTORY_REORDER_GAP'?'INVENTORY_ON_HAND':m.key==='INVENTORY_DEMAND_UNITS'?'INVENTORY_DEMAND':null;return quantity&&normalized.units.has(quantity)?{...m,lineage:{...m.lineage,unit:normalized.units.get(quantity)}}:m;}),dimensions:dims,comparison,...(periods?{comparisonPeriods:periods}:{})};
}

