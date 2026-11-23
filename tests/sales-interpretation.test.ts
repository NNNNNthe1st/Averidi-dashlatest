import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {interpretSales,projectSalesData} from '../src/engines/sales/interpret';
import {analyzeDashboardData} from '../src/engines/analysis/pipeline';
import {salesMetricText} from '../src/engines/sales/contracts';
const prepare=(rows:unknown[])=>prepareDashboardFile({bytes:Buffer.from(JSON.stringify(rows)),fileName:'sales.json'});
test('exact customer CSV: 1000 rows, roles, independent counts, financial questions, all supported totals and dimensions',async()=>{
 const data=await prepareDashboardFile({bytes:await readFile(new URL('./fixtures/sales-1000.csv',import.meta.url)),fileName:'sales.csv'});
 const first=interpretSales(data,'version');assert.equal(first.rows,1000);assert.equal(first.grain,'ORDER');
 assert.deepEqual(first.questions.filter(q=>!q.optional).map(q=>q.key),['refundsAlreadyApplied','taxExcluded','deliveryExcluded','costIsProductCost']);
 assert.equal(first.fields.find(f=>f.name==='Ship Date')?.role,'SHIP_DATE');assert.equal(first.fields.find(f=>f.name==='Segment')?.role,'CUSTOMER_SEGMENT');
 const counts=analyzeDashboardData(projectSalesData(data,first.projection),'version',first.confirmation);
 assert.equal(counts.outcomes.find(m=>m.key==='ORDERS')?.value,1000);assert.equal(counts.outcomes.find(m=>m.key==='CUSTOMERS')?.value,120);
 const interpreted=interpretSales(data,'version',{recordedNet:true,costIsProductCost:true,salesHistory:true,customerHistory:false});
 assert.equal(interpreted.questions.filter(q=>!q.optional).length,0);
 const result=analyzeDashboardData(projectSalesData(data,interpreted.projection),'version',interpreted.confirmation);
 assert.equal(result.quality.status,'PASS');
 for(const [key,value] of Object.entries({REVENUE:949294.07,COST:692555.30,PROFIT:256738.77,ORDERS:1000,CUSTOMERS:120,UNITS:4237,AVERAGE_ORDER_VALUE:949.29407})){
  const m=result.outcomes.find(m=>m.key===key)!;assert.equal(m.status,'READY',m.reason??key);assert.ok(Math.abs(m.value!-value)<1e-6,key);
 }
 for(const key of ['SALES_MTD','SALES_QTD','SALES_YTD','SALES_CUMULATIVE','SALES_REVENUE_PER_CUSTOMER','SALES_DISCOUNT_RATE','REPEAT_PURCHASE_RATE'])assert.equal(result.outcomes.find(m=>m.key===key)?.status,'READY',key);
 assert.ok(result.dimensions.some(d=>d.field==='Subcategory'&&d.concept==='SUBCATEGORY'));
 assert.ok(result.dimensions.some(d=>d.field==='Segment'&&d.concept==='CUSTOMER_SEGMENT'));
 assert.equal(first.confirmation.metricRules.revenueBasis,'UNKNOWN');
});
test('repeated orders need line-amount clarification; confirmed source lines do not duplicate order counts',async()=>{
 const data=await prepare([{ 'Order ID':'a','Sales':20,'Product':'chair'},{'Order ID':'a','Sales':30,'Product':'desk'}]);
 const unknown=interpretSales(data,'v',{currency:'EUR',recordedNet:true});
 assert.ok(unknown.questions.some(q=>q.key==='lineAmounts'));assert.equal(unknown.confirmation.metricRules.revenueBasis,'UNKNOWN');
 const known=interpretSales(data,'v',{currency:'EUR',recordedNet:true,lineAmounts:true});assert.equal(known.grain,'ORDER_ITEM');
 const result=analyzeDashboardData(projectSalesData(data,known.projection),'v',known.confirmation);
 assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,50);assert.equal(result.outcomes.find(m=>m.key==='ORDERS')?.value,1);
});
test('currency is not assumed; timestamps need timezone; mixed currencies do not produce monetary totals',async()=>{
 const source=[{'Order ID':'1',Revenue:100,'Order Date':'2026-01-01T10:00:00Z',Currency:'JPY'},{'Order ID':'2',Revenue:200,'Order Date':'2026-01-02T10:00:00Z',Currency:'EUR'}];
 const data=await prepare(source),mixed=interpretSales(data,'v',{recordedNet:true});
 assert.equal(mixed.confirmation.metricRules.currency,null);assert.ok(mixed.warnings.some(s=>s.includes('mixed')));assert.ok(mixed.questions.some(q=>q.key==='timezone'));
 const absent=await prepare(source.map(({Currency,...r})=>r)),unknown=interpretSales(absent,'v');assert.ok(unknown.questions.some(q=>q.key==='currency'));
 const jp=interpretSales(absent,'v',{currency:'JPY',timezone:'Asia/Tokyo',recordedNet:true});assert.equal(jp.confirmation.metricRules.currency,'JPY');
});
test('derive cost only from confirmed gross profit or explicit unit cost; retain custom fields and calendar days',async()=>{
 const data=await prepare([{'Order ID':'1',Revenue:100,Profit:20,'Order Date':'2026-01-01',Branch:'Kyoto'},{'Order ID':'2',Revenue:200,Profit:50,'Order Date':'2026-01-02',Branch:'Osaka'}]);
 const uncertain=interpretSales(data,'v',{currency:'JPY',recordedNet:true},{timezone:'America/New_York'});assert.equal(uncertain.projection.costFromProfit,undefined);
 const known=interpretSales(data,'v',{currency:'JPY',recordedNet:true,profitIsGross:true},{timezone:'America/New_York'});
 const projected=projectSalesData(data,known.projection);assert.equal(projected.rows[0]['Order Date'],'2026-01-01');
 const result=analyzeDashboardData(projected,'v',known.confirmation);assert.equal(result.outcomes.find(m=>m.key==='COST')?.value,230);assert.ok(result.dimensions.some(d=>d.field==='Branch'));
 assert.equal(data.columns.length,5);assert.equal(data.rows[0]['Sales derived product cost'],undefined);
});
test('percentage formatting and non-Latin business names',async()=>{
 assert.equal(salesMetricText({status:'READY',value:.9849,definition:{format:'PERCENT'}},'en','USD'),'98.49%');
 const data=await prepare([{'注文番号':'1','顧客名':'A','売上高':100,'数量':2},{'注文番号':'2','顧客名':'B','売上高':200,'数量':3}]);
 const result=interpretSales(data,'v',{currency:'JPY',recordedNet:true});assert.equal(result.grain,'ORDER');assert.equal(result.confirmation.confirmedMappings.find(m=>m.canonicalConcept==='REVENUE')?.sourceField,'売上高');
});

