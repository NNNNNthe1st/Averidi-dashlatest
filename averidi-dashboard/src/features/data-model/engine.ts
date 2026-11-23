import {DASHBOARD_MAX_ROWS,DASHBOARD_MAX_COLUMNS,type DashboardCell,type DashboardRow,type DashboardPreparedData} from '../../engines/ingestion/ingest';
import {z} from 'zod';
const field=z.string().min(1).max(120);
export const mappingSchema=z.array(z.object({left:field,right:field}).strict()).min(1).max(3).refine(m=>new Set(m.map(x=>x.left)).size===m.length&&new Set(m.map(x=>x.right)).size===m.length);
export const cardinalitySchema=z.enum(['ONE_TO_ONE','MANY_TO_ONE','ONE_TO_MANY','MANY_TO_MANY']);
export const joinTypeSchema=z.enum(['INNER','LEFT','RIGHT','FULL']);
export type Mapping=z.infer<typeof mappingSchema>;
export type Cardinality=z.infer<typeof cardinalitySchema>;
export type JoinType=z.infer<typeof joinTypeSchema>;
// Exact typed keys: no numeric coercion, whitespace trimming or null-to-null matches.
function key(row:DashboardRow,fields:string[]){const values=fields.map(f=>row[f]);return values.some(v=>v===null||v===undefined||v==='')?null:JSON.stringify(values);}
function index(rows:DashboardRow[],fields:string[]){const result=new Map<string,number[]>();let missing=0;rows.forEach((row,i)=>{const k=key(row,fields);if(k===null){missing++;return;}const list=result.get(k)??[];list.push(i);result.set(k,list);});return {keys:result,missing,duplicateKeys:[...result.values()].filter(v=>v.length>1).length};}
export function joinDatasets(left:DashboardPreparedData,right:DashboardPreparedData,mappings:Mapping,cardinality:Cardinality,joinType:JoinType,materialize=true,signal?:AbortSignal){
 mappingSchema.parse(mappings);cardinalitySchema.parse(cardinality);joinTypeSchema.parse(joinType);
 if(mappings.some(m=>!left.columns.some(c=>c.name===m.left)||!right.columns.some(c=>c.name===m.right)))throw Error('INVALID_RELATIONSHIP');
 const a=index(left.rows,mappings.map(m=>m.left)),b=index(right.rows,mappings.map(m=>m.right));
 if((['ONE_TO_ONE','ONE_TO_MANY'].includes(cardinality)&&a.duplicateKeys)||(['ONE_TO_ONE','MANY_TO_ONE'].includes(cardinality)&&b.duplicateKeys))throw Error('RELATIONSHIP_CARDINALITY');
 const columns=[...left.columns.map(c=>'left_'+c.name),...right.columns.map(c=>'right_'+c.name)];
 if(columns.some(c=>c.length>120)||columns.length>DASHBOARD_MAX_COLUMNS||new Set(columns).size!==columns.length)throw Error('JOIN_LIMIT_EXCEEDED');
 const rows:DashboardRow[]=[],matchedRight=new Set<number>();let outputRows=0,matchedLeftRows=0,unmatchedLeftRows=0;
 const emit=(l:DashboardRow|null,r:DashboardRow|null)=>{if(++outputRows>DASHBOARD_MAX_ROWS)throw Error('JOIN_LIMIT_EXCEEDED');if(materialize)rows.push(Object.fromEntries([...left.columns.map(c=>['left_'+c.name,l?.[c.name]??null]),...right.columns.map(c=>['right_'+c.name,r?.[c.name]??null])]) as DashboardRow);};
 for(const row of left.rows){signal?.throwIfAborted();const k=key(row,mappings.map(m=>m.left)),matches=k===null?undefined:b.keys.get(k);if(matches?.length){matchedLeftRows++;for(const i of matches){matchedRight.add(i);emit(row,right.rows[i]);}}else{unmatchedLeftRows++;if(joinType==='LEFT'||joinType==='FULL')emit(row,null);}}
 if(joinType==='RIGHT'||joinType==='FULL')right.rows.forEach((row,i)=>{signal?.throwIfAborted();if(!matchedRight.has(i))emit(null,row);});
 return {rows,columns,summary:{leftRows:left.rows.length,rightRows:right.rows.length,outputRows,matchedLeftRows,matchedRightRows:matchedRight.size,unmatchedLeftRows,unmatchedRightRows:right.rows.length-matchedRight.size,leftMissingKeys:a.missing,rightMissingKeys:b.missing,leftDuplicateKeys:a.duplicateKeys,rightDuplicateKeys:b.duplicateKeys,cardinality,joinType}};
}
export function suggestRelationships(left:DashboardPreparedData,right:DashboardPreparedData){
 const normalize=(s:string)=>s.toLowerCase().replace(/[\s_-]/g,'');
 const result:{mappings:Mapping;cardinality:Cardinality;matchingDistinctKeys:number;leftDistinctKeys:number;rightDistinctKeys:number;leftMissingKeys:number;rightMissingKeys:number;reason:string}[]=[];
 // Only named-key candidates; matching values alone do not establish business meaning.
 for(const l of left.columns)for(const r of right.columns){if(normalize(l.name)!==normalize(r.name))continue;
 const a=index(left.rows,[l.name]),b=index(right.rows,[r.name]);let matches=0;for(const k of a.keys.keys())if(b.keys.has(k))matches++;
 if(!matches)continue;
 result.push({mappings:[{left:l.name,right:r.name}],cardinality:a.duplicateKeys?(b.duplicateKeys?'MANY_TO_MANY':'MANY_TO_ONE'):(b.duplicateKeys?'ONE_TO_MANY':'ONE_TO_ONE'),matchingDistinctKeys:matches,leftDistinctKeys:a.keys.size,rightDistinctKeys:b.keys.size,leftMissingKeys:a.missing,rightMissingKeys:b.missing,reason:'Matching field names and exact typed key overlap. Review business meaning before confirming.'});
 }
 return result.sort((a,b)=>b.matchingDistinctKeys-a.matchingDistinctKeys).slice(0,20);
}
export type Replacement=DashboardCell;
