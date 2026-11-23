import type {DashboardRow} from "../ingestion/ingest";
import {dashboardConceptExists} from "../understanding/concept-registry";

/** Whitelisted projection from source-specific names into canonical metric fields.
 * The original dataset stays unchanged; only confirmed unique concepts cross the
 * metric calculation boundary. Ambiguous concepts are deliberately excluded. */
export type CanonicalFieldMapping={sourceField:string;canonicalConcept:string;status:string;role:string};
export function projectDashboardBusinessRows(rows:DashboardRow[],mappings:CanonicalFieldMapping[]){
 const approved=mappings.filter(m=>m.role!=="IGNORE"&&dashboardConceptExists(m.canonicalConcept)&&["CONFIRMED","AUTO_CONFIRMED"].includes(m.status));
 const grouped=new Map<string,CanonicalFieldMapping[]>();
 for(const mapping of approved)grouped.set(mapping.canonicalConcept,[...(grouped.get(mapping.canonicalConcept)??[]),mapping]);
 const unique=[...grouped].filter(([,items])=>items.length===1&&items[0].canonicalConcept!=="UNKNOWN")
  .map(([concept,items])=>({concept,source:items[0].sourceField}));
 return rows.map(row=>Object.fromEntries(unique.map(({concept,source})=>[concept,row[source]??null])) as DashboardRow);
}
