import {Prisma} from '@prisma/client';
import type {DashboardRow} from '../ingestion/ingest';
type Unit=Record<string,number>;
type Expression={op:'SUM';field:string;unit:Unit}|{op:'DISTINCT';field:string;unit:Unit}|{op:'REF';key:string}|{op:'SUBTRACT'|'DIVIDE';left:Expression;right:Expression};
type Definition={expression:Expression;aggregation:'ADDITIVE'|'DISTINCT'|'RATIO'};
const sum=(field:string,unit:Unit):Expression=>({op:'SUM',field,unit}),ref=(key:string):Expression=>({op:'REF',key});
const subtract=(left:Expression,right:Expression):Expression=>({op:'SUBTRACT',left,right}),divide=(left:Expression,right:Expression):Expression=>({op:'DIVIDE',left,right});
export function compileSalesPlan(currency:string,options:{refunds:boolean;discounts:boolean;returns:boolean}){
 const money={[currency]:1};let revenue=sum('REVENUE',money),units=sum('QUANTITY',{units:1});
 if(options.refunds)revenue=subtract(revenue,sum('REFUND',money));if(options.discounts)revenue=subtract(revenue,sum('DISCOUNT',money));if(options.returns)units=subtract(units,sum('RETURN_QUANTITY',{units:1}));
 const definitions:Record<string,Definition>={REVENUE:{expression:revenue,aggregation:'ADDITIVE'},COST:{expression:sum('COST',money),aggregation:'ADDITIVE'},PROFIT:{expression:subtract(ref('REVENUE'),ref('COST')),aggregation:'ADDITIVE'},GROSS_MARGIN:{expression:divide(ref('PROFIT'),ref('REVENUE')),aggregation:'RATIO'},ORDERS:{expression:{op:'DISTINCT',field:'ORDER',unit:{orders:1}},aggregation:'DISTINCT'},CUSTOMERS:{expression:{op:'DISTINCT',field:'CUSTOMER',unit:{customers:1}},aggregation:'DISTINCT'},UNITS:{expression:units,aggregation:'ADDITIVE'},AVERAGE_ORDER_VALUE:{expression:divide(ref('REVENUE'),ref('ORDERS')),aggregation:'RATIO'},AVERAGE_UNIT_PRICE:{expression:divide(ref('REVENUE'),ref('UNITS')),aggregation:'RATIO'}};
 const order:string[]=[],visiting=new Set<string>(),compiled=new Map<string,Unit>();
 const normalized=(u:Unit)=>JSON.stringify(Object.fromEntries(Object.entries(u).filter(([,v])=>v).sort(([a],[b])=>a.localeCompare(b))));
 function infer(node:Expression):Unit{if(node.op==='SUM'||node.op==='DISTINCT')return node.unit;if(node.op==='REF')return visit(node.key);const a=infer(node.left),b=infer(node.right);if(node.op==='SUBTRACT'){if(normalized(a)!==normalized(b))throw Error('SALES_PLAN_UNIT_MISMATCH');return a;}const result={...a};for(const [k,v] of Object.entries(b))result[k]=(result[k]??0)-v;return result;}
 function visit(key:string):Unit{if(compiled.has(key))return compiled.get(key)!;if(visiting.has(key))throw Error('SALES_PLAN_CYCLE');if(!definitions[key])throw Error('SALES_PLAN_DEPENDENCY');visiting.add(key);const unit=infer(definitions[key].expression);compiled.set(key,unit);visiting.delete(key);order.push(key);return unit;}
 for(const key of Object.keys(definitions))visit(key);
 return {version:2 as const,definitions,order,units:Object.fromEntries(compiled)};
}
/** Each derived measure is evaluated over the selected population; ratios and
 * distinct counts are recomputed, never summed/averaged from displayed groups. */
export function executeSalesPlan(rows:DashboardRow[],plan:ReturnType<typeof compileSalesPlan>,requested:string,sharedMemo?:Map<string,Prisma.Decimal>){
 const Decimal=Prisma.Decimal.clone({precision:40,rounding:Prisma.Decimal.ROUND_HALF_UP}),memo=sharedMemo??new Map<string,Prisma.Decimal>();
 function evaluate(node:Expression):Prisma.Decimal{
  if(node.op==='REF')return metric(node.key);
  if(node.op==='DISTINCT'){if(rows.some(r=>r[node.field]===null||r[node.field]===undefined||String(r[node.field]).trim()===''))throw Error('SALES_PLAN_INPUT');return new Decimal(new Set(rows.map(r=>String(r[node.field]))).size);}
  if(node.op==='SUM'){let total=new Decimal(0);for(const r of rows){const v=r[node.field];if(typeof v!=='number'||!Number.isFinite(v))throw Error('SALES_PLAN_INPUT');total=total.plus(String(v));}return total;}
  const left=evaluate(node.left),right=evaluate(node.right);if(node.op==='SUBTRACT')return left.minus(right);if(right.isZero())throw Error('SALES_PLAN_ZERO_DENOMINATOR');return left.div(right);
 }
 function metric(key:string):Prisma.Decimal{if(memo.has(key))return memo.get(key)!;const d=plan.definitions[key];if(!d)throw Error('SALES_PLAN_DEPENDENCY');const value=evaluate(d.expression);memo.set(key,value);return value;}
 const value=metric(requested),numeric=value.toNumber();if(!value.isFinite()||!Number.isFinite(numeric)||Math.abs(numeric)>Number.MAX_SAFE_INTEGER)throw Error('SALES_PLAN_RANGE');
 // Exact decimal values feed dependencies and lineage. The existing chart/API
 // contract also needs a JS number. Permit its representation error only below
 // half a currency minor unit; Excel numeric cells commonly contain tiny binary
 // residuals. Never use that presentation number to evaluate plan dependencies.
 if(plan.definitions[requested].aggregation!=='RATIO'){
  const currency=Object.entries(plan.units[requested]).find(([k,v])=>/^[A-Z]{3}$/.test(k)&&v===1)?.[0];
  const digits=currency?new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!:12;
  const tolerance=new Decimal(10).pow(-digits).div(2);
  if(new Decimal(String(numeric)).minus(value).abs().gte(tolerance))throw Error('SALES_PLAN_RANGE');
 }
 return {exact:value.toFixed(),value:numeric,unit:plan.units[requested],aggregation:plan.definitions[requested].aggregation};
}
