import {SALES_EXTENDED_DEFINITIONS} from "./metric-catalog";
export {SALES_EXTENDED_DEFINITIONS} from "./metric-catalog";
import {createHash} from 'node:crypto';
import type {DashboardRow} from '../ingestion/ingest';
import {dashboardBusinessDay} from './business-period';
import {projectDashboardBusinessRows} from './canonical-metric-rows';
import {salesDiscountRate,salesRefundRate,salesReturnRate,salesPerRepresentative,salesTargetAttainment,salesBudgetVariance,salesPerSellingDay,salesRevenuePerTransaction,salesConversionRate,salesPipelineCoverage,salesWinRate,salesAverageCycleDays,salesPriceVolumeDecomposition,salesVolatility,salesGrowthContribution,salesSeasonalNaiveForecast,salesCohortRevenuePerActiveCustomer,type SalesProductPeriod} from './sales-advanced-calculations';
import {calculateDashboardMetrics,eligibleMetricMappings,type MetricContext,type MetricDefinition,type MetricOutcome,type MetricSemantics} from './metric-engine';
import {salesToDate,salesRollingRevenue,salesMovingDailyAverage,salesCagr,salesRevenuePerCustomer,salesUnitsPerOrder,salesPeriodRevenue,salesRankedSegments,salesTopNConcentration,type SalesDay,type SalesWindowResult} from './sales-period-calculations';

/** All data is derived from the already-confirmed revenue definition; no raw revenue arithmetic. */

