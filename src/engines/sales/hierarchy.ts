import {z} from 'zod';
import type {DashboardRow} from '../ingestion/ingest';
export const salesBreakdownsSchema=z.object({GEOGRAPHY:z.string().max(120).optional(),CATEGORY:z.string().max(120).optional()}).strict();
export type SalesBreakdowns=z.infer<typeof salesBreakdownsSchema>;
export type SalesHierarchy={GEOGRAPHY:{field:string;label:string;next?:string}[];CATEGORY:{field:string;label:string;next?:string}[]};
/** A name proposes a level; every source row must establish its parent relation. */
export function salesHierarchy(dimensions:readonly {field:string;concept:string;role:string}[],rows:readonly DashboardRow[]=[]):SalesHierarchy{
 const rank=(field:string)=>/country|国|pays|pa[ií]s/i.test(field)?0:/region|territory|地域/i.test(field)?1:/state|province|都道府県/i.test(field)?2:/city|town/i.test(field)?3:4;
 const belongs=(parent:string,child:string)=>{
  if(!rows.length)return false;
  const parents=new Map<string,string>();
  for(const row of rows){const p=row[parent],c=row[child];if(p===null||p===undefined||c===null||c===undefined||!String(p).trim()||!String(c).trim())return false;
   const key=String(c);if(parents.has(key)&&parents.get(key)!==String(p))return false;parents.set(key,String(p));}
  return true;
 };
 const geography=dimensions.filter(d=>d.role==='DIMENSION'&&d.concept==='GEOGRAPHY').sort((a,b)=>rank(a.field)-rank(b.field));
 const categories=dimensions.filter(d=>d.role==='DIMENSION'&&['CATEGORY','SUBCATEGORY'].includes(d.concept)).sort((a,b)=>(a.concept==='CATEGORY'?0:1)-(b.concept==='CATEGORY'?0:1));
 return {GEOGRAPHY:geography.map(d=>{
  const candidates=geography.filter(c=>rank(d.field)<rank(c.field)&&rank(c.field)<4&&belongs(d.field,c.field));
  const level=candidates.length?Math.min(...candidates.map(c=>rank(c.field))):null;
  const nearest=candidates.filter(c=>rank(c.field)===level);
  return {field:d.field,label:d.field,...(nearest.length===1?{next:nearest[0].field}:{})};
 }),CATEGORY:categories.map(d=>{
  const children=d.concept==='CATEGORY'&&/category|department|カテゴリ/i.test(d.field)?categories.filter(c=>c.concept==='SUBCATEGORY'&&belongs(d.field,c.field)):[];
  return {field:d.field,label:d.field,...(children.length===1?{next:children[0].field}:{})};
 })};
}
