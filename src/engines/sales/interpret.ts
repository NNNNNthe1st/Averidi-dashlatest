import {resolveSalesRevenue} from './revenue';
import {salesDecimalOperation} from './decimal-values';
import {inferSalesSchema} from './schema-inference';
import {salesPopulation} from './population';
import {salesRoleCandidates,nonAdditiveSalesField} from './recognition';
import {salesCalendar,salesNumber,salesSourceProjection} from './source-values';
import type {DashboardPreparedData,DashboardRow} from '../ingestion/ingest';
import {recognizeDashboardConcept} from '../understanding/concept-registry';
import {completeUniqueGrainKeys} from '../understanding/row-grain';
import {salesRoles,type SalesAnswers,type SalesField,type SalesQuestion,type SalesProjection,type SalesRole} from './contracts';
import {analysisConfirmationSchema,type AnalysisConfirmation} from '../analysis/query-contracts';

const normalize=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').normalize('NFKC').toLowerCase().trim().replace(/[_\-./]+/g,' ').replace(/\s+/g,' ');
const aliases:Partial<Record<SalesRole,string[]>>={
 ORDER:['order id','order number','order','bestellnummer','numero de pedido','注文番号','注文id','nambari ya agizo'],
 INVOICE:['invoice id','invoice number','invoice no','invoice'],TRANSACTION:['transaction id','transaction number','receipt id','receipt number'],
 LINE_ITEM:['row id','line id','order item id','line item id','invoice line id'],
 CUSTOMER:['customer id','client id','buyer id','customer number','client number','account id','kunden id','顧客id','顧客番号','cliente id'],
 CUSTOMER_NAME:['customer name','client name','buyer name','customer','client','顧客名','nombre del cliente'],
 PRODUCT:['product id','sku','item code','item id','product code','商品id','商品コード'],PRODUCT_NAME:['product name','item name','product','商品名'],
 TIME:['order date','transaction date','invoice date','date','sales date','注文日','取引日','fecha de pedido'],SHIP_DATE:['ship date','shipping date','dispatch date','delivery date','出荷日'],SHIP_MODE:['ship mode','shipping method','delivery method','shipping service','配送方法'],
 REVENUE:['revenue','net sales','net revenue','sales','sales amount','turnover','net amount','売上','売上高','ventas','chiffre d affaires','umsatz'],TAX:['tax','tax amount','sales tax','vat','vat amount','gst'],SHIPPING:['shipping','shipping amount','shipping charge','delivery charge','freight amount'],GROSS:['gross sales','gross revenue','sales before discounts','pre discount sales amount'],
 COST:['cost','total cost','cogs','cost of goods sold','product cost','売上原価'],UNIT_COST:['unit cost','cost per unit','原価単価'],PRICE:['unit price','price','selling price','単価'],PROFIT:['profit','gross profit','net profit','利益','粗利益'],
 REFUND_ELIGIBLE_SALES:['refund eligible sales','sales eligible for refunds'],GROSS_SOLD_QUANTITY:['gross sold quantity','quantity before returns','gross units sold'],
 QUANTITY:['quantity','qty','units','units sold','数量','cantidad'],DISCOUNT:['discount amount','discount total','discounts'],DISCOUNT_RATE:['discount rate','discount percent','discount percentage'],REFUND:['refund amount','refund','refunded amount'],RETURN_QUANTITY:['returned quantity','returned units','return quantity'],
 CATEGORY:['category','product category','department','カテゴリ'],SUBCATEGORY:['sub category','subcategory','product subcategory'],CUSTOMER_SEGMENT:['segment','customer segment','customer tier','buyer segment'],
 GEOGRAPHY:['country','country code','country name','region','state','province','city','territory','market','国','地域','都道府県'],CHANNEL:['sales channel','channel','販売チャネル'],STATUS:['order status','status','注文状態'],CURRENCY:['currency','currency code','通貨'],IDENTIFIER:['postal code','zip code','postcode','reference','id']};
