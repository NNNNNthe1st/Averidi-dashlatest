import type {DashboardPreparedData,DashboardRow} from '../ingestion/ingest';
import type {SalesAnswers,SalesField,SalesRole} from './contracts';
import {salesRoleCandidates,salesName} from './recognition';

export type FieldProfile={field:string;complete:boolean;distinct:number;unique:boolean;numeric:boolean;date:boolean};
const present=(v:unknown)=>v!==null&&v!==undefined&&String(v).trim()!=='';
export function profileSalesFields(data:DashboardPreparedData):FieldProfile[]{
 return data.columns.map(c=>{const values=data.rows.map(r=>r[c.name]),complete=values.length>0&&values.every(present),distinct=new Set(values.map(v=>JSON.stringify(v))).size;
  return {field:c.name,complete,distinct,unique:complete&&distinct===values.length,numeric:complete&&values.every(v=>typeof v==='number'&&Number.isFinite(v)),date:complete&&(c.dataType==='DATE'||values.every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v)&&Number.isFinite(Date.parse(v))))};
 });
}
export function salesDependency(rows:readonly DashboardRow[],determinant:readonly string[],dependent:string){
 if(!rows.length||!determinant.length)return false;
 const groups=new Map<string,string>();
 for(const row of rows){if(!present(row[dependent])||determinant.some(f=>!present(row[f])))return false;const key=JSON.stringify(determinant.map(f=>row[f])),value=JSON.stringify(row[dependent]);if(groups.has(key)&&groups.get(key)!==value)return false;groups.set(key,value);}
 return true;
}
/** Bounded composite-key discovery on recognized identities, never arbitrary amounts.
 * The cap prevents exponential work on wide customer files. Keys describe this
 * source version; observed uniqueness does not prove an external business key. */
export function discoverSalesKeys(data:DashboardPreparedData,fields:readonly SalesField[]){
 const candidates=fields.filter(f=>['ORDER','INVOICE','TRANSACTION','LINE_ITEM','IDENTIFIER'].includes(f.role)).slice(0,12).map(f=>f.name),keys:string[][]=[];
 const unique=(names:string[])=>data.rows.length>0&&data.rows.every(r=>names.every(f=>present(r[f])))&&new Set(data.rows.map(r=>JSON.stringify(names.map(f=>r[f])))).size===data.rows.length;
 for(const name of candidates)if(unique([name]))keys.push([name]);
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){const pair=[candidates[i],candidates[j]];if(!keys.some(k=>k.every(f=>pair.includes(f)))&&unique(pair))keys.push(pair);}
 return keys;
}
type Candidate={field:string;role:SalesRole;score:number;evidence:string};
const exclusive=['TIME','REVENUE','COST','QUANTITY'] as const;
/** Maximum-weight constrained assignment over four core roles (16 DP states).
 * A column cannot serve two roles. Each core role has capacity one. A second
 * solve excluding a chosen edge detects equally plausible global assignments.
 * Scores are evidence weights, NOT calibrated probabilities. */
function solve(candidates:Candidate[],forbid?:Candidate){
 const columns=[...new Set(candidates.map(c=>c.field))];let states=new Map<number,{score:number;edges:Candidate[]}>([[0,{score:0,edges:[]}]]);
 for(const field of columns){const next=new Map(states);for(const [mask,state] of states)for(const c of candidates.filter(c=>c.field===field&&!(c.field===forbid?.field&&c.role===forbid.role))){const bit=1<<exclusive.indexOf(c.role as typeof exclusive[number]);if(mask&bit)continue;const key=mask|bit,score=state.score+c.score;if(score>(next.get(key)?.score??-Infinity))next.set(key,{score,edges:[...state.edges,c]});}states=next;}
 return [...states.values()].sort((a,b)=>b.score-a.score)[0];
}
export function inferSalesSchema(data:DashboardPreparedData,fields:SalesField[],answers:SalesAnswers){
 const profiles=profileSalesFields(data),candidates:Candidate[]=[];
 for(const f of fields){const profile=profiles.find(p=>p.field===f.name)!;
  if(exclusive.includes(f.role as typeof exclusive[number]))candidates.push({field:f.name,role:f.role,score:100+(profile.numeric&&f.role!=='TIME'?10:0),evidence:'Recognized business role checked against the complete column.'});
  if(f.role==='CUSTOM'){
   for(const c of salesRoleCandidates(data,f.name))if(exclusive.includes(c.role as typeof exclusive[number])&&c.score>=90)candidates.push({field:f.name,...c});
   const tokens=salesName(f.name).split(' '),event=['job','booking','reservation','service','sale','sales','order','invoice','transaction','receipt','billing','payment'];
   if(profile.date)candidates.push({field:f.name,role:'TIME',score:tokens.includes('date')&&event.some(t=>tokens.includes(t))?95:40,evidence:'Complete date values; business-event wording determines whether automatic selection is justified.'});
  }
 }
 // Explicit corrections are constraints, never overridden by inference.
 const gross=fields.filter(f=>f.role==='GROSS'),discount=fields.filter(f=>f.role==='DISCOUNT');
 if(gross.length===1&&discount.length===1)for(const c of candidates.filter(c=>c.role==='REVENUE')){
  if(data.rows.length&&data.rows.every(r=>[r[gross[0].name],r[discount[0].name],r[c.field]].every(v=>typeof v==='number'&&Number.isFinite(v))&&Math.abs(Number(r[gross[0].name])-Number(r[discount[0].name])-Number(r[c.field]))<1e-8)){
   c.score+=20;c.evidence+=' Gross less discount reconciles with this column throughout the file; this does not establish tax/refund treatment.';
  }
 }
 const locked=Object.entries(answers.overrides??{}).filter(([,r])=>exclusive.includes(r as typeof exclusive[number]));
 const allowed=candidates.filter(c=>!locked.some(([field,role])=>field!==c.field&&role===c.role));
 const best=solve(allowed),chosen=best.edges.filter(c=>c.score>=90&&(best.score-solve(allowed,c).score>=8||locked.some(([f,r])=>f===c.field&&r===c.role)));
 const resolved=fields.map(f=>{if(answers.overrides&&Object.hasOwn(answers.overrides,f.name))return f;const c=chosen.find(c=>c.field===f.name);if(c)return {...f,role:c.role,evidence:c.evidence};const selected=chosen.find(c=>c.role===f.role);return selected?{...f,role:'CUSTOM' as const,evidence:'Another column supplies this role with stronger validated evidence.'}:f;});
 const dateCandidates=allowed.filter(c=>c.role==='TIME').map(c=>c.field);
 if(!chosen.some(c=>c.role==='TIME')&&dateCandidates.length>1&&!answers.transactionDateField)for(const f of resolved)if(dateCandidates.includes(f.name)&&!Object.hasOwn(answers.overrides??{},f.name))f.role='TIME';
 if(answers.transactionDateField&&dateCandidates.includes(answers.transactionDateField))for(const f of resolved){if(f.name===answers.transactionDateField)f.role='TIME';else if(f.role==='TIME')f.role='CUSTOM';}
 return {fields:resolved,profiles,keys:discoverSalesKeys(data,resolved),dateCandidates:[...new Set(dateCandidates)],ambiguous:exclusive.filter(role=>allowed.some(c=>c.role===role)&&!chosen.some(c=>c.role===role)&&!(role==='TIME'&&answers.transactionDateField)),assignments:chosen};
}
