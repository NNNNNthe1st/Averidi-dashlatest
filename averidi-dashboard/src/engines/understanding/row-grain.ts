import {z} from 'zod';
import type {DashboardRow} from '../ingestion/ingest';
import {dashboardBusinessDay} from '../metrics/business-period';

export const rowGrains=['ORDER','ORDER_ITEM','INVOICE','INVOICE_ITEM','TRANSACTION','CUSTOMER','PRODUCT','DAY','PERIOD','RECORD'] as const;
export type RowGrain=typeof rowGrains[number];
export const grainSuggestionSchema=z.object({
 version:z.literal(1),kind:z.enum([...rowGrains,'UNDETERMINED']),confidence:z.number().min(0).max(1),
 rowCount:z.number().int().min(0).max(50000),identityFields:z.array(z.string().min(1).max(120)).max(2),
 evidence:z.array(z.string().max(400)).max(8),confirmationRequired:z.literal(true),
}).strict();
export type GrainSuggestion=z.infer<typeof grainSuggestionSchema>;
type Field={sourceName:string;businessConcept:string};
const validIdentity=(v:unknown)=>typeof v==='string'?v.trim().length>0:typeof v==='number'&&Number.isSafeInteger(v);
/** Complete full-version keys; no sampling, approximate uniqueness or value deduplication. */
export function completeUniqueGrainKeys(rows:DashboardRow[],fields:string[]){
 if(!rows.length||!fields.length)return false;
 const keys=new Set<string>();
 for(const row of rows){const values=fields.map(f=>row[f]);if(values.some(v=>!validIdentity(v)))return false;keys.add(JSON.stringify(values.map(String)));}
 return keys.size===rows.length;
}
/** New-grain validation only. Legacy confirmed calculation contracts stay intact. */
export function newRowGrainValid(rows:DashboardRow[],mappings:{sourceField:string;canonicalConcept:string}[],grain:RowGrain,timezone?:string|null){
 const one=(concept:string)=>{const matches=mappings.filter(m=>m.canonicalConcept===concept);return matches.length===1?matches[0].sourceField:null;};
 if(grain==='DAY'){
  const time=one('TIME');if(!time||!timezone||!rows.length)return false;
  const days=rows.map(row=>dashboardBusinessDay(row[time],timezone));
  return days.every(Boolean)&&new Set(days).size===rows.length;
 }
 const parent=one(grain.startsWith('INVOICE')?'INVOICE':'ORDER');
 const line=grain.endsWith('_ITEM')?one('LINE_ITEM'):null;
 return Boolean(parent&&(!grain.endsWith('_ITEM')||line)&&completeUniqueGrainKeys(rows,line?[parent!,line]:[parent!]));
}
/** Suggestions cannot establish business meaning. Ambiguous or incomplete keys fail closed. */
export function inferRowGrain(rows:DashboardRow[],fields:Field[]):GrainSuggestion{
 const result=(kind:GrainSuggestion['kind'],identityFields:string[],confidence:number,evidence:string[]):GrainSuggestion=>({version:1,kind,identityFields,confidence,rowCount:rows.length,evidence,confirmationRequired:true});
 const unknown=(reason:string)=>result('UNDETERMINED',[],0,[reason,'Confirm the actual row meaning and fields before calculating metrics.']);
 if(rows.length<2)return unknown('At least two rows are needed to assess identity cardinality.');
 const by=(concept:string)=>fields.filter(f=>f.businessConcept===concept);
 const parents=[...by('ORDER'),...by('INVOICE')],lines=by('LINE_ITEM');
 if(parents.length>1||lines.length>1)return unknown('Multiple document or line identity candidates are ambiguous.');
 if(parents.length===1){
  const parent=parents[0],base=parent.businessConcept as 'ORDER'|'INVOICE';
  if(lines.length){const key=[parent.sourceName,lines[0].sourceName];return completeUniqueGrainKeys(rows,key)?result(`${base}_ITEM`,key,.9,['Every document and line key is present; the combined key is unique across the full version.','Monetary amounts still require confirmation that they belong to each line.']):unknown('Document and line keys are missing, invalid or repeated.');}
  return completeUniqueGrainKeys(rows,[parent.sourceName])?result(base,[parent.sourceName],.9,['Every document key is present and unique across the full version.']):unknown('Document keys repeat or are incomplete. An explicit line identity may be needed.');
 }
 if(lines.length)return unknown('A line identity without a document identity cannot establish line grain.');
 const entities=[...by('CUSTOMER'),...by('PRODUCT')];
 const candidates=entities.filter(f=>completeUniqueGrainKeys(rows,[f.sourceName]));
 if(candidates.length>1)return unknown('Several entity identities are unique; row meaning needs customer review.');
 if(candidates.length===1){const field=candidates[0];return result(field.businessConcept as RowGrain,[field.sourceName],.8,['The entity key is complete and unique across the full version; confirm its business meaning.']);}
 const transactions=by('IDENTIFIER').filter(f=>/^(transaction|receipt)[ _-](id|number)$/i.test(f.sourceName));
 if(transactions.length===1&&completeUniqueGrainKeys(rows,[transactions[0].sourceName]))return result('TRANSACTION',[transactions[0].sourceName],.8,['The transaction identity is complete and unique across the full version.']);
 const times=by('TIME');
 if(times.length===1){
  const field=times[0].sourceName,values=rows.map(row=>row[field]);
  // Ingestion normalizes source dates to midnight UTC. This remains an advisory
  // day candidate; final validation uses the customer's confirmed timezone.
  const dayLike=values.every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T00:00:00\.000Z)?$/.test(v));
  const days=values.map(v=>dashboardBusinessDay(v,'UTC'));
  if(dayLike&&days.every(Boolean)&&new Set(days).size===rows.length)return result('DAY',[field],.65,['One complete calendar-date candidate per row, with no stronger identity.','Confirm the business timezone; date uniqueness alone does not prove daily aggregation.']);
 }
 return unknown('No complete unambiguous business identity or daily key was established.');
}
