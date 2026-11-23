import {confirmedConcepts} from "./field-confirmation";
import type { DashboardPreparedData } from "../../engines/ingestion/ingest";
import { inferSemanticModel, inferBusinessOntology, inferPeriodMode } from "../../engines/understanding/semantic-inference";

// Preserve the Dashboard's existing semantic inference while keeping this
// orchestration pure, independent of the website database and authentication.
export function understandPreparedDataset(prepared: DashboardPreparedData) {
  const input = { rows: prepared.rows, columns: prepared.columns, profile: prepared.profile, transformations: [] as [] };
  const fields = inferSemanticModel(input);
  const ontology = inferBusinessOntology(input, fields);
  const periodMode = inferPeriodMode(input, fields);
  // Exact typed labels may be mapped without confirming financial calculation rules.
  const safeNames:Record<string,string>={"order id":"ORDER","customer id":"CUSTOMER","product id":"PRODUCT","order date":"TIME","quantity":"QUANTITY"};
  const normalized=(name:string)=>name.trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
  const confirmedMappings=fields.filter(field=>{
    const concept=safeNames[normalized(field.sourceName)];
    if(!concept||!confirmedConcepts.some(item=>item===concept)||field.confidence<.93)return false;
    if(!(concept==="TIME"?field.dataType==="DATE":concept==="QUANTITY"?field.dataType==="NUMBER":field.dataType==="TEXT"))return false;
    // A confident column name is not sufficient: every source row must agree.
    return prepared.rows.every(row=>{
      const value=row[field.sourceName];
      if(concept==="QUANTITY")return typeof value==="number"&&Number.isFinite(value);
      if(concept==="TIME")return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&!Number.isNaN(Date.parse(value));
      return typeof value==="string"&&value.trim().length>0;
    });
  }).map(field=>({sourceField:field.sourceName,canonicalConcept:safeNames[normalized(field.sourceName)],status:"CONFIRMED" as const,role:"DIMENSION" as const}));
  return {fields,ontology,periodMode,confirmedMappings,confirmationRequired:true as const};
}

/** Safe defaults enable observed-record counts, never financial assumptions. */
export function safeObservedRecordRules(versionId:string,prepared:DashboardPreparedData,mappings:readonly {sourceField:string;canonicalConcept:string}[]){
 if(!mappings.length||prepared.duplicateCount>0)return null;
 return {
  versionId,grain:"RECORD" as const,currency:null,currencyMode:"UNSPECIFIED" as const,
  revenueBasis:"UNKNOWN" as const,costBasis:"UNKNOWN" as const,
  refundsIncluded:null,discountsIncluded:null,taxIncluded:null,shippingIncluded:null,
  cancellationTreatment:"UNKNOWN" as const,returnTreatment:"UNKNOWN" as const,
  rowAmountsConfirmed:false,
 };
}
