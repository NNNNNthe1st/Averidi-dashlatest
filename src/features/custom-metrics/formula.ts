import {Prisma} from '@prisma/client';
import type {MetricOutcome} from '../../engines/metrics/metric-engine';
type Node={kind:'NUMBER';value:string}|{kind:'METRIC';key:string}|{kind:'NEGATE';value:Node}|{kind:'BINARY';op:string;left:Node;right:Node};
export function parseFormula(expression:string){
 if(!expression.trim()||expression.length>512)throw Error('INVALID_CUSTOM_FORMULA');
 const tokens:string[]=[];let position=0;
 while(position<expression.length){if(/\s/.test(expression[position])){position++;continue;}const match=expression.slice(position).match(/^(?:[A-Z][A-Z0-9_]*|(?:\d+(?:\.\d+)?|\.\d+)|[()+*/-])/);if(!match)throw Error('INVALID_CUSTOM_FORMULA');tokens.push(match[0]);position+=match[0].length;if(tokens.length>128)throw Error('CUSTOM_FORMULA_LIMIT');}
 let cursor=0;const references=new Set<string>();
 function factor(depth:number):Node{if(depth>16)throw Error('CUSTOM_FORMULA_LIMIT');const token=tokens[cursor++];if(!token)throw Error('INVALID_CUSTOM_FORMULA');if(token==='-')return {kind:'NEGATE',value:factor(depth+1)};if(token==='+')return factor(depth+1);if(token==='('){const node=expressionNode(depth+1);if(tokens[cursor++]!==')')throw Error('INVALID_CUSTOM_FORMULA');return node;}if(/^[\d.]/.test(token)){if(!new Prisma.Decimal(token).isFinite()||new Prisma.Decimal(token).abs().gt('1000000000000'))throw Error('CUSTOM_FORMULA_LIMIT');return {kind:'NUMBER',value:token};}if(/^[A-Z]/.test(token)){references.add(token);if(references.size>16)throw Error('CUSTOM_FORMULA_LIMIT');return {kind:'METRIC',key:token};}throw Error('INVALID_CUSTOM_FORMULA');}
 function product(depth:number):Node{let node=factor(depth);while(tokens[cursor]==='*'||tokens[cursor]==='/'){const op=tokens[cursor++];node={kind:'BINARY',op,left:node,right:factor(depth)};}return node;}
 function expressionNode(depth:number):Node{let node=product(depth);while(tokens[cursor]==='+'||tokens[cursor]==='-'){const op=tokens[cursor++];node={kind:'BINARY',op,left:node,right:product(depth)};}return node;}
 const ast=expressionNode(0);if(cursor!==tokens.length||!references.size)throw Error('INVALID_CUSTOM_FORMULA');return {ast,references:[...references].sort()};
}
type Units=Record<string,number>;
function dimensions(metric:MetricOutcome):Units{
 const currency=metric.lineage.currency;
 if(metric.definition.format==='PERCENT'||['MARKETING_ROAS','INVENTORY_TURNOVER'].includes(metric.key))return {};
 if(metric.key==='AVERAGE_ORDER_VALUE')return {[currency??'currency']:1,orders:-1};
 if(metric.key==='AVERAGE_UNIT_PRICE')return {[currency??'currency']:1,[metric.lineage.unit??'units']:-1};
 if(metric.key==='OBSERVED_CUSTOMER_VALUE')return {[currency??'currency']:1,customers:-1};
 if(metric.lineage.unit&&metric.definition.format==='COUNT')return {[metric.lineage.unit==='items'?'units':metric.lineage.unit]:1};
 if(metric.key==='MARKETING_CAC'){if(!currency)throw Error('CUSTOM_METRIC_INPUT_UNAVAILABLE');return {[currency]:1,acquired_customers:-1};}
 if(metric.definition.format==='CURRENCY'){if(!currency)throw Error('CUSTOM_METRIC_INPUT_UNAVAILABLE');return {[currency]:1};}
 const aliases:Partial<Record<string,Units>>={ORDERS:{orders:1},CUSTOMERS:{customers:1},NEW_CUSTOMERS:{customers:1},REPEAT_CUSTOMERS:{customers:1},RETAINED_CUSTOMERS:{customers:1},UNITS:{units:1},INVENTORY_STOCK_ON_HAND:{units:1},INVENTORY_DEMAND_UNITS:{units:1},INVENTORY_REORDER_GAP:{units:1},OPERATIONS_LABOR_HOURS:{hours:1},OPERATIONS_COMPLETED_TOTAL:{work:1},OPERATIONS_PRODUCTIVITY:{work:1,hours:-1},OPERATIONS_AVG_CYCLE_HOURS:{hours:1},OPERATIONS_ERRORS_TOTAL:{errors:1},ATTRIBUTED_CONVERSIONS:{conversions:1},INVENTORY_STOCKOUT_PRODUCTS:{products:1},INVENTORY_REORDER_PRODUCTS:{products:1}};
 return aliases[metric.key]??{[metric.key.toLowerCase()]:1};
}
function normalized(units:Units){return Object.fromEntries(Object.entries(units).filter(([,p])=>p!==0).sort(([a],[b])=>a.localeCompare(b)));}
export function evaluateFormula(expression:string,outcomes:MetricOutcome[],format:'NUMBER'|'CURRENCY'|'PERCENT'){
 const parsed=parseFormula(expression),inputs=parsed.references.map(key=>{const metric=outcomes.find(m=>m.key===key);if(!metric||metric.status!=='READY'||metric.value===null||!Number.isFinite(metric.value)||!metric.lineage.definitionVersion)throw Error('CUSTOM_METRIC_INPUT_UNAVAILABLE');return metric;});
 const Decimal=Prisma.Decimal.clone({precision:40,rounding:Prisma.Decimal.ROUND_HALF_UP});
 function run(node:Node):{value:Prisma.Decimal;units:Units}{
  if(node.kind==='NUMBER')return {value:new Decimal(node.value),units:{}};
  if(node.kind==='METRIC'){const input=inputs.find(m=>m.key===node.key)!;return {value:new Decimal(String(input.value)),units:dimensions(input)};}
  if(node.kind==='NEGATE'){const result=run(node.value);return {...result,value:result.value.neg()};}
  const a=run(node.left),b=run(node.right);let units:Units,value:Prisma.Decimal;
  if(node.op==='+'||node.op==='-'){if(JSON.stringify(normalized(a.units))!==JSON.stringify(normalized(b.units)))throw Error('CUSTOM_METRIC_UNIT_MISMATCH');units=a.units;value=node.op==='+'?a.value.plus(b.value):a.value.minus(b.value);}
  else {units={...a.units};for(const [key,power] of Object.entries(b.units))units[key]=(units[key]??0)+(node.op==='/'?-power:power);if(node.op==='/'&&b.value.isZero())throw Error('CUSTOM_METRIC_ZERO_DENOMINATOR');value=node.op==='/'?a.value.div(b.value):a.value.mul(b.value);}
  if(!value.isFinite()||value.abs().gte('100000000000000000000'))throw Error('CUSTOM_METRIC_RANGE');return {value,units:normalized(units)};
 }
 const result=run(parsed.ast),currencies=inputs.map(m=>m.lineage.currency).filter((s):s is string=>!!s);const currency=[...new Set(currencies)];if(currency.length>1)throw Error('CUSTOM_METRIC_UNIT_MISMATCH');
 const entries=Object.entries(result.units);if(format==='PERCENT'&&entries.length||format==='CURRENCY'&&(!currency.length||result.units[currency[0]]!==1||entries.some(([key,power])=>key!==currency[0]&&power>0)))throw Error('CUSTOM_METRIC_UNIT_MISMATCH');
 const rounded=result.value.toDecimalPlaces(10);if(!rounded.isFinite()||rounded.abs().gte('100000000000000000000'))throw Error('CUSTOM_METRIC_RANGE');return {value:rounded.toFixed(),units:result.units,currency:format==='CURRENCY'?currency[0]:null,inputs:inputs.map(m=>({key:m.key,value:String(m.value),definition:m.definition,lineage:m.lineage})),references:parsed.references};
}
