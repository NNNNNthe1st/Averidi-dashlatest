import type {DashboardPreparedData} from '../../engines/ingestion/ingest';
import type {AnalysisConfirmation,AnalysisQuery,DashboardAnalysis} from '../../engines/analysis/pipeline';
import type {SalesSnapshot,SalesQuestion} from '../../engines/sales/contracts';
import {identifySalesFields} from '../../engines/sales/interpret';
import {salesAvailability} from '../../engines/sales/availability';
import {salesHierarchy,type SalesBreakdowns} from '../../engines/sales/hierarchy';
import {salesFilterOptions,salesDateExtent} from '../../engines/visualization/widgets';
import {calculateSalesCustomMeasures,salesCustomQueryData,salesDocumentMeasures} from '../../engines/sales/custom-measures';
/** Shared-by-view calculation metadata. Actor identity is never placed in this cache. */
export function salesViewContext(prepared:DashboardPreparedData,confirmation:AnalysisConfirmation,profile:SalesSnapshot|undefined,analysis:DashboardAnalysis,query:AnalysisQuery,breakdowns:SalesBreakdowns){
 const selected=analysis.dimensions.map(d=>({...d}));
 for(const concept of ['GEOGRAPHY','CATEGORY'] as const){const field=breakdowns[concept];if(field){const at=selected.findIndex(d=>d.field===field);if(at>=0){const [d]=selected.splice(at,1);selected.unshift({...d,concept});}}}
 const dimensionOptions=salesFilterOptions(prepared.rows,selected);
 const selectedCurrency=analysis.outcomes.find(m=>m.key==='REVENUE')?.lineage.currency??confirmation.metricRules.currency;
 const customMeasures=profile?calculateSalesCustomMeasures(salesCustomQueryData(prepared,query,confirmation.metricRules.timezone),[...salesDocumentMeasures(confirmation),...(profile.answers.customMeasures??[])],selectedCurrency):undefined;
 const fields=profile?.diagnostics?.fields??identifySalesFields(prepared,profile?.answers);
 const questions=(profile?.diagnostics?.questions??[]) as SalesQuestion[];
 const availability=Object.fromEntries(analysis.outcomes.map(m=>[m.key,salesAvailability(m,confirmation,questions,fields,{quality:analysis.quality.status,rows:analysis.outcomes[0]?.lineage.rowCount,query,answers:profile?.answers})]));
 const hierarchy=salesHierarchy(analysis.dimensions,prepared.rows),dateRange=salesDateExtent(prepared.rows,analysis.dimensions,confirmation.metricRules.timezone);
 const country=prepared.columns.find(c=>/^(country|country[ _]?(code|name)|国|pays|pais|país)$/i.test(c.name));
 const countries=country?prepared.rows.map(row=>String(row[country.name]??'').trim().toLowerCase()):[];
 const geographyCountry:'US'|'OTHER'|'UNKNOWN'=countries.length&&countries.every(c=>['us','usa','united states','united states of america'].includes(c))?'US':countries.length&&countries.every(Boolean)?'OTHER':'UNKNOWN';
 return {customMeasures,availability,hierarchy,breakdowns,dimensionOptions,dateRange,geographyCountry};
}
