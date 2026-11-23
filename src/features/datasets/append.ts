import {DashboardIngestValidationError,prepareDashboardRows,type DashboardRow} from "../../engines/ingestion/ingest";

function keyFor(row:DashboardRow,field:string):string{
 const value=row[field];
 if(value===undefined||value===null||String(value).trim()==="")
  throw new DashboardIngestValidationError("Every imported record needs a nonempty identity value.");
 return typeof value==="number"?String(value):String(value).trim();
}
function stableRow(row:DashboardRow,fields:string[]){
 return JSON.stringify(fields.map(field=>row[field]??null));
}
/**
 * Never silently add the same business record twice.
 * An overlapping row with modified values must use an explicit sync/replace flow,
 * rather than being treated as additional revenue.
 */
export function prepareDashboardAppend(
 previous:DashboardRow[], incoming:DashboardRow[],identityField:string
){
 const field=identityField.trim();
 if(!field||field.length>120)throw new DashboardIngestValidationError("Choose one valid record identity field.");
 const all=[...previous,...incoming];
 if(!all.length||all.some(row=>!(field in row)))
  throw new DashboardIngestValidationError("The identity field must be present in both datasets.");
 const headers=[...new Set(all.flatMap(row=>Object.keys(row)))].sort();
 const seen=new Map<string,string>();
 const combined:DashboardRow[]=[];
 let duplicates=0,overlaps=0;
 for(const row of previous){
  const key=keyFor(row,field),signature=stableRow(row,headers),old=seen.get(key);
  if(old!==undefined)throw new DashboardIngestValidationError("Existing data contains duplicate record identities. Correct or replace it before appending.");
  seen.set(key,signature);combined.push(row);
 }
 for(const row of incoming){
  const key=keyFor(row,field),signature=stableRow(row,headers),old=seen.get(key);
  if(old!==undefined){
   if(old!==signature)throw new DashboardIngestValidationError("Overlapping record identity has changed values. Use a verified synchronize or replace operation.");
   duplicates++;overlaps++;continue;
  }
  seen.set(key,signature);combined.push(row);
 }
 const prepared=prepareDashboardRows(combined);
 return {prepared,addedRows:combined.length-previous.length,duplicateRowsSkipped:duplicates,overlapRows:overlaps};
}
