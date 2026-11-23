import {prepareDashboardRows} from '../../engines/ingestion/ingest';
import {interpretSales,projectSalesData} from '../../engines/sales/interpret';
import {analyzeDashboardData} from '../../engines/analysis/pipeline';
import {analysisQuerySchema} from '../../engines/analysis/query-contracts';
import {generateDashboardConfig} from '../../engines/generation/dashboard-templates';
import {buildDashboardWidgets} from '../../engines/visualization/widgets';
import {salesViewContext} from '../sales/view-context';
const version='fictional-sales-v2';
const rows=Array.from({length:144},(_,i)=>{const month=Math.floor(i/6),item=i%6,quantity=1+i%4,price=[120,80,200,60,40,150][item];return {'Order ID':'DEMO-'+String(i+1).padStart(4,'0'),'Order Date':`${2024+Math.floor(month/12)}-${String(month%12+1).padStart(2,'0')}-${String(item*4+1).padStart(2,'0')}`,'Customer ID':'C'+i%12,'Customer Name':'Sample customer '+i%12,'Product ID':'P'+item,'Product Name':['Desk','Chair','Laptop','Lamp','Notebook','Printer'][item],Category:item<2?'Furniture':item<4?'Technology':'Office supplies',Subcategory:['Desks','Chairs','Computers','Lighting','Paper','Printers'][item],Segment:['Consumer','Corporate','Home Office'][i%3],Country:'United States',Region:['West','East','Central','South'][i%4],State:['California','New York','Illinois','Texas'][i%4],City:['Los Angeles','New York','Chicago','Austin'][i%4],Sales:quantity*price,Cost:quantity*price*.6,Quantity:quantity,Currency:'USD','Order Status':'Completed'};});
/** Accepts only bounded query controls over fixed fictional records. */
export function buildSalesDemo(input:unknown={filters:[],compare:false}){
 const query=analysisQuerySchema.parse(input),prepared=prepareDashboardRows(rows,['Order ID','Customer ID','Product ID']),i=interpretSales(prepared,version,{recordedNet:true,costIsProductCost:true,salesHistory:true,customerHistory:true}),projected=projectSalesData(prepared,i.projection);
 const analysis=analyzeDashboardData(projected,version,i.confirmation),definition=generateDashboardConfig('SALES',analysis.outcomes,'Fictional Sales sample',false,false,false,analysis.dimensions);
 const data=buildDashboardWidgets(definition,projected,version,i.confirmation,query);
 return {...data,...salesViewContext(projected,i.confirmation,undefined,data.analysis,query,{}),identity:{workspaceName:'Fictional sample',displayName:'Sample visitor'}};
}
