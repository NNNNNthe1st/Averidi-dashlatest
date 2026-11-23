import type {DashboardAnalysis} from '../analysis/pipeline';
export const salesPanels={trend:{label:'Sales and profit trend',metrics:['REVENUE','PROFIT'],concepts:['TIME']},category:{label:'Sales by category',metrics:['REVENUE'],concepts:['CATEGORY']},subcategories:{label:'Subcategory ranking',metrics:['REVENUE'],concepts:['SUBCATEGORY']},region:{label:'Sales by location',metrics:['REVENUE'],concepts:['GEOGRAPHY']},segments:{label:'Customer segments',metrics:['REVENUE'],concepts:['CUSTOMER_SEGMENT']},heatmap:{label:'Sales by date',metrics:['REVENUE'],concepts:['TIME']},customers:{label:'Customer ranking',metrics:['REVENUE','ORDERS'],concepts:['CUSTOMER']},products:{label:'Product profitability',metrics:['REVENUE','PROFIT'],concepts:['PRODUCT']}} as const;
const names:Record<string,string>={TIME:'sales date',CATEGORY:'product category',SUBCATEGORY:'product subcategory',GEOGRAPHY:'location',CUSTOMER_SEGMENT:'customer segment',CUSTOMER:'customer',PRODUCT:'product'};
export function salesPanelCapability(panel:keyof typeof salesPanels,analysis:Pick<DashboardAnalysis,'outcomes'|'dimensions'|'quality'>){
 const contract=salesPanels[panel];
 if(!analysis.quality.selectedRows)return {ready:false,reason:'No records match the current selection. Clear or adjust your filters.',target:'sales-filters'};
 const missing=contract.concepts.filter(concept=>!analysis.dimensions.some(d=>d.concept===concept));
 if(missing.length)return {ready:false,reason:`This chart needs a ${missing.map(c=>names[c]??c.toLowerCase()).join(' and ')} field. Review the column meanings if your file contains it.`,target:'sales-corrections'};
 const blocked=contract.metrics.map(key=>analysis.outcomes.find(m=>m.key===key)).filter(m=>!m||m.status!=='READY');
 if(blocked.length)return {ready:false,reason:blocked.find(m=>m?.reason)?.reason??'This chart needs confirmed sales amounts. Review the Sales calculation details.',target:'sales-questions'};
 return {ready:true,reason:'Available from the selected records.',target:'sales-results'};
}
export function salesReadiness(analysis:Pick<DashboardAnalysis,'outcomes'|'dimensions'|'quality'>){
 const panels=Object.entries(salesPanels).map(([key,contract])=>({key,label:contract.label,...salesPanelCapability(key as keyof typeof salesPanels,analysis)}));
 const cards=analysis.outcomes.filter(m=>['REVENUE','PROFIT','GROSS_MARGIN','ORDERS','CUSTOMERS','AVERAGE_ORDER_VALUE'].includes(m.key));
 return {panels,availableCards:cards.filter(m=>m.status==='READY').map(m=>m.definition.label),missingCards:cards.filter(m=>m.status!=='READY').map(m=>m.definition.label),monetaryReady:cards.some(m=>m.key==='REVENUE'&&m.status==='READY'),availableCharts:panels.filter(p=>p.ready).length};
}