test('ambiguous date and number conventions ask once and do not silently choose US formats',async()=>{
 const data=await prepare([{'Order ID':'1','Order Date':'03/04/2026',Revenue:'1,234',Cost:'0,500'},{'Order ID':'2','Order Date':'04/05/2026',Revenue:'2,345',Cost:'0,600'}]);
 const first=interpretSales(data,'v',{currency:'EUR',recordedNet:true,costIsProductCost:true});
 assert.ok(first.questions.some(q=>q.key==='dateFormat'));assert.ok(first.questions.some(q=>q.key==='numberFormat'));
 assert.equal(first.confirmation.confirmedMappings.some(m=>m.canonicalConcept==='REVENUE'),false);
 assert.equal(first.confirmation.confirmedMappings.some(m=>m.canonicalConcept==='TIME'),false);
 const known=interpretSales(data,'v',{currency:'EUR',recordedNet:true,costIsProductCost:true,dateFormat:'DAY_FIRST',numberFormat:'COMMA'});
 const projected=projectSalesData(data,known.projection);assert.equal(projected.rows[0]['Order Date'],'2026-04-03');assert.equal(projected.rows[0].Revenue,1.234);
 const result=analyzeDashboardData(projected,'v',known.confirmation);assert.ok(Math.abs(result.outcomes.find(m=>m.key==='REVENUE')!.value!-3.579)<1e-9);
});