const label=(r:SalesRole)=>salesRoles[r];
const supported=new Set(['ORDER','INVOICE','TRANSACTION','LINE_ITEM','CUSTOMER','PRODUCT','TIME','REVENUE','COST','QUANTITY','DISCOUNT','REFUND','RETURN_QUANTITY','REFUND_ELIGIBLE_SALES','GROSS_SOLD_QUANTITY','CATEGORY','SUBCATEGORY','CUSTOMER_SEGMENT','GEOGRAPHY','CHANNEL','STATUS','IDENTIFIER']);
export function identifySalesFields(data:DashboardPreparedData,answers:SalesAnswers={}):SalesField[]{
 const named=data.columns.map(column=>{
  const key=normalize(column.name),values=data.rows.map(row=>row[column.name]);
  let role=Object.entries(aliases).find(([,list])=>list.includes(key))?.[0] as SalesRole|undefined;
  if(key==='discount')role=values.every(v=>typeof v==='number'&&v>=0&&v<=1)?'DISCOUNT_RATE':'CUSTOM';
  if(!role){const stripped=key.replace(/^(total|recorded|actual) /,'').replace(/ (usd|eur|gbp|kes|jpy|aud|cad|inr|amount|value)$/,'');const matches=Object.entries(aliases).filter(([,list])=>list.includes(stripped));if(matches.length===1)role=matches[0][0] as SalesRole;}
  if(!role){const ranked=salesRoleCandidates(data,column.name);if(ranked[0]?.score>=90&&(!ranked[1]||ranked[0].score>ranked[1].score))role=ranked[0].role;}
  if(!role&&/^(record|row|line) (id|identifier|number|key|reference)$/.test(key))role='IDENTIFIER';
  if(!role){const concept=recognizeDashboardConcept(column.name);role=concept&&(supported.has(concept)||concept.startsWith('SALES_'))?concept as SalesRole:'CUSTOM';}
  if(['REVENUE','GROSS','COST','QUANTITY','PROFIT'].includes(role??'')&&nonAdditiveSalesField(column.name))role='CUSTOM';
  if(answers.overrides&&Object.hasOwn(answers.overrides,column.name))role=answers.overrides[column.name];
  const suggestions=Object.entries(aliases).filter(([r,list])=>r!==role&&list.some(a=>a.split(' ').length>1&&a.split(' ').every(token=>key.split(' ').includes(token)))).map(([r])=>r as SalesRole);
  return {name:column.name,role,type:column.dataType,suggestions:[...new Set([role,...salesRoleCandidates(data,column.name).map(r=>r.role),...suggestions])].slice(0,4),examples:[...new Set(data.rawRows.map(r=>String(r[column.name]??'')).filter(Boolean))].slice(0,3).map(v=>v.slice(0,80)),evidence:role==='CUSTOM'?(nonAdditiveSalesField(column.name)?'This header describes a rate, average, balance or running total; it is not automatically summed as transaction amounts.':'Retained as an additional business field.'):`${label(role)} recognised from its name and checked against source values.`,use:false};
 });
 return inferSalesSchema(data,named,answers).fields;
}
export function projectSalesData(data:DashboardPreparedData,projection:SalesProjection):DashboardPreparedData{
 if(!projection.currencyFields?.length&&!projection.currencySelection&&!projection.completedSales&&!projection.revenueFromUnits&&!projection.rowSelection&&!projection.netFromGross&&!projection.costFromUnits&&!projection.costFromProfit&&!projection.lineKey&&!projection.calendarFields?.length&&!projection.dateFields?.length&&!projection.numericFields?.length&&!projection.blockedFields?.length&&!projection.identityFields?.length&&!projection.labels?.length)return data;
 const rows=data.rows.map((source,index)=>{
  const row={...source};
  for(const field of projection.identityFields??[]){const value=data.rawRows[index]?.[field];row[field]=value===null||value===undefined?null:String(value);}
  for(const field of projection.blockedFields??[])row[field]=null;
  for(const {field,order,locale} of projection.dateFields??[])row[field]=salesCalendar(data.rawRows[index]?.[field],order,locale);
  for(const {field,decimal} of projection.numericFields??[])row[field]=salesNumber(data.rawRows[index]?.[field],decimal);
  for(const field of projection.calendarFields??[]){const original=data.rawRows[index]?.[field];if(typeof original==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(original))row[field]=original;}
  for(const {field,parents} of projection.labels??[]){const value=row[field];if(value!==null&&value!==undefined)row[field]=String(value)+' ('+parents.map(p=>String(row[p]??'')).join(', ')+')';}
  for(const field of projection.currencyFields??[])row[field]=typeof row[field]==='string'?String(row[field]).trim().toUpperCase():row[field];
  if(projection.revenueFromUnits){const p=projection.revenueFromUnits;row[p.field]=typeof row[p.quantity]==='number'&&typeof row[p.unitPrice]==='number'?salesDecimalOperation(row[p.quantity] as number,row[p.unitPrice] as number,'MULTIPLY'):null;}
  if(projection.netFromGross){const p=projection.netFromGross;row[p.field]=typeof row[p.gross]==='number'&&p.deductions.every(f=>typeof row[f]==='number')?p.deductions.reduce<number|null>((total,f)=>total===null?null:salesDecimalOperation(total,row[f] as number,'SUBTRACT'),row[p.gross] as number):null;}
  if(projection.costFromUnits){const p=projection.costFromUnits;row[p.field]=typeof row[p.quantity]==='number'&&typeof row[p.unitCost]==='number'?salesDecimalOperation(row[p.quantity] as number,row[p.unitCost] as number,'MULTIPLY'):null;}
  if(projection.costFromProfit){const p=projection.costFromProfit;row[p.field]=typeof row[p.revenue]==='number'&&typeof row[p.profit]==='number'?salesDecimalOperation(row[p.revenue] as number,row[p.profit] as number,'SUBTRACT'):null;}
  if(projection.lineKey)row[projection.lineKey.field]=String(index+1);
  return row;
 });
 const selected=rows.map((row,i)=>({row,raw:data.rawRows[i]})).filter(({row,raw})=>
  (!projection.rowSelection||projection.rowSelection.confirmed&&!projection.rowSelection.rules.some(rule=>rule.values.includes(String(raw?.[rule.field]??''))))&&
  (!projection.completedSales||!projection.completedSales.excluded.includes(String(raw?.[projection.completedSales.field]??'').trim().toUpperCase()))&&
  (!projection.currencySelection||String(row[projection.currencySelection.field]??'').trim().toUpperCase()===projection.currencySelection.value));
 const extras=[projection.revenueFromUnits?.field,projection.netFromGross?.field,projection.costFromUnits?.field,projection.costFromProfit?.field,projection.lineKey?.field].filter((v):v is string=>!!v);
 return {...data,rows:selected.map(s=>s.row),rawRows:selected.map(s=>s.raw),duplicateCount:projection.rowSelection||projection.completedSales||projection.currencySelection?selected.length-new Set(selected.map(s=>JSON.stringify(s.raw))).size:data.duplicateCount,columns:[...data.columns.map(c=>projection.identityFields?.includes(c.name)?{...c,dataType:'TEXT' as const}:projection.blockedFields?.includes(c.name)?{...c,dataType:'TEXT' as const}:projection.dateFields?.some(f=>f.field===c.name)?{...c,dataType:'DATE' as const}:projection.numericFields?.some(f=>f.field===c.name)?{...c,dataType:'NUMBER' as const}:c),...extras.map(name=>({name,dataType:projection.lineKey?.field===name?'TEXT' as const:'NUMBER' as const}))]};
}
export function interpretSales(source:DashboardPreparedData,versionId:string,answers:SalesAnswers={},preferences:{currency?:string;timezone?:string;locale?:string}={}){
 const identified=identifySalesFields(source,answers);
 const population=salesPopulation(source,identified,answers);
 const eligible=population.projection.rowSelection?.confirmed||population.projection.completedSales||population.projection.currencySelection?projectSalesData(source,population.projection):source;
 const sourceValues=salesSourceProjection(eligible,identified,answers,answers.dateLocale??preferences.locale??'en');
 sourceValues.projection.identityFields=identified.filter(f=>['ORDER','INVOICE','TRANSACTION','LINE_ITEM','CUSTOMER','CUSTOMER_NAME','PRODUCT','PRODUCT_NAME','IDENTIFIER','SALES_OPPORTUNITY_ID','SALES_REPRESENTATIVE'].includes(f.role)).map(f=>f.name);
 for(const measure of answers.customMeasures??[])if(measure.aggregation==='DISTINCT_COUNT'&&!sourceValues.projection.identityFields.includes(measure.field))sourceValues.projection.identityFields.push(measure.field);
 const data=projectSalesData(eligible,sourceValues.projection);
 const fields=identifySalesFields(data,answers),questions:SalesQuestion[]=[...population.questions,...sourceValues.questions],warnings:string[]=[...population.warnings],evidence:string[]=[];
 const schema=inferSalesSchema(data,fields,answers);
 if(schema.ambiguous.includes('TIME')&&!answers.transactionDateField)questions.push({key:'transactionDateField',kind:'field',options:schema.dateCandidates,label:'Which date should Sales reporting use?',detail:'Choose when the sale was recorded. Shipping, collection and service dates may describe different events.'});
 const candidates=(role:SalesRole)=>fields.filter(f=>f.role===role);
 const numeric=(field:SalesField)=>data.rows.length>0&&data.rows.every(r=>typeof r[field.name]==='number'&&Number.isFinite(r[field.name]));
 const one=(role:SalesRole)=>{const found=candidates(role);if(found.length===1)return found[0];if(found.length>1)warnings.push(`More than one column could be ${label(role).toLowerCase()}: ${found.map(f=>f.name).join(', ')}. Use Correct interpretation to select one.`);return undefined;};
 const mappings:AnalysisConfirmation['confirmedMappings']=[];
 const map=(field:SalesField|undefined,concept:string)=>{if(!field)return;field.use=true;mappings.push({sourceField:field.name,canonicalConcept:concept as AnalysisConfirmation['confirmedMappings'][number]['canonicalConcept']});};
 const amount=(role:SalesRole)=>{const f=one(role);if(f&&!numeric(f)){warnings.push(`${f.name} contains missing or non-numeric values. Monetary values must use one consistent number format.`);return undefined;}return f;};
 const cost=amount('COST'),quantity=amount('QUANTITY'),order=one('ORDER'),invoice=one('INVOICE'),transaction=one('TRANSACTION'),document=[order,invoice,transaction].find(f=>f&&completeUniqueGrainKeys(data.rows,[f.name]))??order??invoice??transaction,line=one('LINE_ITEM')??fields.find(f=>f.role==='IDENTIFIER'&&/\b(row|line|record)\b/i.test(f.name.replaceAll('_',' '))&&schema.keys.some(key=>key.includes(f.name)&&key.every(k=>k===f.name||k===document?.name))),time=one('TIME');
 const revenueModel=resolveSalesRevenue(data,answers,amount,quantity);const revenue=revenueModel.revenue;Object.assign(sourceValues.projection,revenueModel.projection);questions.push(...revenueModel.questions);warnings.push(...revenueModel.warnings);evidence.push(...revenueModel.evidence);
 map(revenue,'REVENUE');map(cost,'COST');map(quantity,'QUANTITY');map(order,'ORDER');map(invoice,'INVOICE');if(transaction)map(transaction,'IDENTIFIER');
 // Identity and display names are paired only when both directions are consistent.
 for(const [idRole,nameRole] of [['CUSTOMER','CUSTOMER_NAME'],['PRODUCT','PRODUCT_NAME']] as const){
  const id=one(idRole),name=one(nameRole);
  const complete=(f:SalesField)=>data.rows.every(r=>r[f.name]!==null&&String(r[f.name]).trim()!=='');
  let chosen=id&&complete(id)?id:!id&&name&&complete(name)?name:undefined;
  if(chosen===id&&id&&name&&complete(name)){
   const forward=new Map<string,string>(),back=new Map<string,string>();let consistent=true;
   for(const row of data.rows){const a=String(row[id.name]),b=String(row[name.name]);if(forward.has(a)&&forward.get(a)!==b||back.has(b)&&back.get(b)!==a){consistent=false;break;}forward.set(a,b);back.set(b,a);}
   if(consistent){chosen=name;evidence.push(`${name.name} labels ${id.name}; the relationship is consistent throughout the file.`);}
  }
  map(chosen,idRole);
 }
 if(time&&time.type==='DATE')map(time,'TIME');else if(time)warnings.push(`${time.name} has dates that were not reliably parsed. Use unambiguous dates such as 2026-10-30 or ISO timestamps, then upload again.`);
 for(const role of ['CATEGORY','SUBCATEGORY','CUSTOMER_SEGMENT','CHANNEL','GEOGRAPHY'] as const){
  const preferred=role==='GEOGRAPHY'?answers.geographyField:role==='CATEGORY'?answers.categoryField:undefined;
  if(preferred&&!fields.some(f=>f.name===preferred&&(f.role===role||role==='CATEGORY'&&f.role==='CUSTOM'&&f.type==='TEXT')))throw Error('INVALID_SALES_ANSWERS');
  const list=candidates(role).sort((a,b)=>preferred?(a.name===preferred?-1:b.name===preferred?1:0):(normalize(a.name)==='region'?-1:normalize(b.name)==='region'?1:0));for(const f of list)map(f,role);
 }
 for(const role of ['DISCOUNT','REFUND','RETURN_QUANTITY','REFUND_ELIGIBLE_SALES','GROSS_SOLD_QUANTITY'] as const)map(amount(role),role);
 map(amount('GROSS'),'PRE_DISCOUNT_SALES');
 const status=one('STATUS');if(status&&data.rows.every(r=>['completed','complete','paid','fulfilled','delivered'].includes(String(r[status.name]).toLowerCase().trim())))evidence.push('All recorded order statuses are completed or paid.');
 else if(status){map(status,'STATUS');warnings.push('The file includes order statuses that need review. Cancelled or open orders must not be counted as completed sales.');}
 for(const f of fields.filter(f=>f.role.startsWith('SALES_')))map(f,f.role);
 const projection:SalesProjection={...sourceValues.projection,...population.projection};
 if(population.projection.completedSales)evidence.push('Cancelled, void, pending, processing and open orders are excluded by your completed-sales choice.');
 if(population.projection.currencySelection)evidence.push(`Reporting currency: ${population.projection.currencySelection.value}. Other currencies remain in the original source and are excluded from these results.`);
 if(population.projection.rowSelection?.confirmed)evidence.push(`Summary rows are excluded from calculations by your confirmed row-population choice; the original file remains unchanged.`);
 if(time&&data.rawRows.every(r=>typeof r[time.name]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(String(r[time.name]))))projection.calendarFields=[time.name];let grain:'ORDER'|'ORDER_ITEM'|'INVOICE'|'INVOICE_ITEM'|'TRANSACTION'|'RECORD'='RECORD';
 // Preserve parent context when the same location/subcategory name belongs to different parents.
 for(const field of fields.filter(f=>['GEOGRAPHY','SUBCATEGORY'].includes(f.role))){
  const key=normalize(field.name);
  const parents=field.role==='SUBCATEGORY'?fields.filter(f=>f.role==='CATEGORY'):fields.filter(f=>f.role==='GEOGRAPHY'&&f.name!==field.name&&(normalize(f.name)==='country'||normalize(f.name)==='国'||key==='city'&&['state','province'].includes(normalize(f.name))));
  if(!parents.length||key==='country'||key==='国')continue;
  const associations=new Map<string,Set<string>>();
  for(const row of data.rows){const value=row[field.name];if(value===null||value===undefined)continue;const values=parents.map(p=>row[p.name]);if(values.some(v=>v===null||v===undefined||String(v).trim()===''))continue;const set=associations.get(String(value))??new Set<string>();set.add(JSON.stringify(values));associations.set(String(value),set);}
  if([...associations.values()].some(set=>set.size>1)){(projection.labels??=[]).push({field:field.name,parents:parents.map(p=>p.name)});evidence.push(`${field.name} labels include ${parents.map(p=>p.name).join(' and ')} because the same name occurs under different parents.`);}
 }
 if(document&&completeUniqueGrainKeys(data.rows,[document.name])){grain=document===order?'ORDER':document===invoice?'INVOICE':'TRANSACTION';evidence.push(`Each ${document===order?'order':document===invoice?'invoice':'transaction'} identifier occurs once.`);}
 else if(document&&data.rows.every(r=>r[document.name]!==null&&String(r[document.name]).trim()!=='')){
  const itemGrain=document===invoice?'INVOICE_ITEM':'ORDER_ITEM';
  if(document!==transaction&&line&&completeUniqueGrainKeys(data.rows,[document.name,line.name])){grain=itemGrain;map(line,'LINE_ITEM');}
  else if(document!==transaction&&answers.lineAmounts===true&&data.duplicateCount===0&&data.columns.length<98){grain=itemGrain;projection.lineKey={field:unused(data,'Sales derived line key')};mappings.push({sourceField:projection.lineKey.field,canonicalConcept:'LINE_ITEM'});evidence.push('You confirmed that each row is one order item; source row positions provide stable line identities for this version.');}
  if(document===transaction)warnings.push(`${transaction.name} repeats. Transaction records cannot be summed until a unique transaction identity or consistent source population is supplied.`);
  if(document!==transaction&&answers.lineAmounts===undefined)questions.push({key:'lineAmounts',kind:'boolean',label:'Does each row show one item’s amounts, rather than a total repeated for the whole order?',detail:`${document.name} repeats. For example, an order containing a chair and desk may occupy two rows.`});
 }
 else if(document)warnings.push(`${document.name} has missing identifiers. Order counts cannot be trusted until those records are corrected.`);
 let currency:string|null=null;const currencyField=one('CURRENCY');if(currencyField){map(currencyField,'CURRENCY');(projection.currencyFields??=[]).push(currencyField.name);}
 if(currencyField){const values=[...new Set(data.rows.map(r=>String(r[currencyField.name]??'').trim().toUpperCase()))];if(values.length===1&&validCurrency(values[0])){currency=values[0];evidence.push(`The file specifies ${currency}.`);}else warnings.push('The currency column contains mixed, missing or unsupported currencies. Split or convert the data before calculating monetary totals.');}
 else currency=validCurrency(answers.currency??preferences.currency??'')?(answers.currency??preferences.currency)!:null;
 if(!currency&&!currencyField)questions.push({key:'currency',kind:'currency',label:'Which currency are these amounts in?',detail:'The file does not specify a currency. Enter its three-letter currency code.'});
 let timezone=answers.timezone??preferences.timezone??null;
 if(time&&time.type==='DATE'&&!timezone){
  if(sourceValues.projection.dateFields?.length)timezone='UTC';
  const dateOnly=data.rawRows.every(r=>typeof r[time.name]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(String(r[time.name])));
  if(dateOnly){timezone='UTC';evidence.push('Dates contain calendar days without times; days are preserved as written.');}
  else questions.push({key:'timezone',kind:'timezone',label:'Which business timezone should these dates use?',detail:'For timestamps, this determines which business day a sale belongs to. For example: Asia/Tokyo or Europe/London.'});
 }
 if(timezone){try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('INVALID_SALES_ANSWERS');}}
 const {netConfirmed,accountingFacts}=revenueModel;const gross=amount('GROSS'),discount=amount('DISCOUNT');
 if(cost&&answers.costIsProductCost===undefined)questions.push({key:'costIsProductCost',kind:'boolean',label:`Does “${cost.name}” contain the cost of the products or services sold, rather than total business expenses?`,detail:'This is needed to label the difference as gross profit. Recorded cost can still be shown separately.'});
 if(!cost&&quantity&&data.columns.length<98){const uc=amount('UNIT_COST');if(uc){projection.costFromUnits={quantity:quantity.name,unitCost:uc.name,field:unused(data,'Sales derived product cost')};mappings.push({sourceField:projection.costFromUnits.field,canonicalConcept:'COST'});evidence.push(`Product cost is calculated from ${uc.name} × ${quantity.name}.`);}}
 if(!cost&&!projection.costFromUnits&&revenue&&data.columns.length<98){const profit=amount('PROFIT');if(profit){if(answers.profitIsGross===undefined)questions.push({key:'profitIsGross',kind:'boolean',label:`Does “${profit.name}” mean gross profit: sales minus the cost of the items sold?`,detail:'If yes, product cost can be calculated from sales minus gross profit. Net profit after overhead cannot be used this way.'});if(answers.profitIsGross===true){projection.costFromProfit={revenue:revenue.name,profit:profit.name,field:unused(data,'Sales derived product cost')};mappings.push({sourceField:projection.costFromProfit.field,canonicalConcept:'COST'});}}}
 if(candidates('RETURN_QUANTITY').length&&answers.quantityNet===undefined)questions.push({key:'quantityNet',kind:'boolean',label:'Does Quantity already exclude returned items?',detail:'This prevents returns from being deducted twice.'});
 // Preserve additional text dimensions for Sales filtering without selecting them as primary categories.
 for(const f of fields.filter(f=>!f.use&&f.role==='CUSTOM'&&f.type==='TEXT'))map(f,'CATEGORY');
 if(!mappings.length){const f=fields.find(f=>f.role!=='IGNORE');if(f)map(f,'IDENTIFIER');}
 if(time&&revenue&&answers.salesHistory===undefined)questions.push({key:'salesHistory',kind:'boolean',optional:true,label:'Does this file include every sale during its covered dates?',detail:'Optional: enables period totals and history-based insights. Days with no records will be treated as days with no sales only if you answer Yes.'});
 if(mappings.some(m=>m.canonicalConcept==='CUSTOMER')&&time&&answers.customerHistory===undefined)questions.push({key:'customerHistory',kind:'boolean',optional:true,label:'Does this file include each represented customer’s purchases since their first purchase?',detail:'Optional: needed to distinguish first-time customers and historical customer value. A recent export alone is usually not complete lifetime history.'});
 const optional=(key:SalesQuestion['key'],label:string,detail:string)=>{if(answers[key]===undefined)questions.push({key,kind:'boolean',optional:true,label,detail});};
 if(candidates('SALES_REPRESENTATIVE').length&&revenue)optional('representativeAttribution','Is every sale assigned to exactly one salesperson, with no repeated amounts?','Enables sales per representative when the identifiers and sales amounts are usable.');
 if(candidates('SALES_OPPORTUNITY_ID').length)optional('opportunitiesComplete','Does this file contain the complete set of opportunities you want to measure, with their qualification and outcomes recorded?','Enables opportunity conversion and win rates. Missing or inconsistent identifiers still block those calculations.');
 if(candidates('SALES_OPEN_PIPELINE_VALUE').length)optional('pipelineSnapshot','Are these open opportunity amounts one current snapshot in the same currency?','Do not answer Yes for stacked daily snapshots of the same opportunities.');
 if(candidates('SALES_OPPORTUNITY_OPENED').length&&candidates('SALES_OPPORTUNITY_CLOSED').length)optional('opportunityDatesComplete','Are opening and closing dates complete for every qualified closed opportunity?','Enables elapsed calendar-day sales-cycle calculations.');
 if(mappings.some(m=>m.canonicalConcept==='PRODUCT')&&quantity&&revenue&&time)optional('productComparable','Are product identities, quantity units, and the sales basis consistent across the periods you want to compare?','Enables price, volume and product-mix analysis after selecting comparable date periods.');
 if(answers.salesHistory===true){if(answers.forecastDays===undefined)questions.push({key:'forecastDays',kind:'number',optional:true,label:'How many days ahead would you like to evaluate a forecast?',detail:'Optional. A historical validation is shown only when enough complete daily history is available.'});if(answers.forecastDays!==undefined&&answers.forecastSeason===undefined)questions.push({key:'forecastSeason',kind:'number',optional:true,label:'How many days are in the repeating sales cycle?',detail:'For example, 7 for a weekly pattern. The history must be long enough to evaluate this pattern.'});}
 if(!status&&(gross&&discount||candidates('REFUND').length||candidates('RETURN_QUANTITY').length))optional('completedSalesPopulation','Do these rows contain completed sales only, with cancelled orders excluded?','Optional: needed for discount, refund and return rates when no status column establishes the sales population.');
 if(answers.customerHistory===true&&answers.salesHistory===true&&answers.cohortMonth===undefined)questions.push({key:'cohortMonth',kind:'month',optional:true,label:'Which first-purchase month would you like to analyse?',detail:'Select a customer cohort month. This requires complete purchase history and a reporting period after the cohort began.'});
 if(answers.topN===undefined)questions.push({key:'topN',kind:'number',optional:true,label:'How many of your largest customers should the concentration insight include?',detail:'Optional. Defaults to the top 5 customers, or products when customer identities are absent. Choose from 1 to 100.'});
 if(revenue&&time){
  for(const [key,label,kind] of [['planningStart','Sales plan start date','date'],['planningEnd','Sales plan end date','date'],['targetAmount','Sales target for that period','money'],['budgetAmount','Revenue budget for that period','money'],['sellingDays','Eligible selling days in that period','number']] as const)if(answers[key]===undefined)questions.push({key,label,kind,optional:true,detail:'Optional. Planning results appear only when the dashboard date filter exactly matches this period and the plan covers the same sales population.'});
  if(answers.planningStart&&answers.planningEnd)optional('planningConfirmed','Do these planning values cover exactly these dates and the same sales population?','Do not use annual targets for a monthly selection, or whole-company targets for a filtered segment.');
 }
 if(candidates('REFUND').length&&candidates('REFUND_ELIGIBLE_SALES').length)optional('refundPopulation','Do refunds and refund-eligible sales cover the same transactions and period, with no repeated amounts?','Enables the refund rate without treating all sales as eligible by assumption.');
 if(candidates('RETURN_QUANTITY').length&&candidates('GROSS_SOLD_QUANTITY').length)optional('returnPopulation','Do returned units and units before returns cover the same products and period in the same units?','Enables the unit return rate.');
 if(answers.salesHistory===true)optional('growthComparable','Are the selected segment and comparison periods complete and on the same sales basis?','Enables contribution to growth after selecting one segment and a comparable reporting period.');
 if(answers.categoryField){const at=mappings.findIndex(m=>m.sourceField===answers.categoryField&&m.canonicalConcept==='CATEGORY');if(at>=0){const [chosen]=mappings.splice(at,1);mappings.unshift(chosen);}}
 const confirmation=analysisConfirmationSchema.parse({salesEngine:{version:3,arithmetic:'DECIMAL'},confirmedMappings:mappings,metricRules:{versionId,grain,rowAmountsConfirmed:!['ORDER_ITEM','INVOICE_ITEM'].includes(grain)||answers.lineAmounts===true,currency,currencyMode:currency?'SINGLE':currencyField?'MULTI':'UNSPECIFIED',timezone,revenueBasis:(netConfirmed||!!projection.netFromGross)&&!(document&&grain==='RECORD')?'NET':'UNKNOWN',costBasis:answers.costIsProductCost===true||projection.costFromUnits||projection.costFromProfit?'COGS':'UNKNOWN',refundsIncluded:(netConfirmed||!!projection.netFromGross)?true:null,discountsIncluded:(netConfirmed||!!projection.netFromGross)?true:null,taxIncluded:(netConfirmed||!!projection.netFromGross)?false:null,shippingIncluded:(netConfirmed||!!projection.netFromGross)?false:null,cancellationTreatment:(status&&!mappings.some(m=>m.canonicalConcept==='STATUS')||!status&&answers.completedSalesPopulation===true)?'ALREADY_EXCLUDED':'UNKNOWN',returnTreatment:!candidates('RETURN_QUANTITY').length||answers.quantityNet===true?'ALREADY_NETTED':answers.quantityNet===false?'DEDUCT_RETURNED_UNITS':'UNKNOWN',salesTargetAmount:answers.targetAmount,salesBudgetAmount:answers.budgetAmount,salesEligibleSellingDays:answers.sellingDays,salesPlanningPeriodStart:answers.planningStart,salesPlanningPeriodEnd:answers.planningEnd,salesPlanningBasisConfirmed:answers.planningConfirmed===true,salesRefundBasisConfirmed:answers.refundPopulation===true,salesReturnBasisConfirmed:answers.returnPopulation===true,salesGrowthContributionBasisConfirmed:answers.growthComparable===true,salesCohortMonth:answers.cohortMonth,salesTopN:answers.topN??5,salesConcentrationConcept:mappings.some(m=>m.canonicalConcept==='CUSTOMER')?'CUSTOMER':mappings.some(m=>m.canonicalConcept==='PRODUCT')?'PRODUCT':'CATEGORY',salesRepresentativeAttributionConfirmed:answers.representativeAttribution===true,salesOpportunityCohortConfirmed:answers.opportunitiesComplete===true,salesPipelineSnapshotConfirmed:answers.pipelineSnapshot===true,salesCycleBasisConfirmed:answers.opportunityDatesComplete===true,salesPriceVolumeBasisConfirmed:answers.productComparable===true,salesVolatilityPeriodConfirmed:answers.salesHistory===true,salesForecastBasisConfirmed:answers.salesHistory===true&&answers.forecastDays!==undefined&&answers.forecastSeason!==undefined,salesForecastHorizonDays:answers.forecastDays,salesForecastSeasonDays:answers.forecastSeason,salesHistoryConfirmed:answers.salesHistory===true,customerHistoryConfirmed:answers.customerHistory===true,salesDiscountBasisConfirmed:!!gross&&!!discount&&(netConfirmed||!!projection.netFromGross)}});
 return {availableCurrencies:population.availableCurrencies,accountingFacts,schema:{profiles:schema.profiles,keys:schema.keys,ambiguous:schema.ambiguous},fields,questions,warnings,evidence,confirmation,projection,grain,rows:data.rows.length};
}
function unused(data:DashboardPreparedData,name:string){let value=name;while(data.columns.some(f=>f.name===value))value+=' derived';return value;}
function validCurrency(value:string){return /^[A-Z]{3}$/.test(value)&&Intl.supportedValuesOf('currency').includes(value);}
