/** Pure, input-governed advanced sales measures. No guessed source fields or values. */
export type SalesResult={status:'READY';value:number}|{status:'UNAVAILABLE';value:null;reason:string};
const fail=(reason:string):SalesResult=>({status:'UNAVAILABLE',value:null,reason});
const ok=(value:number):SalesResult=>Number.isFinite(value)?{status:'READY',value}:fail('Non-finite result.');
const nums=(...v:number[])=>v.every(Number.isFinite);
export function salesDiscountRate(discount:number,preDiscountSales:number):SalesResult{
 return nums(discount,preDiscountSales)&&discount>=0&&preDiscountSales>0&&discount<=preDiscountSales?ok(discount/preDiscountSales):fail('Confirm nonnegative discounts and positive pre-discount sales.');
}
export function salesRefundRate(refundedValue:number,eligibleSales:number):SalesResult{
 return nums(refundedValue,eligibleSales)&&refundedValue>=0&&eligibleSales>0&&refundedValue<=eligibleSales?ok(refundedValue/eligibleSales):fail('Refund and eligible-sales definitions must match.');
}
export function salesReturnRate(returnedUnits:number,soldUnits:number):SalesResult{
 return nums(returnedUnits,soldUnits)&&returnedUnits>=0&&soldUnits>0&&returnedUnits<=soldUnits?ok(returnedUnits/soldUnits):fail('Returns must be nonnegative and match the sold-unit period and population.');
}
export function salesPerRepresentative(revenue:number,representatives:number):SalesResult{
 return nums(revenue,representatives)&&Number.isSafeInteger(representatives)&&representatives>0?ok(revenue/representatives):fail('Confirm attributed revenue and eligible representative count.');
}
export function salesTargetAttainment(actual:number,target:number):SalesResult{
 return nums(actual,target)&&target>0?ok(actual/target):fail('Confirm a positive matching-period sales target.');
}
export function salesBudgetVariance(actual:number,budget:number):SalesResult{
 return nums(actual,budget)?ok(actual-budget):fail('Confirm actual sales and matching-period budget.');
}
export function salesPerSellingDay(revenue:number,eligibleDays:number):SalesResult{
 return nums(revenue,eligibleDays)&&Number.isSafeInteger(eligibleDays)&&eligibleDays>0?ok(revenue/eligibleDays):fail('Confirm a positive number of eligible selling days.');
}
export function salesRevenuePerTransaction(revenue:number,distinctTransactions:number):SalesResult{
 return nums(revenue,distinctTransactions)&&Number.isSafeInteger(distinctTransactions)&&distinctTransactions>0?ok(revenue/distinctTransactions):fail('Confirm transaction identities and revenue.');
}
export function salesConversionRate(sales:number,qualifiedOpportunities:number):SalesResult{
 return nums(sales,qualifiedOpportunities)&&Number.isSafeInteger(sales)&&Number.isSafeInteger(qualifiedOpportunities)&&sales>=0&&qualifiedOpportunities>0&&sales<=qualifiedOpportunities?ok(sales/qualifiedOpportunities):fail('Confirm a consistent qualified opportunity cohort and outcome.');
}
export function salesPipelineCoverage(qualifiedPipeline:number,target:number):SalesResult{
 return nums(qualifiedPipeline,target)&&qualifiedPipeline>=0&&target>0?ok(qualifiedPipeline/target):fail('Confirm open qualified pipeline and same-horizon positive target.');
}
export function salesWinRate(won:number,lost:number):SalesResult{
 return nums(won,lost)&&Number.isSafeInteger(won)&&Number.isSafeInteger(lost)&&won>=0&&lost>=0&&won+lost>0?ok(won/(won+lost)):fail('Confirm distinct closed won and lost opportunities.');
}
export function salesAverageCycleDays(elapsedDays:number[]):SalesResult{
 return elapsedDays.length&&elapsedDays.every(x=>nums(x)&&x>=0)?ok(elapsedDays.reduce((a,b)=>a+b,0)/elapsedDays.length):fail('Confirm valid nonnegative opportunity open-to-close durations.');
}
export type SalesProductPeriod={product:string;quantity:number;revenue:number};
export function salesPriceVolumeDecomposition(previous:SalesProductPeriod[],current:SalesProductPeriod[]){
 const invalid=(reason:string)=>({status:'UNAVAILABLE' as const,reason});
 const unique=(items:SalesProductPeriod[])=>new Set(items.map(x=>x.product)).size===items.length;
 if(!previous.length||!current.length||!unique(previous)||!unique(current)||[...previous,...current].some(x=>!x.product.trim()||!nums(x.quantity,x.revenue)||x.quantity<=0||x.revenue<0))
  return invalid('Confirm complete, comparable product revenue and positive quantities for both periods.');
 const a=new Map(previous.map(x=>[x.product,x])),b=new Map(current.map(x=>[x.product,x]));
 if(a.size!==b.size||[...a.keys()].some(k=>!b.has(k)))return invalid('Product additions or removals require a separately governed decomposition model.');
 let price=0,volume=0,previousRevenue=0,currentRevenue=0;
 for(const [key,p] of a){const c=b.get(key)!;const p0=p.revenue/p.quantity,p1=c.revenue/c.quantity;price+=(p1-p0)*c.quantity;volume+=(c.quantity-p.quantity)*p0;previousRevenue+=p.revenue;currentRevenue+=c.revenue;}
 const change=currentRevenue-previousRevenue;
 return nums(price,volume,change)&&Math.abs(price+volume-change)<=1e-8*Math.max(1,Math.abs(change))?{status:'READY' as const,priceEffect:price,volumeEffect:volume,revenueChange:change,method:'prior-price volume effect and current-volume price effect' as const}:invalid('Revenue change failed reconciliation.');
}
/** Portfolio sales mix at current vs prior baseline realized product prices. */
export function salesProductMixEffect(previous:SalesProductPeriod[],current:SalesProductPeriod[]):SalesResult{
 const result=salesPriceVolumeDecomposition(previous,current);
 if(result.status!=='READY')return fail(result.reason);
 const old=new Map(previous.map(x=>[x.product,x])),priorTotal=previous.reduce((s,x)=>s+x.quantity,0),nowTotal=current.reduce((s,x)=>s+x.quantity,0);
 if(priorTotal<=0||nowTotal<=0)return fail('Total quantities must be positive.');
 const mix=current.reduce((s,x)=>s+(x.quantity-nowTotal*(old.get(x.product)!.quantity/priorTotal))*(old.get(x.product)!.revenue/old.get(x.product)!.quantity),0);
 return nums(mix)?ok(mix):fail('Invalid mix effect.');
}
export function salesVolatility(values:number[]):SalesResult{
 if(values.length<2||!values.every(Number.isFinite))return fail('At least two comparable period sales values are required.');
 const mean=values.reduce((s,v)=>s+v,0)/values.length;
 return ok(Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1)));
}
export function salesGrowthContribution(segmentChange:number,totalChange:number):SalesResult{
 return nums(segmentChange,totalChange)&&totalChange!==0?ok(segmentChange/totalChange):fail('Confirm segment changes and nonzero total change.');
}
export function salesForecastErrors(actual:number[],forecast:number[]){
 if(!actual.length||actual.length!==forecast.length||![...actual,...forecast].every(Number.isFinite))return {status:'UNAVAILABLE' as const,reason:'Matched actual and forecast observations are required.'};
 const residual=actual.map((a,i)=>a-forecast[i]),absolute=residual.map(Math.abs);
 const mae=absolute.reduce((a,b)=>a+b,0)/actual.length,rmse=Math.sqrt(residual.reduce((a,b)=>a+b*b,0)/actual.length),denominator=actual.reduce((a,b)=>a+Math.abs(b),0);
 return {status:'READY' as const,mae,rmse,wape:denominator>0?absolute.reduce((a,b)=>a+b,0)/denominator:null};
}
/** Transparent seasonal-naive forecast; caller must supply complete, ordered, equally spaced periods. */
export function salesSeasonalNaiveForecast(history:number[],seasonLength:number,horizon:number){
 if(!Number.isSafeInteger(seasonLength)||seasonLength<1||history.length<2*seasonLength||!Number.isSafeInteger(horizon)||horizon<1||horizon>366||!history.every(x=>Number.isFinite(x)&&x>=0))
  return {status:'UNAVAILABLE' as const,reason:'Forecast requires at least two complete nonnegative seasons, a valid cadence, and a bounded horizon.'};
 const last=history.slice(-seasonLength);
 const forecast=Array.from({length:horizon},(_,i)=>last[i%seasonLength]);
 const backtestActual=history.slice(-seasonLength),backtestPredicted=history.slice(-2*seasonLength,-seasonLength);
 return {status:'READY' as const,forecast,method:'seasonal naive' as const,backtest:salesForecastErrors(backtestActual,backtestPredicted)};
}
export function salesCohortRevenuePerActiveCustomer(revenue:number,activeCustomers:number):SalesResult{
 return nums(revenue,activeCustomers)&&Number.isSafeInteger(activeCustomers)&&activeCustomers>0?ok(revenue/activeCustomers):fail('Confirm cohort membership, revenue, and distinct active customers for the same period.');
}