const isoDate=(day:number)=>new Date(day*86400000).toISOString().slice(0,10);
const dayNumber=(date:string)=>Math.trunc(Date.parse(date+'T00:00:00.000Z')/86400000);
const unavailable=(reason:string):SalesWindowResult=>({status:'UNAVAILABLE',value:null,reason});
export function calculateSalesExtendedMetrics(ctx:MetricContext,semantics:MetricSemantics,allHistory:DashboardRow[],historyConfirmed:boolean,options:{salesTopN?:number;salesConcentrationConcept?:'CUSTOMER'|'PRODUCT'|'CHANNEL'|'GEOGRAPHY'|'CATEGORY';salesDiscountBasisConfirmed?:boolean;salesRefundBasisConfirmed?:boolean;salesReturnBasisConfirmed?:boolean;salesTargetAmount?:number;salesBudgetAmount?:number;salesEligibleSellingDays?:number;salesPlanningPeriodStart?:string;salesPlanningPeriodEnd?:string;salesPlanningBasisConfirmed?:boolean;salesRepresentativeAttributionConfirmed?:boolean;salesOpportunityCohortConfirmed?:boolean;salesPipelineSnapshotConfirmed?:boolean;salesCycleBasisConfirmed?:boolean;salesPriceVolumeBasisConfirmed?:boolean;salesVolatilityPeriodConfirmed?:boolean;salesGrowthContributionBasisConfirmed?:boolean;salesForecastBasisConfirmed?:boolean;salesForecastSeasonDays?:number;salesForecastHorizonDays?:number;salesCohortMonth?:string}={}):MetricOutcome[]{
 const field=(concept:string)=>{const m=eligibleMetricMappings(ctx.mappings,concept);return m.length===1?m[0].sourceField:null;};
 const selectedRevenue=calculateDashboardMetrics(ctx,semantics);
 const get=(key:string)=>selectedRevenue.find(m=>m.key===key);
 const time=field('TIME'),period=ctx.appliedFilters?.find(f=>f.type==='DATE_RANGE'&&f.field===time);
 const last=period?.end??(time&&ctx.timezone?ctx.rows.map(r=>dashboardBusinessDay(r[time],ctx.timezone!)).filter((v):v is string=>!!v).sort().at(-1):undefined);
 const lineage=(definition:MetricDefinition)=>({datasetVersionId:ctx.versionId,fields:definition.requires.flatMap(k=>field(k)?[field(k)!]:[]),rowCount:ctx.rows.length,period:period?.end?{start:period.value,end:period.end}:null,currency:ctx.currency,filters:ctx.appliedFilters??[],definitionVersion:'sales-v1-'+createHash('sha256').update(JSON.stringify({definition,semantics,historyConfirmed})).digest('hex').slice(0,20)});
 const ready=(key:string)=>get(key)?.status==='READY'?get(key)!.value:null;
 const metric=(definition:MetricDefinition,value:SalesWindowResult):MetricOutcome=>({key:definition.key,definition,lineage:{...lineage(definition),...(value.status==='READY'&&value.exactValue?{exactValue:value.exactValue,aggregation:definition.key==='SALES_MOVING_30D_AVERAGE'?'RATIO':'ADDITIVE'}:{})},status:value.status,value:value.value,reason:value.status==='UNAVAILABLE'?value.reason:null});
 // Preserve non-time selected filters across the full loaded history.
 const nonTime=(ctx.appliedFilters??[]).filter(f=>f.type!=='DATE_RANGE');
 const filteredHistory=allHistory.filter(row=>nonTime.every(f=>f.type==='MISSING'?row[f.field]===null||row[f.field]===undefined:row[f.field]!==null&&row[f.field]!==undefined&&String(row[f.field])===f.value));
 let series:SalesDay[]|null=null,invalidReason:string|null=null,observedStart:string|null=null;
 if(ctx.qualityStatus==='FAIL')invalidReason='Uploaded data failed quality validation.';
 else if(!time||!ctx.timezone||!last)invalidReason='Confirm a single transaction date field and business timezone.';
 else if(!historyConfirmed)invalidReason='Confirm that the loaded sales history covers all calendar days, including days with no transactions.';
 else if(!filteredHistory.length)invalidReason='No eligible sales history for the selected filters.';
 else{
  const grouped=new Map<string,DashboardRow[]>();
  for(const row of filteredHistory){const day=dashboardBusinessDay(row[time],ctx.timezone);if(!day){invalidReason='Sales history contains invalid business dates.';break;}const group=grouped.get(day)??[];group.push(row);grouped.set(day,group);}
  if(!invalidReason){
   observedStart=[...grouped.keys()].sort()[0]??null;
   const start=observedStart?dayNumber(observedStart):0,end=dayNumber(last);
   if(!observedStart||end<start||end-start>3659)invalidReason='Confirmed history must contain the reporting end date and no more than ten years of daily periods.';
   else{
    series=[];
    for(let n=start;n<=end;n++){
     const day=isoDate(n),dailyRows=grouped.get(day)??[];
     if(!dailyRows.length){series.push({date:day,revenue:0,exactRevenue:'0'});continue;}
     const revenue=calculateDashboardMetrics({...ctx,rows:dailyRows,appliedFilters:[]},semantics).find(m=>m.key==='REVENUE');
     if(revenue?.status!=='READY'||revenue.value===null){invalidReason='Historical sales revenue could not be validated for every transaction date.';break;}
     series.push({date:day,revenue:revenue.value,exactRevenue:revenue.lineage.exactValue});
    }
   }
  }
 }
 return SALES_EXTENDED_DEFINITIONS.map(def=>{
  if(ctx.qualityStatus==='FAIL')return metric(def,unavailable('Uploaded data failed quality validation.'));
  if(def.key==='SALES_CONTRIBUTION_SHARE'||def.key==='SALES_REVENUE_RANK'){
   const groupFilters=(ctx.appliedFilters??[]).filter(f=>f.type==='CATEGORY');
   if(groupFilters.length!==1)return metric(def,unavailable('Apply exactly one confirmed category filter to select a segment for contribution or ranking.'));
   const group=groupFilters[0],selected=ready('REVENUE');
   if(selected===null||!ctx.mappings.some(m=>m.sourceField===group.field&&m.role!=='IGNORE'&&['CONFIRMED','AUTO_CONFIRMED'].includes(m.status)))return metric(def,unavailable('Confirm segment dimension and governed revenue.'));
   const otherFilters=(ctx.appliedFilters??[]).filter(f=>f!==group);
   const population=allHistory.filter(row=>otherFilters.every(f=>f.type==='DATE_RANGE'?Boolean(f.end&&ctx.timezone&&dashboardBusinessDay(row[f.field],ctx.timezone)!>=f.value&&dashboardBusinessDay(row[f.field],ctx.timezone)!<=f.end):f.type==='MISSING'?row[f.field]===null||row[f.field]===undefined:String(row[f.field])===f.value));
   const grouped=new Map<string,DashboardRow[]>();
   for(const row of population){const value=row[group.field];if(value===null||value===undefined||!String(value).trim())return metric(def,unavailable('All segment identities must be present in the reporting population.'));const k=String(value);const arr=grouped.get(k)??[];arr.push(row);grouped.set(k,arr);}
   const values=[] as {id:string;revenue:number}[];
   for(const [id,rows] of grouped){const m=calculateDashboardMetrics({...ctx,rows,appliedFilters:otherFilters},semantics).find(v=>v.key==='REVENUE');if(m?.status!=='READY'||m.value===null)return metric(def,unavailable('All segment revenues must be valid under the same accounting rules.'));values.push({id,revenue:m.value});}
   const ordered=salesRankedSegments(values),total=values.reduce((a,b)=>a+b.revenue,0),chosen=values.find(v=>v.id===group.value);
   if(!ordered||!chosen||!Number.isFinite(total)||total<=0)return metric(def,unavailable('Valid comparable segment totals with positive overall sales are required.'));
   if(def.key==='SALES_CONTRIBUTION_SHARE')return metric(def,{status:'READY',value:selected/total});
   return metric(def,{status:'READY',value:values.filter(v=>v.revenue>chosen.revenue).length+1});
  }
  if(def.key==='SALES_DISCOUNT_RATE'||def.key==='SALES_REFUND_RATE'||def.key==='SALES_RETURN_RATE'){
   const needed=def.key==='SALES_DISCOUNT_RATE'?['DISCOUNT','PRE_DISCOUNT_SALES']:def.key==='SALES_REFUND_RATE'?['REFUND','REFUND_ELIGIBLE_SALES']:['RETURN_QUANTITY','GROSS_SOLD_QUANTITY'];
   const confirmed=def.key==='SALES_DISCOUNT_RATE'?options.salesDiscountBasisConfirmed:def.key==='SALES_REFUND_RATE'?options.salesRefundBasisConfirmed:options.salesReturnBasisConfirmed;
   if(confirmed!==true)return metric(def,unavailable('Confirm the numerator and denominator describe the same sales population and period, with no duplicated amounts.'));
   if(needed.some(key=>!field(key)))return metric(def,unavailable('Confirm distinct source columns for the required numerator and denominator.'));
   if(def.key!=='SALES_RETURN_RATE'&&(ctx.currencyMode!=='SINGLE'||!ctx.currency))return metric(def,unavailable('Confirm one sales currency and its monetary amounts.'));
   if(def.key!=='SALES_RETURN_RATE'&&['ORDER_ITEM','INVOICE_ITEM'].includes(ctx.grain)&&semantics.rowAmountsConfirmed!==true)return metric(def,unavailable('Confirm monetary amounts are per line rather than repeated order or invoice totals.'));
   if(semantics.cancellationTreatment==='UNKNOWN')return metric(def,unavailable('Confirm cancelled-order treatment before computing rates.'));
   if(get('REVENUE')?.status!=='READY')return metric(def,unavailable('The associated net sales revenue definition must be validated.'));
   if(def.key==='SALES_RETURN_RATE'&&semantics.returnTreatment==='UNKNOWN')return metric(def,unavailable('Confirm whether sales quantities already exclude returns.'));
   let rows=ctx.rows;
   if(semantics.cancellationTreatment==='EXCLUDE_ROWS'){
    const status=field('STATUS');
    if(ctx.grain!=='ORDER'||!status)return metric(def,unavailable('Cancelled-row exclusion requires order-grain data and one confirmed status.'));
    const known=new Set(['CANCELLED','CANCELED','VOID','VOIDED','COMPLETE','COMPLETED','PAID','FULFILLED','SHIPPED','PROCESSING','PENDING','OPEN']);
    if(rows.some(row=>!known.has(String(row[status]).trim().toUpperCase())))return metric(def,unavailable('Unrecognized order statuses must be resolved.'));
    rows=rows.filter(row=>!['CANCELLED','CANCELED','VOID','VOIDED'].includes(String(row[status]).trim().toUpperCase()));
   }
   const projected=projectDashboardBusinessRows(rows,ctx.mappings);
   let numerator=0,denominator=0;
   for(const row of projected){
    const a=row[needed[0]],b=row[needed[1]];
    if(typeof a!=='number'||typeof b!=='number'||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0)
     return metric(def,unavailable('Numerator and denominator values must be complete, finite, and nonnegative.'));
    numerator+=a;denominator+=b;
   }
   if(!Number.isFinite(numerator)||!Number.isFinite(denominator))return metric(def,unavailable('Sales totals exceed supported numeric precision.'));
   if(def.key==='SALES_RETURN_RATE'&&(projected.some(row=>!Number.isSafeInteger(row[needed[0]] as number)||!Number.isSafeInteger(row[needed[1]] as number))))
    return metric(def,unavailable('Gross sold and returned quantities must be confirmed whole units.'));
   const answer=def.key==='SALES_DISCOUNT_RATE'?salesDiscountRate(numerator,denominator):def.key==='SALES_REFUND_RATE'?salesRefundRate(numerator,denominator):salesReturnRate(numerator,denominator);
   return metric(def,answer);
  }
  if(def.key==='SALES_TOP_N_CONCENTRATION'){
   const concept=options.salesConcentrationConcept,n=options.salesTopN;
   if(!concept||!Number.isSafeInteger(n)||!n||n<1||n>100)return metric(def,unavailable('Confirm a business grouping dimension and a top-N count between 1 and 100.'));
   const dimension=field(concept),net=ready('REVENUE');
   if(!dimension||net===null)return metric(def,unavailable('Confirm the selected grouping dimension and governed net revenue.'));
   if(!ctx.rows.length)return metric(def,unavailable('No sales records match the selected filters.'));
   const groups=new Map<string,DashboardRow[]>();
   for(const row of ctx.rows){const v=row[dimension];if(v===null||v===undefined||!String(v).trim())return metric(def,unavailable('Group identifiers cannot be missing.'));const id=String(v),list=groups.get(id)??[];list.push(row);groups.set(id,list);}
   const entries=[] as {id:string;revenue:number}[];
   for(const [id,rows] of groups){const outcome=calculateDashboardMetrics({...ctx,rows},semantics).find(x=>x.key==='REVENUE');if(outcome?.status!=='READY'||outcome.value===null)return metric(def,unavailable('A grouped revenue amount cannot be validated.'));entries.push({id,revenue:outcome.value});}
   const result=salesTopNConcentration(entries,n);
   return metric(def,result);
  }

  if(['SALES_FORECAST_MAE','SALES_FORECAST_RMSE','SALES_FORECAST_WAPE','SALES_FORECAST_GROWTH'].includes(def.key)){
   const season=options.salesForecastSeasonDays,horizon=options.salesForecastHorizonDays;
   if(!historyConfirmed||options.salesForecastBasisConfirmed!==true||!series||invalidReason||ready('REVENUE')===null)
    return metric(def,unavailable('Confirm complete consecutive daily sales history, consistent net revenue and forecast cadence.'));
   if(!season||!Number.isSafeInteger(season)||!horizon||!Number.isSafeInteger(horizon)||horizon>season)
    return metric(def,unavailable('Confirm valid seasonal cadence and a horizon no longer than the season.'));
   // Historical holdout is strictly earlier than the forecast origin, so no future observations leak into the forecast.
   const result=salesSeasonalNaiveForecast(series.map(v=>v.revenue),season,horizon);
   if(result.status!=='READY')return metric(def,unavailable(result.reason));
   if(def.key==='SALES_FORECAST_MAE')return metric(def,result.backtest.status==='READY'?{status:'READY',value:result.backtest.mae}:unavailable('Holdout validation failed.'));
   if(def.key==='SALES_FORECAST_RMSE')return metric(def,result.backtest.status==='READY'?{status:'READY',value:result.backtest.rmse}:unavailable('Holdout validation failed.'));
   if(def.key==='SALES_FORECAST_WAPE')
    return metric(def,result.backtest.status==='READY'&&result.backtest.wape!==null?{status:'READY',value:result.backtest.wape}:unavailable('Forecast holdout actual revenue has a zero denominator.'));
   const previous=series.slice(-horizon).reduce((a,v)=>a+v.revenue,0),next=result.forecast.reduce((a,v)=>a+v,0);
   if(previous<=0)return metric(def,unavailable('Recent horizon revenue must be positive for forecast growth.'));
   return metric(def,{status:'READY',value:next/previous-1});
  }
  if(def.key==='SALES_COHORT_REVENUE_PER_ACTIVE_CUSTOMER'){
   const customer=field('CUSTOMER'),order=field('ORDER'),timeField=field('TIME'),cohort=options.salesCohortMonth;
   if(!historyConfirmed||!cohort||!/^\d{4}-(0[1-9]|1[0-2])$/.test(cohort)||!customer||!order||!timeField||!ctx.timezone)
    return metric(def,unavailable('Confirm complete purchase history and select a first-purchase cohort month.'));
   if(ready('REVENUE')===null||ctx.currencyMode!=='SINGLE')return metric(def,unavailable('Confirm one net revenue currency for the selected period.'));
   const first=new Map<string,string>(),orderOwners=new Map<string,string>();
   const history=allHistory.filter(row=>(ctx.appliedFilters??[]).filter(f=>f.type!=='DATE_RANGE'&&f.field!==customer).every(f=>f.type==='MISSING'?row[f.field]===null||row[f.field]===undefined:String(row[f.field])===f.value));
   for(const row of history){
    const c=row[customer],o=row[order],day=dashboardBusinessDay(row[timeField],ctx.timezone);
    if(c===null||c===undefined||!String(c).trim()||o===null||o===undefined||!String(o).trim()||!day)return metric(def,unavailable('Customer, order and purchase-date history must be complete.'));
    const id=String(c),orderId=String(o),owner=orderOwners.get(orderId);
    if(owner&&owner!==id)return metric(def,unavailable('Order IDs must not refer to conflicting customers.'));
    orderOwners.set(orderId,id);
    if(!first.has(id)||day<first.get(id)!)first.set(id,day);
   }
   const members=new Set([...first].filter(([,day])=>day.slice(0,7)===cohort).map(([id])=>id));
   const active=ctx.rows.filter(row=>members.has(String(row[customer])));
   const customers=new Set(active.map(row=>String(row[customer])));
   if(!active.length||!customers.size)return metric(def,unavailable('No active customers from this cohort in the selected reporting period.'));
   const revenue=calculateDashboardMetrics({...ctx,rows:active},semantics).find(m=>m.key==='REVENUE');
   if(revenue?.status!=='READY'||revenue.value===null)return metric(def,unavailable('The selected cohort revenue cannot be validated.'));
   return metric(def,salesCohortRevenuePerActiveCustomer(revenue.value,customers.size));
  }
  if(def.key==='SALES_VOLATILITY'){
   if(options.salesVolatilityPeriodConfirmed!==true)return metric(def,unavailable('Confirm complete daily sales history and consistent calendar-day observation periods.'));
   const dates=(ctx.appliedFilters??[]).filter(f=>f.type==='DATE_RANGE');
   if(!time||dates.length!==1||!dates[0].end||dates[0].field!==time||!series||invalidReason)return metric(def,unavailable(invalidReason??'Confirm a selected date range and complete business-day history.'));
   const begin=dayNumber(dates[0].value),end=dayNumber(dates[0].end);
   if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||end<=begin)return metric(def,unavailable('At least two consecutive calendar days are required.'));
   const byDay=new Map(series.map(entry=>[entry.date,entry.revenue]));
   const values:number[]=[];
   for(let n=begin;n<=end;n++){
    const value=byDay.get(isoDate(n));if(value===undefined)return metric(def,unavailable('The reporting period has incomplete daily observations.'));
    values.push(value);
   }
   if(ready('REVENUE')===null)return metric(def,unavailable('Confirm governed net revenue.'));
   return metric(def,salesVolatility(values));
  }
  if(def.key==='SALES_GROWTH_CONTRIBUTION'){
   if(options.salesGrowthContributionBasisConfirmed!==true)return metric(def,unavailable('Confirm the selected segment, complete comparison periods and comparable revenue bases.'));
   const dateFilters=(ctx.appliedFilters??[]).filter(f=>f.type==='DATE_RANGE'),categoryFilters=(ctx.appliedFilters??[]).filter(f=>f.type==='CATEGORY');
   if(dateFilters.length!==1||categoryFilters.length!==1||!time||!ctx.timezone||dateFilters[0].field!==time||!dateFilters[0].end||!field('REVENUE'))
    return metric(def,unavailable('Select exactly one date range and one confirmed segment filter.'));
   const start=dayNumber(dateFilters[0].value),end=dayNumber(dateFilters[0].end),span=end-start+1;
   if(!Number.isSafeInteger(span)||span<1||span>3660)return metric(def,unavailable('Invalid comparison period.'));
   const priorStart=isoDate(start-span),priorEnd=isoDate(start-1);
   const segment=categoryFilters[0];
   if(!ctx.mappings.some(m=>m.sourceField===segment.field&&m.status==='CONFIRMED'&&m.role!=='IGNORE'))return metric(def,unavailable('Confirm the segment dimension.'));
   const other=(ctx.appliedFilters??[]).filter(f=>f!==segment&&f.type!=='DATE_RANGE');
   const selected=allHistory.filter(row=>other.every(f=>f.type==='MISSING'?row[f.field]===null||row[f.field]===undefined:String(row[f.field])===f.value));
   const sum=(from:string,to:string,segmentOnly:boolean):number|null=>{
    const rows=selected.filter(row=>{const day=dashboardBusinessDay(row[time],ctx.timezone!);return day!==null&&day>=from&&day<=to&&(!segmentOnly||String(row[segment.field])===segment.value);});
    if(!rows.length)return 0;
    const outcome=calculateDashboardMetrics({...ctx,rows,appliedFilters:[]},semantics).find(m=>m.key==='REVENUE');
    return outcome?.status==='READY'?outcome.value:null;
   };
   const totalOld=sum(priorStart,priorEnd,false),totalNow=sum(dateFilters[0].value,dateFilters[0].end,false),segmentOld=sum(priorStart,priorEnd,true),segmentNow=sum(dateFilters[0].value,dateFilters[0].end,true);
   if([totalOld,totalNow,segmentOld,segmentNow].some(v=>v===null))return metric(def,unavailable('Comparable governed revenue could not be calculated for all four populations.'));
   return metric(def,salesGrowthContribution(segmentNow!-segmentOld!,totalNow!-totalOld!));
  }
  if(def.key==='SALES_AVG_CYCLE_DAYS'){
   if(options.salesCycleBasisConfirmed!==true||options.salesOpportunityCohortConfirmed!==true)return metric(def,unavailable('Confirm a complete opportunity cohort and open-to-close calendar-date basis.'));
   const id=field('SALES_OPPORTUNITY_ID'),stage=field('SALES_OPPORTUNITY_STAGE'),qualified=field('SALES_OPPORTUNITY_QUALIFIED'),opened=field('SALES_OPPORTUNITY_OPENED'),closed=field('SALES_OPPORTUNITY_CLOSED');
   if(!id||!stage||!qualified||!opened||!closed||!ctx.timezone)return metric(def,unavailable('Confirm CRM opportunity identities, stage, qualification, opening and closing dates, and business timezone.'));
   const seen=new Set<string>(),elapsed:number[]=[];
   for(const row of ctx.rows){
    const key=row[id];if(key===null||key===undefined||!String(key).trim()||seen.has(String(key)))return metric(def,unavailable('Opportunity IDs must be complete and unique.'));seen.add(String(key));
    const st=String(row[stage]??'').trim().toUpperCase(),q=row[qualified];
    if(!['WON','LOST','OPEN'].includes(st)||(q!==true&&q!==false&&q!==1&&q!==0))return metric(def,unavailable('Opportunity stages and qualification flags are invalid.'));
    if(!(q===true||q===1)||st==='OPEN')continue;
    const first=dashboardBusinessDay(row[opened],ctx.timezone),lastDay=dashboardBusinessDay(row[closed],ctx.timezone);
    if(!first||!lastDay||lastDay<first)return metric(def,unavailable('Qualified closed opportunities need valid opening and closing dates in chronological order.'));
    elapsed.push(dayNumber(lastDay)-dayNumber(first));
   }
   return metric(def,salesAverageCycleDays(elapsed));
  }
  if(def.key==='SALES_PRICE_EFFECT'||def.key==='SALES_VOLUME_EFFECT'||def.key==='SALES_PRODUCT_MIX_EFFECT'){
   if(options.salesPriceVolumeBasisConfirmed!==true)return metric(def,unavailable('Confirm comparable product units, net sales and identical products for both periods.'));
   const product=field('PRODUCT'),timeField=field('TIME'),quantity=field('QUANTITY'),dateFilters=(ctx.appliedFilters??[]).filter(f=>f.type==='DATE_RANGE');
   if(!product||!timeField||!quantity||ctx.currencyMode!=='SINGLE'||!ctx.currency||!ctx.timezone||dateFilters.length!==1||!dateFilters[0].end||dateFilters[0].field!==timeField)
    return metric(def,unavailable('Confirm single currency, product, quantity, date and an explicit reporting period.'));
   if(!['ORDER_ITEM','INVOICE_ITEM'].includes(ctx.grain)||semantics.rowAmountsConfirmed!==true)return metric(def,unavailable('Comparable product sales require confirmed line-item revenue and quantities.'));
   const start=dayNumber(dateFilters[0].value),end=dayNumber(dateFilters[0].end),duration=end-start+1;
   if(!Number.isFinite(duration)||duration<1||duration>3660)return metric(def,unavailable('Reporting date range must be valid.'));
   const previousStart=isoDate(start-duration),previousEnd=isoDate(start-1);
   const otherFilters=(ctx.appliedFilters??[]).filter(f=>f.type!=='DATE_RANGE');
   const selected=allHistory.filter(row=>{
    if(!otherFilters.every(f=>f.type==='MISSING'?row[f.field]===null||row[f.field]===undefined:String(row[f.field])===f.value))return false;
    const day=dashboardBusinessDay(row[timeField],ctx.timezone!);
    return !!day&&day>=previousStart&&day<=dateFilters[0].end!;
   });
   const groups=(rangeStart:string,rangeEnd:string):SalesProductPeriod[]|null=>{
    const buckets=new Map<string,DashboardRow[]>();
    for(const row of selected){
     const day=dashboardBusinessDay(row[timeField],ctx.timezone!);if(!day||day<rangeStart||day>rangeEnd)continue;
     const p=row[product];if(p===null||p===undefined||!String(p).trim())return null;
     const key=String(p),arr=buckets.get(key)??[];arr.push(row);buckets.set(key,arr);
    }
    const totals:SalesProductPeriod[]=[];
    for(const [key,rows] of buckets){
     const outcomes=calculateDashboardMetrics({...ctx,rows,appliedFilters:[]},semantics);
     const amount=outcomes.find(m=>m.key==='REVENUE'),units=outcomes.find(m=>m.key==='UNITS');
     if(amount?.status!=='READY'||units?.status!=='READY'||amount.value===null||units.value===null)return null;
     totals.push({product:key,revenue:amount.value,quantity:units.value});
    }
    return totals;
   };
   const prior=groups(previousStart,previousEnd),current=groups(dateFilters[0].value,dateFilters[0].end);
   if(!prior||!current)return metric(def,unavailable('Product totals are incomplete or unconfirmed.'));
   const result=salesPriceVolumeDecomposition(prior,current);
   if(result.status!=='READY')return metric(def,unavailable(result.reason));
   if(def.key==='SALES_PRICE_EFFECT')return metric(def,{status:'READY',value:result.priceEffect});
   if(def.key==='SALES_PRODUCT_MIX_EFFECT'){
    const previousTotal=prior.reduce((sum,item)=>sum+item.quantity,0),currentTotal=current.reduce((sum,item)=>sum+item.quantity,0);
    if(previousTotal<=0||currentTotal<=0)return metric(def,unavailable('Both periods require positive comparable total units.'));
    const previousMap=new Map(prior.map(item=>[item.product,item]));
    const mix=current.reduce((sum,item)=>{
     const baseline=previousMap.get(item.product)!;
     return sum+(item.quantity-currentTotal*baseline.quantity/previousTotal)*(baseline.revenue/baseline.quantity);
    },0);
    return metric(def,Number.isFinite(mix)?{status:'READY',value:mix}:unavailable('Product mix calculation is invalid.'));
   }
   return metric(def,{status:'READY',value:result.volumeEffect});
  }
  if(def.key==='SALES_CONVERSION_RATE'||def.key==='SALES_PIPELINE_COVERAGE'||def.key==='SALES_WIN_RATE'){
   if(options.salesOpportunityCohortConfirmed!==true)return metric(def,unavailable('Confirm one complete, deduplicated opportunity cohort with explicitly defined qualification and outcomes.'));
   const id=field('SALES_OPPORTUNITY_ID'),stage=field('SALES_OPPORTUNITY_STAGE'),qualified=field('SALES_OPPORTUNITY_QUALIFIED');
   if(!id||!stage||!qualified)return metric(def,unavailable('Confirm opportunity ID, opportunity stage, and qualified flag mappings.'));
   if(!ctx.rows.length)return metric(def,unavailable('No opportunities in the selected population.'));
   const opportunities=new Set<string>();let won=0,lost=0,eligible=0,openValue=0;
   const pipelineField=field('SALES_OPEN_PIPELINE_VALUE');
   if(def.key==='SALES_PIPELINE_COVERAGE'){
    if(options.salesPipelineSnapshotConfirmed!==true||!pipelineField||ctx.currencyMode!=='SINGLE'||!ctx.currency)
     return metric(def,unavailable('Confirm one consistent pipeline snapshot, its opportunity-value field, and currency.'));
    const dateFilters=(ctx.appliedFilters??[]).filter(f=>f.type==='DATE_RANGE');
    if(options.salesPlanningBasisConfirmed!==true||!Number.isFinite(options.salesTargetAmount)||!(options.salesTargetAmount!>0)||dateFilters.length!==1||
      dateFilters[0].field!==field('TIME')||dateFilters[0].value!==options.salesPlanningPeriodStart||dateFilters[0].end!==options.salesPlanningPeriodEnd||
      (ctx.appliedFilters??[]).some(f=>f.type!=='DATE_RANGE'))
     return metric(def,unavailable('Confirm a positive sales target for the selected pipeline horizon and matching unsegmented period.'));
   }
   for(const row of ctx.rows){
    const identity=row[id],rawStage=row[stage],rawQualified=row[qualified];
    if(identity===null||identity===undefined||!String(identity).trim()||typeof identity==='number'&&!Number.isSafeInteger(identity))
     return metric(def,unavailable('Opportunity identifiers must be complete and precise.'));
    const key=String(identity);if(opportunities.has(key))return metric(def,unavailable('Each opportunity must occur once; duplicated snapshot rows would overcount opportunities.'));
    opportunities.add(key);
    const st=typeof rawStage==='string'?rawStage.trim().toUpperCase():null;
    if(!st||!['WON','LOST','OPEN'].includes(st))return metric(def,unavailable('Opportunity stages must be explicitly WON, LOST, or OPEN.'));
    if(rawQualified!==true&&rawQualified!==false&&rawQualified!==1&&rawQualified!==0)
     return metric(def,unavailable('Qualification flag must be true/false or 1/0.'));
    const q=rawQualified===true||rawQualified===1;if(q)eligible++;
    if(q&&st==='WON')won++;
    if(q&&st==='LOST')lost++;
    if(def.key==='SALES_PIPELINE_COVERAGE'){
     const amount=row[pipelineField!];
     if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0)return metric(def,unavailable('Pipeline values must be complete, nonnegative and finite.'));
     if(q&&st==='OPEN')openValue+=amount;
    }
   }
   const answer=def.key==='SALES_CONVERSION_RATE'?salesConversionRate(won,eligible):
     def.key==='SALES_WIN_RATE'?salesWinRate(won,lost):salesPipelineCoverage(openValue,options.salesTargetAmount!);
   return metric(def,answer);
  }
  if(def.key==='SALES_PER_REPRESENTATIVE'||def.key==='SALES_REVENUE_PER_TRANSACTION'){
   const identifierField=field(def.key==='SALES_PER_REPRESENTATIVE'?'SALES_REPRESENTATIVE':'IDENTIFIER'),revenue=ready('REVENUE');
   if(!identifierField||revenue===null)return metric(def,unavailable('Confirm net revenue and a unique source field containing the appropriate representative or transaction identifiers.'));
   if(def.key==='SALES_PER_REPRESENTATIVE'&&options.salesRepresentativeAttributionConfirmed!==true)return metric(def,unavailable('Confirm that each revenue amount is attributed once to the accountable representative, without duplicated attribution.'));
   const ids=new Set<string>();
   for(const row of ctx.rows){const id=row[identifierField];if(id===null||id===undefined||!String(id).trim()||typeof id==='number'&&!Number.isSafeInteger(id))return metric(def,unavailable('Every selected record must have a complete, precise representative or transaction identity.'));ids.add(String(id));}
   return metric(def,def.key==='SALES_PER_REPRESENTATIVE'?salesPerRepresentative(revenue,ids.size):salesRevenuePerTransaction(revenue,ids.size));
  }
  if(def.key==='SALES_TARGET_ATTAINMENT'||def.key==='SALES_BUDGET_VARIANCE'||def.key==='SALES_PER_SELLING_DAY'){
   const revenue=ready('REVENUE'),dates=(ctx.appliedFilters??[]).filter(f=>f.type==='DATE_RANGE'),start=options.salesPlanningPeriodStart,end=options.salesPlanningPeriodEnd;
   if(revenue===null)return metric(def,unavailable('The uploaded sales revenue is not confirmed.'));
   if(options.salesPlanningBasisConfirmed!==true||dates.length!==1||!dates[0].end||dates[0].value!==start||dates[0].end!==end||!ctx.timezone||!field('TIME')||dates[0].field!==field('TIME'))
    return metric(def,unavailable('Confirm the exact reporting period and that the target, budget or selling-day count refers to that same period and population.'));
   if((ctx.appliedFilters??[]).some(f=>f.type!=='DATE_RANGE'))return metric(def,unavailable('Targets, budgets and selling-day counts cannot be applied to category-filtered sales without segment-specific planning values.'));
   if(def.key==='SALES_TARGET_ATTAINMENT')return metric(def,options.salesTargetAmount===undefined?unavailable('Confirm the matching positive sales target.'):salesTargetAttainment(revenue,options.salesTargetAmount));
   if(def.key==='SALES_BUDGET_VARIANCE')return metric(def,options.salesBudgetAmount===undefined?unavailable('Confirm the matching nonnegative revenue budget.'):salesBudgetVariance(revenue,options.salesBudgetAmount));
   const length=Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
   const eligible=options.salesEligibleSellingDays;
   if(typeof eligible!=='number'||!Number.isSafeInteger(eligible)||eligible<1||eligible>length)return metric(def,unavailable('Eligible selling days must be between one and the number of calendar days in the confirmed period.'));
   return metric(def,salesPerSellingDay(revenue,eligible));
  }
  if(def.key==='SALES_REVENUE_PER_CUSTOMER'){
   const a=ready('REVENUE'),b=ready('CUSTOMERS');
   return metric(def,a!==null&&b!==null?salesRevenuePerCustomer(a,b):unavailable('Confirm governed revenue and distinct customer identities.'));
  }
  if(def.key==='SALES_UNITS_PER_ORDER'){
   const a=ready('UNITS'),b=ready('ORDERS');
   return metric(def,a!==null&&b!==null?salesUnitsPerOrder(a,b):unavailable('Confirm governed units and distinct order identities.'));
  }
  if(invalidReason||!series||!last||!observedStart)return metric(def,unavailable(invalidReason??'Sales history unavailable.'));
  if(ready('REVENUE')===null)return metric(def,unavailable('The selected sales revenue definition has not been confirmed.'));
  let result:SalesWindowResult;
  switch(def.key){
   case 'SALES_MTD':result=salesToDate(series,last,'MONTH',ctx.arithmetic);break;
   case 'SALES_QTD':result=salesToDate(series,last,'QUARTER',ctx.arithmetic);break;
   case 'SALES_YTD':result=salesToDate(series,last,'YEAR',ctx.arithmetic);break;
   case 'SALES_ROLLING_30D':result=salesRollingRevenue(series,last,30,ctx.arithmetic);break;
   case 'SALES_ROLLING_12M':{
    const year=Number(last.slice(0,4)),month=Number(last.slice(5,7)),day=Number(last.slice(8,10));
    // Match calendar anniversaries, aligning month ends across leap years.
    const currentMonthEnd=new Date(Date.UTC(year,month,0)).getUTCDate();
    const priorMonthEnd=new Date(Date.UTC(year-1,month,0)).getUTCDate();
    const priorDay=day===currentMonthEnd?priorMonthEnd:Math.min(day,priorMonthEnd);
    const date=new Date(Date.UTC(year-1,month-1,priorDay+1));
    const begin=isoDate(Math.max(dayNumber(observedStart),Math.trunc(date.getTime()/86400000)));
    if(begin!==date.toISOString().slice(0,10))result=unavailable('Twelve calendar months of confirmed history are required.');
    else result=salesRollingRevenue(series,last,dayNumber(last)-dayNumber(begin)+1,ctx.arithmetic);
    break;
   }
   case 'SALES_MOVING_30D_AVERAGE':result=salesMovingDailyAverage(series,last,30,ctx.arithmetic);break;
   case 'SALES_CUMULATIVE':result=salesRollingRevenue(series,last,dayNumber(last)-dayNumber(observedStart)+1,ctx.arithmetic);break;
   case 'SALES_CAGR':{
    const firstYear=Number(observedStart.slice(0,4)),lastYear=Number(last.slice(0,4));
    const fullYears=[] as {year:number;revenue:number}[];
    for(let year=firstYear;year<=lastYear;year++){
     const start=year+'-01-01',end=year+'-12-31';
     if(observedStart>start||last<end)continue;
     const amount=salesPeriodRevenue(series,{start,end},ctx.arithmetic);
     if(amount.status==='READY')fullYears.push({year,revenue:amount.value});
    }
    result=fullYears.length>=2&&fullYears.at(-1)!.year>fullYears[0].year?salesCagr(fullYears[0].revenue,fullYears.at(-1)!.revenue,fullYears.at(-1)!.year-fullYears[0].year):unavailable('At least two complete calendar years of confirmed sales history are required.');
    break;
   }
   default:result=unavailable('Unsupported sales calculation.');
  }
  return metric(def,result);
 });
}
