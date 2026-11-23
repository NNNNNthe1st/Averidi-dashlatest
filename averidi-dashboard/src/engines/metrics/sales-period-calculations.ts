import {Prisma} from '@prisma/client';
/**
 * Sales period calculations. Pure functions only: callers must supply governed,
 * confirmed daily values in one currency and a complete observation calendar.
 * No source-column guessing and no dashboard layout changes.
 */
export type SalesDay={date:string;revenue:number;exactRevenue?:string};
type Arithmetic='DECIMAL'|undefined;
const Decimal=Prisma.Decimal.clone({precision:40,rounding:Prisma.Decimal.ROUND_HALF_UP});
export type SalesPeriod={start:string;end:string};
export type SalesWindowResult={status:'READY';value:number;exactValue?:string}|{status:'UNAVAILABLE';value:null;reason:string};
const unavailable=(reason:string):SalesWindowResult=>({status:'UNAVAILABLE',value:null,reason});
function dayIndex(date:string):number|null{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const n=Date.parse(date+'T00:00:00.000Z');
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===date?Math.round(n/86400000):null;
}
function iso(n:number){return new Date(n*86400000).toISOString().slice(0,10);}
function checkedDays(days:SalesDay[]):Map<number,SalesDay>|null{
 const m=new Map<number,SalesDay>();
 for(const day of days){const index=dayIndex(day.date);if(index===null||!Number.isFinite(day.revenue)||m.has(index))return null;m.set(index,day);}
 return m;
}
function rangeSum(days:Map<number,SalesDay>,start:number,end:number,arithmetic?:Arithmetic):SalesWindowResult{
 if(start>end)return unavailable('Invalid period.');
 let total=0,exact=new Decimal(0);
 for(let d=start;d<=end;d++){const value=days.get(d);if(value===undefined)return unavailable('Daily history is incomplete; zero-sales dates must be explicitly represented.');if(arithmetic==='DECIMAL')exact=exact.plus(value.exactRevenue??String(value.revenue));else total+=value.revenue;}
 if(arithmetic==='DECIMAL'){total=exact.toNumber();if(!Number.isFinite(total)||Math.abs(total)>Number.MAX_SAFE_INTEGER)return unavailable('Result exceeds supported numeric range.');return {status:'READY',value:total,exactValue:exact.toFixed()};}
 return Number.isFinite(total)?{status:'READY',value:total}:unavailable('Result exceeds supported numeric range.');
}
export function salesPeriodRevenue(days:SalesDay[],period:SalesPeriod,arithmetic?:Arithmetic):SalesWindowResult{
 const history=checkedDays(days),start=dayIndex(period.start),end=dayIndex(period.end);
 if(!history||start===null||end===null)return unavailable('Invalid or duplicate daily sales records, or invalid dates.');
 return rangeSum(history,start,end,arithmetic);
}
export function salesRollingRevenue(days:SalesDay[],through:string,windowDays:number,arithmetic?:Arithmetic):SalesWindowResult{
 const history=checkedDays(days),end=dayIndex(through);
 if(!history||end===null||!Number.isSafeInteger(windowDays)||windowDays<1||windowDays>3660)return unavailable('Invalid rolling window or daily records.');
 return rangeSum(history,end-windowDays+1,end,arithmetic);
}
export function salesMovingDailyAverage(days:SalesDay[],through:string,windowDays:number,arithmetic?:Arithmetic):SalesWindowResult{
 const sum=salesRollingRevenue(days,through,windowDays,arithmetic);
 if(sum.status!=='READY')return sum;if(arithmetic==='DECIMAL'){const exact=new Decimal(sum.exactValue??String(sum.value)).div(windowDays);return {status:'READY',value:exact.toNumber(),exactValue:exact.toFixed()};}return {status:'READY',value:sum.value/windowDays};
}
export function salesToDate(days:SalesDay[],through:string,period:'MONTH'|'QUARTER'|'YEAR',arithmetic?:Arithmetic):SalesWindowResult{
 const end=dayIndex(through);
 if(end===null)return unavailable('Invalid end date.');
 const year=Number(through.slice(0,4)),month=Number(through.slice(5,7));
 const start=period==='MONTH'?through.slice(0,7)+'-01':period==='QUARTER'?year+'-'+String(Math.floor((month-1)/3)*3+1).padStart(2,'0')+'-01':year+'-01-01';
 return salesPeriodRevenue(days,{start,end:through},arithmetic);
}
export function salesCumulativeRevenue(days:SalesDay[],period:SalesPeriod):{date:string;revenue:number}[]|null{
 const history=checkedDays(days),start=dayIndex(period.start),end=dayIndex(period.end);
 if(!history||start===null||end===null||end<start||end-start>3659)return null;
 const result:{date:string;revenue:number}[]=[];let total=0;
 for(let d=start;d<=end;d++){const v=history.get(d);if(v===undefined)return null;total+=v.revenue;if(!Number.isFinite(total))return null;result.push({date:iso(d),revenue:total});}
 return result;
}
export function salesCagr(beginning:number,ending:number,years:number):SalesWindowResult{
 if(!Number.isFinite(beginning)||!Number.isFinite(ending)||beginning<=0||ending<0||!Number.isFinite(years)||years<=0)
  return unavailable('CAGR requires positive beginning sales, nonnegative ending sales, and positive elapsed years.');
 const value=Math.pow(ending/beginning,1/years)-1;
 return Number.isFinite(value)?{status:'READY',value}:unavailable('CAGR result is invalid.');
}
export type SalesSegment={id:string;revenue:number};
function segmentsValid(items:SalesSegment[]):boolean{
 return items.length>0&&items.every(x=>!!x.id.trim()&&Number.isFinite(x.revenue))&&new Set(items.map(x=>x.id)).size===items.length;
}
export function salesRankedSegments(items:SalesSegment[]):SalesSegment[]|null{
 if(!segmentsValid(items))return null;
 return [...items].sort((a,b)=>b.revenue-a.revenue||a.id.localeCompare(b.id));
}
export function salesTopNConcentration(items:SalesSegment[],n:number):SalesWindowResult{
 const ranked=salesRankedSegments(items);
 if(!ranked||!Number.isSafeInteger(n)||n<1)return unavailable('Confirm unique segment identities and a positive top-N count.');
 const total=ranked.reduce((sum,item)=>sum+item.revenue,0);
 if(!Number.isFinite(total)||total<=0||ranked.some(x=>x.revenue<0))return unavailable('Concentration requires nonnegative segment sales and a positive total.');
 return {status:'READY',value:ranked.slice(0,n).reduce((sum,item)=>sum+item.revenue,0)/total};
}
export function salesSegmentShares(items:SalesSegment[]):{id:string;share:number}[]|null{
 if(!segmentsValid(items))return null;
 const total=items.reduce((sum,item)=>sum+item.revenue,0);
 if(!Number.isFinite(total)||total===0)return null;
 return items.map(x=>({id:x.id,share:x.revenue/total}));
}
export function salesRevenuePerCustomer(revenue:number,uniqueCustomers:number):SalesWindowResult{
 if(!Number.isFinite(revenue)||!Number.isSafeInteger(uniqueCustomers)||uniqueCustomers<=0)return unavailable('Confirmed revenue and a positive distinct customer count are required.');
 return {status:'READY',value:revenue/uniqueCustomers};
}
export function salesUnitsPerOrder(units:number,distinctOrders:number):SalesWindowResult{
 if(!Number.isFinite(units)||!Number.isSafeInteger(distinctOrders)||distinctOrders<=0)return unavailable('Confirmed units and a positive distinct order count are required.');
 return {status:'READY',value:units/distinctOrders};
}
