import type {MetricOutcome} from '../metrics/metric-engine';
import type {AnalysisConfirmation,AnalysisQuery} from '../analysis/query-contracts';
import type {SalesAnswers,SalesQuestion} from './contracts';
export type SalesAvailability={kind:'AVAILABLE'|'MISSING_FIELD'|'AMBIGUOUS_FIELD'|'BUSINESS_DETAIL'|'SOURCE_QUALITY'|'NO_MATCHING_ROWS'|'UNSUPPORTED_INPUT';message:string;action:'NONE'|'CORRECT_FIELDS'|'ANSWER_QUESTIONS'|'CHECK_SOURCE'|'CHANGE_FILTERS'|'MORE_INSIGHTS'|'REVIEW_ANSWERS'};
export const salesRecoveryTarget={REVIEW_ANSWERS:'sales-saved-answers',NONE:'sales-results',CORRECT_FIELDS:'sales-corrections',ANSWER_QUESTIONS:'sales-questions',CHECK_SOURCE:'sales-source-checks',CHANGE_FILTERS:'sales-filters',MORE_INSIGHTS:'sales-insights'} as const;
export const salesRecoveryLabel={REVIEW_ANSWERS:'Review saved business answers',NONE:'View results',CORRECT_FIELDS:'Review matching columns',ANSWER_QUESTIONS:'Answer this detail',CHECK_SOURCE:'Review source issues',CHANGE_FILTERS:'Clear filters',MORE_INSIGHTS:'Review insight requirements'} as const;
type Field={role:string;name:string;type?:string;valid?:boolean};
const canonical=(role:string)=>({GROSS:'PRE_DISCOUNT_SALES',TRANSACTION:'IDENTIFIER'} as Record<string,string>)[role]??role;
/** Classify from dependencies, source facts and configuration, never explanation wording. */
export function salesAvailability(metric:MetricOutcome,confirmation:AnalysisConfirmation,questions:readonly Pick<SalesQuestion,'key'|'label'|'optional'>[],fields:readonly Field[],context:{quality?:string;rows?:number;query?:AnalysisQuery;answers?:SalesAnswers}={}):SalesAvailability{
 const result=(kind:SalesAvailability['kind'],action:SalesAvailability['action'],message:string):SalesAvailability=>({kind,action,message});
 if(metric.status==='READY')return result('AVAILABLE','NONE','Calculated from the selected source.');
 const population=questions.find(q=>['excludeSummaryRows','excludeNonSalesStatuses','reportingCurrency'].includes(q.key)&&!q.optional);if(population)return result('BUSINESS_DETAIL','ANSWER_QUESTIONS',population.label);
 if(context.quality==='FAIL')return result('SOURCE_QUALITY','CHECK_SOURCE','Source checks failed. Review duplicate records, row identities and invalid values before calculating this result.');
 if((context.rows??metric.lineage.rowCount)===0)return result('NO_MATCHING_ROWS',context.query?.filters.length?'CHANGE_FILTERS':'CHECK_SOURCE','No eligible records are available for this selection.');
 const required=metric.definition.requires,rules=confirmation.metricRules;
 const relevant=questions.filter(q=>!q.optional&&(
 ['currency','recordedNet','deriveNet','discountsAlreadyApplied','refundsAlreadyApplied','taxExcluded','deliveryExcluded'].includes(q.key)&&required.includes('REVENUE')||
 q.key==='profitIsGross'&&required.includes('COST')||q.key==='costIsProductCost'&&['PROFIT','GROSS_MARGIN'].includes(metric.key)||
 ['transactionDateField','dateFormat','dateLocale','timezone'].includes(q.key)&&required.includes('TIME')||q.key==='quantityNet'&&required.includes('QUANTITY')||
 q.key==='lineAmounts'&&required.some(c=>['REVENUE','COST'].includes(c))||q.key==='numberFormat'&&required.some(c=>['REVENUE','COST','QUANTITY'].includes(c))));
 const missing=required.filter(c=>!confirmation.confirmedMappings.some(m=>m.canonicalConcept===c));
 if(relevant.some(q=>q.key==='profitIsGross'&&missing.includes('COST')||q.key==='deriveNet'&&missing.includes('REVENUE')))return result('BUSINESS_DETAIL','ANSWER_QUESTIONS',relevant.map(q=>q.label).join(' '));
 const ambiguous=required.some(c=>confirmation.confirmedMappings.filter(m=>m.canonicalConcept===c).length>1||missing.includes(c)&&fields.filter(f=>canonical(f.role)===c).length>1);
 if(ambiguous)return result('AMBIGUOUS_FIELD','CORRECT_FIELDS','Several columns could supply this result. Choose the intended business field and mark the alternatives appropriately.');
 const genuinelyMissing=missing.filter(c=>!fields.some(f=>canonical(f.role)===c));
 if(genuinelyMissing.length)return result('MISSING_FIELD','CORRECT_FIELDS',`A usable ${genuinelyMissing.map(c=>c.toLowerCase().replaceAll('_',' ')).join(' and ')} field is needed. Correct a matching column or upload the required data.`);
 if(relevant.length)return result('BUSINESS_DETAIL','ANSWER_QUESTIONS',relevant.map(q=>q.label).join(' '));
 const invalid=fields.filter(f=>f.valid===false&&required.includes(canonical(f.role)));
 if(invalid.length)return result('SOURCE_QUALITY','CHECK_SOURCE',`Correct missing or invalid values in ${invalid.map(f=>f.name).join(', ')}.`);
 if(missing.length)return result('MISSING_FIELD','CORRECT_FIELDS',`A usable ${missing.map(c=>c.toLowerCase().replaceAll('_',' ')).join(' and ')} field is needed. If it exists, correct its meaning; otherwise upload the required data.`);
 if(rules.currencyMode==='MULTI'&&metric.definition.format!=='COUNT')return result('UNSUPPORTED_INPUT','CHECK_SOURCE','Amounts contain multiple or incomplete currencies. Convert them consistently or upload a single-currency source.');
 if(required.includes('REVENUE')&&rules.revenueBasis!=='NET')for(const [key,role,label] of [['discountsAlreadyApplied','DISCOUNT','discount'],['refundsAlreadyApplied','REFUND','refund'],['taxExcluded','TAX','tax'],['deliveryExcluded','SHIPPING','delivery charge']] as const){if(context.answers?.[key]===false&&!fields.some(f=>f.role===role&&f.valid!==false))return result('MISSING_FIELD','CORRECT_FIELDS',`A complete nonnegative ${label} amount is needed to adjust the recorded sales. Choose its column or supply those amounts.`);}
 if(required.includes('REVENUE')&&rules.revenueBasis!=='NET')return result('BUSINESS_DETAIL','REVIEW_ANSWERS','The recorded sales basis is not confirmed as net sales. Review the saved accounting and row-amount answers, or choose a suitable sales field.');
 if(['PROFIT','GROSS_MARGIN'].includes(metric.key)&&rules.costBasis!=='COGS')return result('BUSINESS_DETAIL','REVIEW_ANSWERS','Gross profit needs the cost of the items sold. Review its saved business meaning or choose an appropriate product-cost field.');
 const customerKeys=['NEW_CUSTOMERS','RETAINED_CUSTOMERS','CUSTOMER_RETENTION_RATE','OBSERVED_CUSTOMER_VALUE','SALES_COHORT_REVENUE_PER_ACTIVE_CUSTOMER'];
 const calendarKeys=['SALES_MTD','SALES_QTD','SALES_YTD','SALES_ROLLING_30D','SALES_ROLLING_12M','SALES_MOVING_30D_AVERAGE','SALES_CUMULATIVE','SALES_CAGR','SALES_VOLATILITY','SALES_GROWTH_CONTRIBUTION','SALES_COHORT_REVENUE_PER_ACTIVE_CUSTOMER'];
 const flag=customerKeys.includes(metric.key)&&!rules.customerHistoryConfirmed?'customerHistory':(calendarKeys.includes(metric.key)||metric.key.startsWith('SALES_FORECAST_'))&&!rules.salesHistoryConfirmed?'salesHistory':null;
 if(flag)return result('BUSINESS_DETAIL',context.answers?.[flag]===false?'REVIEW_ANSWERS':'MORE_INSIGHTS',flag==='customerHistory'?'This insight needs complete customer purchase history. Review the history answer or provide the missing history.':'This insight needs complete sales history over its observation dates. Review the history answer or provide the missing records.');
 if(metric.requiresPeriod||['SALES_PRICE_EFFECT','SALES_VOLUME_EFFECT','SALES_PRODUCT_MIX_EFFECT','SALES_GROWTH_CONTRIBUTION','RETAINED_CUSTOMERS','CUSTOMER_RETENTION_RATE'].includes(metric.key))return result('BUSINESS_DETAIL','CHANGE_FILTERS',metric.reason??'Select the reporting and comparison periods required by this insight.');
 // Optional prerequisites are explicit metric families, not matches against engine prose.
 const family=metric.key.startsWith('SALES_')||['NEW_CUSTOMERS','REPEAT_CUSTOMERS','REPEAT_PURCHASE_RATE','OBSERVED_CUSTOMER_VALUE','PRODUCT_REVENUE_SHARE','PRODUCT_PROFIT_SHARE'].includes(metric.key);
 if(family)return result('BUSINESS_DETAIL','MORE_INSIGHTS',metric.reason??'Review the history, business population or planning inputs required by this insight.');
 if(required.includes('REVENUE')&&rules.revenueBasis!=='NET'||['PROFIT','GROSS_MARGIN'].includes(metric.key)&&rules.costBasis!=='COGS')return result('BUSINESS_DETAIL','MORE_INSIGHTS',metric.reason??'Confirm the sales and product-cost basis.');
 return result('UNSUPPORTED_INPUT','CHECK_SOURCE',metric.reason??'The source does not support this calculation. Review its values and business population.');
}