test('Sales chart scope preserves governed core calculations and comparisons',async()=>{
 const data=await prepare([{'Order ID':'1',Revenue:100,Cost:70,'Order Date':'2026-01-01'}, {'Order ID':'2',Revenue:200,Cost:120,'Order Date':'2026-02-01'}]);
 const prepared=interpretSales(data,'v',{currency:'EUR',recordedNet:true,costIsProductCost:true,salesHistory:true});
 const projected=projectSalesData(data,prepared.projection);
 const query={filters:[{type:'DATE_RANGE' as const,field:'Order Date',value:'2026-02-01',end:'2026-02-28'}],compare:true};
 const full=analyzeDashboardData(projected,'v',prepared.confirmation,query),chart=analyzeDashboardData(projected,'v',prepared.confirmation,query,projected.rows,'SALES_CHART');
 for(const metric of chart.outcomes){assert.deepEqual(metric,full.outcomes.find(m=>m.key===metric.key));assert.deepEqual(chart.comparison?.[metric.key],full.comparison?.[metric.key]);}
});

test('customer-specific identity corrections preserve original leading zeros',async()=>{
 const data=await prepareDashboardFile({bytes:Buffer.from('Order ID,ContactCode,Revenue\n1,001,20\n2,01,30\n'),fileName:'codes.csv'});
 const interpreted=interpretSales(data,'v',{currency:'EUR',recordedNet:true,overrides:{ContactCode:'CUSTOMER'}});
 const projected=projectSalesData(data,interpreted.projection);
 assert.deepEqual(projected.rows.map(r=>r.ContactCode),['001','01']);
 assert.equal(analyzeDashboardData(projected,'v',interpreted.confirmation).outcomes.find(m=>m.key==='CUSTOMERS')?.value,2);
});

test('location and subcategory labels retain parent context without merging different businesses',async()=>{
 const data=await prepare([{'Order ID':'1',Revenue:100,Country:'France',State:'Ile-de-France',City:'Paris',Category:'Furniture',Subcategory:'Accessories'}, {'Order ID':'2',Revenue:200,Country:'United States',State:'Texas',City:'Paris',Category:'Technology',Subcategory:'Accessories'}]);
 const result=interpretSales(data,'v',{currency:'EUR',recordedNet:true,geographyField:'City'});
 assert.equal(result.confirmation.confirmedMappings.find(m=>m.canonicalConcept==='GEOGRAPHY')?.sourceField,'City');
 const projected=projectSalesData(data,result.projection);
 assert.notEqual(projected.rows[0].City,projected.rows[1].City);assert.notEqual(projected.rows[0].Subcategory,projected.rows[1].Subcategory);
 assert.equal(data.rows[0].City,'Paris');assert.equal(data.rows[0].Subcategory,'Accessories');
});

