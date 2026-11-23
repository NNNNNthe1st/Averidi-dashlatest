import type {DashboardPreparedData} from '../ingestion/ingest';
import type {SalesRole} from './contracts';
export const salesName=(name:string)=>name.replace(/([a-z])([A-Z])/g,'$1 $2').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function nonAdditiveSalesField(name:string){return /\b(cumulative|running|rolling|average|avg|mean|median|margin|rate|ratio|percent|percentage|balance|opening|closing|ytd|mtd|qtd|per)\b/.test(salesName(name));}
const entities={ORDER:['order','booking','reservation','job','ticket','folio','contract'],CUSTOMER:['customer','client','guest','patient','member','subscriber','tenant','buyer','account'],PRODUCT:['product','item','service','procedure','treatment','plan','room','package']} as const;
const semanticWords:Partial<Record<SalesRole,string[]>>={REVENUE:['revenue','sales','receipts','takings','fees earned','amount collected','billed amount','net charges'],COST:['cost of services','service cost','direct costs','cost of sales','product costs'],QUANTITY:['quantity','qty','units','sessions sold','hours sold','nights sold','seats sold'],TIME:['sale date','booking date','service date','billing date','payment date','posting date'],ROW_KIND:['row type','record type','row kind','record kind','entry type','line type']};
/** Industry terminology is matched compositionally, then checked against values.
 * Unlabelled numbers never establish a monetary meaning by themselves. */
export function salesRoleCandidates(data:DashboardPreparedData,field:string):{role:SalesRole;score:number;evidence:string}[]{
 const key=salesName(field),tokens=key.split(' '),values=data.rows.map(r=>r[field]);
 const result:{role:SalesRole;score:number;evidence:string}[]=[];
 const add=(role:SalesRole,score:number,evidence:string)=>{if(!result.some(r=>r.role===role))result.push({role,score,evidence});};
 for(const [role,nouns] of Object.entries(entities))if(nouns.some(noun=>tokens.includes(noun))){
  const identifier=tokens.some(t=>['id','identifier','code','number','no','reference','ref'].includes(t));
  const complete=values.length>0&&values.every(v=>v!==null&&v!==undefined&&String(v).trim()!=='');
  if(identifier&&complete)add(role as SalesRole,95,'Business entity and identifier wording agree; values are complete.');
  else if(tokens.includes('name')&&role!=='ORDER'&&complete)add((role+'_NAME') as SalesRole,90,'Business entity and display-name wording agree.');
 }
 for(const [role,phrases] of Object.entries(semanticWords))for(const phrase of phrases??[]){
  if(!(' '+key+' ').includes(' '+phrase+' '))continue;
  if(role==='REVENUE'&&tokens.some(t=>['price','cost','target','budget','forecast','refund','discount','tax','gross','quantity','units'].includes(t)))continue;
  const monetary=['REVENUE','COST','QUANTITY'].includes(role);
  if(monetary&&nonAdditiveSalesField(field))continue;
  const numeric=values.length>0&&values.every(v=>typeof v==='number'&&Number.isFinite(v));
  if(!monetary||numeric)add(role as SalesRole,key===phrase?95:90,'Meaningful header tokens agree with the observed value type.');
  else add(role as SalesRole,65,'Header suggests this meaning, but the numeric values need review.');
 }
 return result.sort((a,b)=>b.score-a.score);
}
