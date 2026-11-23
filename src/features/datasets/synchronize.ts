import {DashboardIngestValidationError,prepareDashboardRows,type DashboardRow} from "../../engines/ingestion/ingest";

function recordKey(row:DashboardRow,field:string){
 const value=row[field];
 if(value===null||value===undefined||String(value).trim()==="")
  throw new DashboardIngestValidationError("Every synchronized record requires a stable, nonempty identity.");
 return String(value).trim();
}
function uniqueRows(rows:DashboardRow[],field:string,label:string){
 const seen=new Map<string,DashboardRow>();
 for(const row of rows){
  if(!(field in row))throw new DashboardIngestValidationError(label+" is missing the record identity field.");
  const key=recordKey(row,field);
  if(seen.has(key))throw new DashboardIngestValidationError(label+" contains duplicate identities.");
  seen.set(key,row);
 }
 return seen;
}
/** Pure synchronize contract for future provider snapshots, without provider access.
 * A snapshot is authoritative only when explicitly marked complete.
 * Supports corrected and late-arriving records without accumulating duplicate revenue.
 */
export function prepareDashboardSynchronization(
 previous:DashboardRow[],snapshot:DashboardRow[],identityField:string,
 options:{completeSnapshot:boolean}
){
 const field=identityField.trim();
 if(!field||field.length>120)throw new DashboardIngestValidationError("A valid identity field is required.");
 if(options.completeSnapshot!==true)throw new DashboardIngestValidationError("Incomplete snapshots cannot delete or replace existing records.");
 const old=uniqueRows(previous,field,"Existing dataset");
 const current=uniqueRows(snapshot,field,"New snapshot");
 let added=0,updated=0,removed=0,unchanged=0;
 const fields=[...new Set([...previous,...snapshot].flatMap(row=>Object.keys(row)))].sort();
 const signature=(row:DashboardRow)=>JSON.stringify(fields.map(col=>row[col]??null));
 for(const [key,row] of current){
  const prior=old.get(key);
  if(!prior)added++;
  else if(signature(prior)===signature(row))unchanged++;
  else updated++;
 }
 for(const key of old.keys())if(!current.has(key))removed++;
 const prepared=prepareDashboardRows(snapshot);
 return {prepared,added,updated,removed,unchanged};
}
