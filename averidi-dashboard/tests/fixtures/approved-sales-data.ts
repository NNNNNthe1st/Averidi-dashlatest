import {prepareDashboardRows} from '../../src/engines/ingestion/ingest';
import {analyzeDashboardData,type AnalysisConfirmation,type AnalysisQuery} from '../../src/engines/analysis/pipeline';
import {generateDashboardConfig} from '../../src/engines/generation/dashboard-templates';
import {buildDashboardWidgets,salesFilterOptions,salesDateExtent} from '../../src/engines/visualization/widgets';
import type {SalesDashboardData} from '../../src/components/sales/contracts';
const rows=Array.from({length:40},(_,i)=>({Order:'O'+i,Sales:100+i*13,Cost:60+i*4,Date:`${i<8?'2025-12':i<24?'2026-01':'2026-02'}-${String(i%8+1).padStart(2,'0')}`,Customer:['Alice','Bob','Carol','Dan','Eve'][i%5],Product:['Laptop','Chair','Binder','Phone','Table'][i%5],Category:['Technology','Furniture','Office Supplies'][i%3],Subcategory:['Phones','Chairs','Storage','Tables','Binders'][i%5],Region:['West','East','Central','South'][i%4],Segment:['Consumer','Corporate','Home Office'][i%3]}));
const prepared=prepareDashboardRows(rows,'ALL');
const confirmation:AnalysisConfirmation={confirmedMappings:([['Order','ORDER'],['Sales','REVENUE'],['Cost','COST'],['Date','TIME'],['Customer','CUSTOMER'],['Product','PRODUCT'],['Category','CATEGORY'],['Subcategory','SUBCATEGORY'],['Region','GEOGRAPHY'],['Segment','CUSTOMER_SEGMENT']] as const).map(([sourceField,canonicalConcept])=>({sourceField,canonicalConcept})),metricRules:{versionId:'approved-sales-test',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',timezone:'UTC'}};
export function approvedSalesFixture(query:AnalysisQuery={filters:[],compare:false}):SalesDashboardData{
 const analysis=analyzeDashboardData(prepared,'approved-sales-test',confirmation,query);
 const definition=generateDashboardConfig('SALES',analysis.outcomes,'Sales',false,false,false,analysis.dimensions);
 return {...buildDashboardWidgets(definition,prepared,'approved-sales-test',confirmation,query),dateRange:salesDateExtent(prepared.rows,analysis.dimensions,'UTC'),dimensionOptions:salesFilterOptions(prepared.rows,analysis.dimensions),identity:{workspaceName:'Connected QA workspace',displayName:'Nicholas Mwaniki'}};
}