test('gross-to-net uses an explicit adjustment formula and never deducts twice',async()=>{
 const data=await prepare([{'Order ID':'01','Gross Sales':120,'Discount Amount':10,'Refund Amount':5,'Tax Amount':8,'Delivery Charge':2,Currency:'USD'},{'Order ID':'02','Gross Sales':200,'Discount Amount':0,'Refund Amount':0,'Tax Amount':10,'Delivery Charge':5,Currency:'USD'}]);
 const first=interpretSales(data,'v');assert.ok(first.questions.some(q=>q.key==='deriveNet'));
 const configured=interpretSales(data,'v',{deriveNet:true});
 const result=analyzeDashboardData(projectSalesData(data,configured.projection),'v',configured.confirmation);
 assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,280);
 assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.status,'READY');
 assert.equal(data.rows[0]['Gross Sales'],120);
});
test('invoice and transaction identities retain their meaning rather than becoming orders',async()=>{
 for(const [field,grain] of [['Invoice ID','INVOICE'],['Transaction ID','TRANSACTION']] as const){
  const data=await prepare([{[field]:'0001',Sales:40,Currency:'USD'},{[field]:'0002',Sales:60,Currency:'USD'}]);
  const interpreted=interpretSales(data,'v',{recordedNet:true});assert.equal(interpreted.grain,grain);
  const result=analyzeDashboardData(projectSalesData(data,interpreted.projection),'v',interpreted.confirmation);
  assert.equal(result.quality.status,'PASS');assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,100);assert.equal(result.outcomes.find(m=>m.key==='ORDERS')?.status,'NEEDS_CONFIRMATION');
 }
});
test('additional custom measures require explicit aggregation, honor filters, and block incomplete inputs',async()=>{
 const {calculateSalesCustomMeasures,salesCustomQueryData}=await import('../src/engines/sales/custom-measures');
 const data=await prepare([{Region:'East',Hours:2},{Region:'West',Hours:8},{Region:'East',Hours:4}]);
 const measures=[{id:'hours',name:'Hours per record',field:'Hours',aggregation:'AVERAGE' as const,format:'NUMBER' as const}];
 assert.equal(calculateSalesCustomMeasures(data,measures)[0].value,14/3);
 const selected=salesCustomQueryData(data,{filters:[{type:'CATEGORY',field:'Region',value:'East'}],compare:false},null);
 assert.equal(calculateSalesCustomMeasures(selected,measures)[0].value,3);
 assert.equal(calculateSalesCustomMeasures({...data,rows:[]},measures)[0].status,'UNAVAILABLE');
 assert.equal(calculateSalesCustomMeasures({...data,rows:[{Hours:null}]},measures)[0].status,'UNAVAILABLE');
 assert.equal(calculateSalesCustomMeasures(data,[{...measures[0],format:'CURRENCY'}])[0].status,'UNAVAILABLE');
});
test('common unambiguous calendar conventions preserve the source day',async()=>{
 for(const value of ['2026/10/29','29.10.2026','29 Oct 2026','2026年10月29日']){
  const data=await prepare([{'Order ID':'a','Order Date':value,Sales:10,Currency:'USD'}]);
  const interpreted=interpretSales(data,'v',{recordedNet:true});
  assert.equal(projectSalesData(data,interpreted.projection).rows[0]['Order Date'],'2026-10-29',value);
  assert.equal(interpreted.confirmation.metricRules.timezone,'UTC',value);
 }
});
test('copying a Sales dashboard never resolves to the original upload destination',async()=>{
 const {salesUploadDestination}=await import('../src/engines/sales/upload-intent');
 assert.equal(salesUploadDestination({pending:'',retry:'',dataset:'original',view:''}),'');
 assert.equal(salesUploadDestination({pending:'',retry:'',dataset:'original',view:'view'}),'original');
 assert.equal(salesUploadDestination({pending:'registered',retry:'',dataset:'original',view:''}),'registered');
});
test('blocked result actions follow their own dependencies',async()=>{
 const {salesAvailability}=await import('../src/engines/sales/availability');
 const data=await prepare([{'Order ID':'a',Sales:10,Quantity:1,Currency:'USD'}]);const interpreted=interpretSales(data,'v');
 const result=analyzeDashboardData(projectSalesData(data,interpreted.projection),'v',interpreted.confirmation);
 assert.equal(salesAvailability(result.outcomes.find(m=>m.key==='REVENUE')!,interpreted.confirmation,interpreted.questions,interpreted.fields).action,'ANSWER_QUESTIONS');
 assert.equal(salesAvailability(result.outcomes.find(m=>m.key==='PROFIT')!,interpreted.confirmation,interpreted.questions,interpreted.fields).action,'CORRECT_FIELDS');
});

