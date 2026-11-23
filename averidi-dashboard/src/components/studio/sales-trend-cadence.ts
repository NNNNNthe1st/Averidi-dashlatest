export type SalesTrendCadence='MONTHLY'|'QUARTERLY'|'YEARLY';
export type SalesTrendPoint={label:string;value:number|null;secondaryValue:number|null};
export function aggregateSalesTrend(points:SalesTrendPoint[],cadence:SalesTrendCadence):SalesTrendPoint[]{
 if(cadence==='MONTHLY')return points;
 const result=new Map<string,{sales:number;profit:number;validSales:boolean;validProfit:boolean}>();
 for(const point of points){
  const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(point.label);
  if(!match)throw Error('SALES_TREND_REQUIRES_CONFIRMED_MONTHS');
  const label=cadence==='YEARLY'?match[1]:match[1]+' Q'+Math.ceil(Number(match[2])/3);
  const entry=result.get(label)??{sales:0,profit:0,validSales:true,validProfit:true};
  if(point.value===null||!Number.isFinite(point.value))entry.validSales=false;else entry.sales+=point.value;
  if(point.secondaryValue===null||!Number.isFinite(point.secondaryValue))entry.validProfit=false;else entry.profit+=point.secondaryValue;
  result.set(label,entry);
 }
 return [...result].sort(([a],[b])=>a.localeCompare(b)).map(([label,entry])=>({label,value:entry.validSales?entry.sales:null,secondaryValue:entry.validProfit?entry.profit:null}));
}
