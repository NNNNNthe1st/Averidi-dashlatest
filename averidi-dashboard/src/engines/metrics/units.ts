import {z} from 'zod';
import type {DashboardRow} from '../ingestion/ingest';
export const SOURCE_UNITS=['ITEM','CASE','KG','G','LB','OZ','LITRE','ML','HOUR','MINUTE','SECOND','METRE','CM'] as const;
export const unitRuleSchema=z.object({unit:z.enum(SOURCE_UNITS),itemsPerCase:z.number().positive().max(1e9).optional()}).strict().refine(r=>r.itemsPerCase===undefined||r.unit==='CASE');
export const unitRulesSchema=z.record(z.string().min(1).max(120),unitRuleSchema).refine(r=>Object.keys(r).length<=100);
export type UnitRules=z.infer<typeof unitRulesSchema>;
export function canonicalUnit(rule:z.infer<typeof unitRuleSchema>){
 const values:Record<string,[string,number]>={ITEM:['items',1],CASE:rule.itemsPerCase?['items',rule.itemsPerCase]:['cases',1],KG:['kg',1],G:['kg',.001],LB:['kg',.45359237],OZ:['kg',.028349523125],LITRE:['litres',1],ML:['litres',.001],HOUR:['hours',1],MINUTE:['hours',1/60],SECOND:['hours',1/3600],METRE:['metres',1],CM:['metres',.01]};
 return {label:values[rule.unit][0],factor:values[rule.unit][1]};
}
const quantity=new Set(['QUANTITY','RETURN_QUANTITY','INVENTORY_ON_HAND','INVENTORY_DEMAND']);
export function normalizeBusinessUnits(rows:DashboardRow[],mappings:{sourceField:string;canonicalConcept:string}[],rules:UnitRules={}){
 const byConcept=new Map<string,string>();
 for(const [field,rule] of Object.entries(rules)){
  const mapping=mappings.find(m=>m.sourceField===field);if(!mapping||!quantity.has(mapping.canonicalConcept)&&!['OPERATIONS_HOURS','OPERATIONS_CYCLE_HOURS'].includes(mapping.canonicalConcept))throw Error('INVALID_UNIT_FIELD');
  const unit=canonicalUnit(rule);if(mapping.canonicalConcept.startsWith('OPERATIONS_')&&unit.label!=='hours')throw Error('INCOMPATIBLE_UNIT');
  if(mapping.canonicalConcept.startsWith('INVENTORY_')&&unit.label==='hours')throw Error('INCOMPATIBLE_UNIT');
  byConcept.set(mapping.canonicalConcept,unit.label);
 }
 for(const [a,b] of [['QUANTITY','RETURN_QUANTITY'],['INVENTORY_ON_HAND','INVENTORY_DEMAND']]){
  const left=byConcept.get(a),right=byConcept.get(b);if((left||right)&&mappings.some(m=>m.canonicalConcept===a)&&mappings.some(m=>m.canonicalConcept===b)&&(left??'items')!==(right??'items'))throw Error('INCOMPATIBLE_UNIT');
 }
 return {rows:Object.keys(rules).length?rows.map(row=>{const copy={...row};for(const [field,rule] of Object.entries(rules)){const value=row[field];if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('INVALID_UNIT_VALUE');const result=value*canonicalUnit(rule).factor;if(!Number.isFinite(result)||Math.abs(result)>Number.MAX_SAFE_INTEGER)throw Error('UNIT_RANGE');copy[field]=result;}return copy;}):rows,units:byConcept};
}