test('ambiguous optional numeric columns cannot suppress independent revenue',async()=>{
 const data=await prepare([{'Order ID':'a',Sales:10,Hours:'1,234',Currency:'USD'},{'Order ID':'b',Sales:20,Hours:'2,345',Currency:'USD'}]);
 const answers={recordedNet:true,customMeasures:[{id:'hours',name:'Hours',field:'Hours',aggregation:'SUM' as const,format:'NUMBER' as const}]};
 const interpreted=interpretSales(data,'v',answers);assert.ok(interpreted.questions.some(q=>q.key==='numberFormat'));
 const projected=projectSalesData(data,interpreted.projection),result=analyzeDashboardData(projected,'v',interpreted.confirmation);assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,30);
 const selected=interpretSales(data,'v',{...answers,numberFormat:'COMMA'});const {calculateSalesCustomMeasures}=await import('../src/engines/sales/custom-measures');assert.ok(Math.abs(calculateSalesCustomMeasures(projectSalesData(data,selected.projection),answers.customMeasures)[0].value!-3.579)<1e-9);
});
test('custom measures are included in exports with spreadsheet-formula escaping',async()=>{
 const {exportDashboardMetricReport}=await import('../src/engines/reporting/metric-report');
 const data=await prepare([{'Order ID':'a',Sales:10,Currency:'USD'}]),interpreted=interpretSales(data,'v',{recordedNet:true});const analysis=analyzeDashboardData(projectSalesData(data,interpreted.projection),'v',interpreted.confirmation);
 const csv=exportDashboardMetricReport({analysis,widgets:[],analysisId:'a',versionId:'v',sourceChecksum:'checksum',customMeasures:[{id:'x',name:'=EXTERNAL()',field:'Sales',aggregation:'SUM',format:'NUMBER',value:10,status:'READY',reason:null,rows:1}]});
 assert.match(csv,/Additional Sales measure/);assert.match(csv,/'=EXTERNAL/);assert.match(csv,/SUM\(Sales\)/);
});

test('invoice items require a complete line identity and confirmed row amounts',async()=>{
 const data=await prepare([{'Invoice ID':'I1','Line ID':'1',Sales:10,Currency:'USD'},{'Invoice ID':'I1','Line ID':'2',Sales:20,Currency:'USD'}]);
 const interpreted=interpretSales(data,'v',{recordedNet:true,lineAmounts:true});assert.equal(interpreted.grain,'INVOICE_ITEM');
 const result=analyzeDashboardData(projectSalesData(data,interpreted.projection),'v',interpreted.confirmation);assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,30);
});
test('hierarchy edges are not invented between unrelated custom dimensions',async()=>{
 const {salesHierarchy}=await import('../src/engines/sales/hierarchy');
 const levels=salesHierarchy([{field:'Country',concept:'GEOGRAPHY',role:'DIMENSION'},{field:'City',concept:'GEOGRAPHY',role:'DIMENSION'},{field:'Market',concept:'GEOGRAPHY',role:'DIMENSION'},{field:'Category',concept:'CATEGORY',role:'DIMENSION'},{field:'Payment Method',concept:'CATEGORY',role:'DIMENSION'},{field:'Subcategory',concept:'SUBCATEGORY',role:'DIMENSION'}],[{Country:'US',City:'Boston',Market:'Retail',Category:'Furniture',Subcategory:'Chairs','Payment Method':'Card'},{Country:'US',City:'Chicago',Market:'Wholesale',Category:'Furniture',Subcategory:'Tables','Payment Method':'Cash'}]);
 assert.equal(levels.GEOGRAPHY[0].next,'City');assert.equal(levels.GEOGRAPHY.find(l=>l.field==='City')?.next,undefined);assert.equal(levels.CATEGORY.find(l=>l.field==='Category')?.next,'Subcategory');assert.equal(levels.CATEGORY.find(l=>l.field==='Payment Method')?.next,undefined);
});
test('Sales planning and cohort choices reach the governed calculation rules',async()=>{
 const data=await prepare([{'Order ID':'a','Customer ID':'1','Order Date':'2024-01-01',Sales:10,Currency:'USD'}]);
 const interpreted=interpretSales(data,'v',{recordedNet:true,salesHistory:true,customerHistory:true,cohortMonth:'2024-01',planningStart:'2024-01-01',planningEnd:'2024-01-31',targetAmount:100,budgetAmount:80,sellingDays:22,planningConfirmed:true,topN:10});
 assert.equal(interpreted.confirmation.metricRules.salesCohortMonth,'2024-01');assert.equal(interpreted.confirmation.metricRules.salesTargetAmount,100);assert.equal(interpreted.confirmation.metricRules.salesTopN,10);
});

test('a unique invoice identity establishes invoice grain when one order has several invoices',async()=>{
 const data=await prepare([{'Order ID':'O1','Invoice ID':'I1',Sales:10,Currency:'USD'},{'Order ID':'O1','Invoice ID':'I2',Sales:20,Currency:'USD'}]);const interpreted=interpretSales(data,'v',{recordedNet:true});assert.equal(interpreted.grain,'INVOICE');const result=analyzeDashboardData(projectSalesData(data,interpreted.projection),'v',interpreted.confirmation);assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,30);assert.equal(result.outcomes.find(m=>m.key==='ORDERS')?.value,1);
});
