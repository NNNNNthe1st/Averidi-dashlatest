import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {interpretSales,projectSalesData} from '../src/engines/sales/interpret';
import {analyzeDashboardData} from '../src/engines/analysis/pipeline';
import {calculateSalesCustomMeasures} from '../src/engines/sales/custom-measures';
import {salesHierarchy} from '../src/engines/sales/hierarchy';
import {salesAvailability,salesRecoveryTarget} from '../src/engines/sales/availability';
import {salesCalendar} from '../src/engines/sales/source-values';
const prepare=(rows:unknown[])=>prepareDashboardFile({bytes:Buffer.from(JSON.stringify(rows)),fileName:'business.json'});
test('record count includes blanks and returns zero for an empty filtered population',()=>{
 const measure={id:'records',name:'Records',field:'Notes',aggregation:'COUNT' as const,format:'NUMBER' as const};
 assert.equal(calculateSalesCustomMeasures({columns:[{name:'Notes',dataType:'TEXT'}],rows:[{Notes:null},{Notes:'present'}]},[measure])[0].value,2);
 assert.equal(calculateSalesCustomMeasures({columns:[{name:'Notes',dataType:'TEXT'}],rows:[]},[measure])[0].value,0);
});
test('same-level locations and inconsistent relationships never become drill edges',()=>{
 const dims=['Country','State','Province','City'].map(field=>({field,concept:'GEOGRAPHY',role:'DIMENSION'}));
 const rows=[{Country:'US',State:'A',Province:'P',City:'Same'},{Country:'US',State:'B',Province:'Q',City:'Same'}];
 const h=salesHierarchy(dims,rows);
 assert.equal(h.GEOGRAPHY.find(d=>d.field==='State')?.next,undefined);
 assert.equal(h.GEOGRAPHY.find(d=>d.field==='Province')?.next,undefined);
 assert.equal(h.GEOGRAPHY.find(d=>d.field==='Country')?.next,undefined,'two possible equivalent child levels are ambiguous');
 assert.ok(salesHierarchy(dims).GEOGRAPHY.every(d=>!d.next),'no rows means no validated relationships');
});
test('validated parent/child relationships support geography and category drilling',()=>{
 const dims=[{field:'Country',concept:'GEOGRAPHY',role:'DIMENSION'},{field:'State',concept:'GEOGRAPHY',role:'DIMENSION'},{field:'City',concept:'GEOGRAPHY',role:'DIMENSION'},{field:'Category',concept:'CATEGORY',role:'DIMENSION'},{field:'Subcategory',concept:'SUBCATEGORY',role:'DIMENSION'}];
 const h=salesHierarchy(dims,[{Country:'US',State:'NY',City:'New York',Category:'Furniture',Subcategory:'Desks'},{Country:'US',State:'MA',City:'Boston',Category:'Furniture',Subcategory:'Chairs'}]);
 assert.equal(h.GEOGRAPHY[0].next,'State');assert.equal(h.GEOGRAPHY[1].next,'City');assert.equal(h.CATEGORY[0].next,'Subcategory');
});
test('explicit mixed detail and total records require a population decision and retain the original file',async()=>{
 const data=await prepare([{'Record Type':'Detail','Order ID':'1',Sales:100,Currency:'USD'},{'Record Type':'Detail','Order ID':'2',Sales:200,Currency:'USD'},{'Record Type':'Grand total','Order ID':'Total',Sales:300,Currency:'USD'}]);
 const original=JSON.stringify(data);const pending=interpretSales(data,'v',{recordedNet:true});assert.ok(pending.questions.some(q=>q.key==='excludeSummaryRows'));
 const blocked=analyzeDashboardData(projectSalesData(data,pending.projection),'v',pending.confirmation);assert.notEqual(blocked.outcomes.find(m=>m.key==='REVENUE')?.status,'READY');
 const confirmed=interpretSales(data,'v',{recordedNet:true,excludeSummaryRows:true}),projected=projectSalesData(data,confirmed.projection),result=analyzeDashboardData(projected,'v',confirmed.confirmation);
 assert.equal(result.outcomes.find(m=>m.key==='REVENUE')?.value,300);assert.equal(result.outcomes.find(m=>m.key==='ORDERS')?.value,2);assert.equal(projected.rows.length,2);assert.equal(JSON.stringify(data),original);
});
test('industry wording composes with identifiers, names, dates and numeric fields',async()=>{
 for(const [order,customer,product,revenue] of [['Booking Reference','Guest Identifier','Room Code','Net Receipts USD'],['Job Number','Client Code','Service Code','Fees Earned'],['Reservation Number','Member ID','Package Code','Amount Collected'],['Ticket ID','Buyer Reference','Item Code','Billed Amount']]){
  const data=await prepare([{[order]:'0001',[customer]:'0009',[product]:'P1',[revenue]:100,Currency:'USD'}]);const i=interpretSales(data,'v',{recordedNet:true});
  assert.equal(i.fields.find(f=>f.name===order)?.role,'ORDER',order);assert.equal(i.fields.find(f=>f.name===customer)?.role,'CUSTOMER',customer);assert.equal(i.fields.find(f=>f.name===product)?.role,'PRODUCT',product);
  assert.equal(analyzeDashboardData(projectSalesData(data,i.projection),'v',i.confirmation).outcomes.find(m=>m.key==='REVENUE')?.value,100,revenue);
 }
});
test('unfamiliar fields remain usable without guessing that an arbitrary number is revenue',async()=>{
 const data=await prepare([{BookingID:'0001','Special business label':42}]);const i=interpretSales(data,'v');assert.equal(i.fields.find(f=>f.name==='Special business label')?.role,'CUSTOM');
 assert.equal(calculateSalesCustomMeasures(data,[{id:'custom',name:'Business total',field:'Special business label',aggregation:'SUM',format:'NUMBER'}])[0].value,42);
});
test('international named months and localized digits are validated on a Gregorian calendar',()=>{
 for(const [text,locale] of [['29 octobre 2026','fr-FR'],['29. Oktober 2026','de-DE'],['29 octubre 2026','es-ES'],['29 ottobre 2026','it-IT'],['29 de octubre de 2026','es-ES'],['29 октября 2026','ru-RU'],['٢٩ أكتوبر ٢٠٢٦','ar-EG']])assert.equal(salesCalendar(text,'DAY_FIRST',locale),'2026-10-29',text);
 assert.equal(salesCalendar('31 février 2026','DAY_FIRST','fr-FR'),null);
});
test('source date locale can be corrected without changing shared ingestion',async()=>{
 const data=await prepare([{'Order ID':'1','Order Date':'29 octobre 2026',Sales:100,Currency:'EUR'}]);const i=interpretSales(data,'v',{recordedNet:true,dateLocale:'fr-FR'});
 assert.equal(projectSalesData(data,i.projection).rows[0]['Order Date'],'2026-10-29');assert.ok(i.confirmation.confirmedMappings.some(m=>m.canonicalConcept==='TIME'));
});
test('availability classification uses field evidence and not engine explanation wording',async()=>{
 const data=await prepare([{'Order ID':'1',Sales:100,Revenue:120,Currency:'USD'}]);const i=interpretSales(data,'v'),a=analyzeDashboardData(projectSalesData(data,i.projection),'v',i.confirmation),m=a.outcomes.find(m=>m.key==='REVENUE')!;
 assert.equal(salesAvailability({...m,reason:'Text changed completely'},i.confirmation,i.questions,i.fields).kind,'AMBIGUOUS_FIELD');
 const missing={...i.confirmation,confirmedMappings:i.confirmation.confirmedMappings.filter(m=>m.canonicalConcept!=='REVENUE')};assert.equal(salesAvailability(m,missing,[],[]).kind,'MISSING_FIELD');
 assert.equal(salesAvailability(m,i.confirmation,[],[],{quality:'FAIL'}).action,'CHECK_SOURCE');assert.equal(salesAvailability({...m,lineage:{...m.lineage,rowCount:0}},i.confirmation,[],[],{query:{filters:[{type:'CATEGORY',field:'Region',value:'none'}],compare:false}}).action,'CHANGE_FILTERS');
 assert.equal(salesRecoveryTarget.CHECK_SOURCE,'sales-source-checks');assert.equal(salesRecoveryTarget.CHANGE_FILTERS,'sales-filters');
});

test('complete sales sources enable history, forecasts, cohort, planning and comparison families through interpretation',async()=>{
 const {completeSalesRows,completeSalesAnswers}=await import('./fixtures/sales-completion-data');const data=await prepare(completeSalesRows),i=interpretSales(data,'v',completeSalesAnswers,{timezone:'UTC'}),projected=projectSalesData(data,i.projection);
 const query={filters:[{type:'DATE_RANGE' as const,field:'Order Date',value:'2026-02-01',end:'2026-02-28'}],compare:true};const a=analyzeDashboardData(projected,'v',i.confirmation,query);
 const keys=['REVENUE','COST','PROFIT','ORDERS','CUSTOMERS','UNITS','SALES_FORECAST_MAE','SALES_FORECAST_RMSE','SALES_FORECAST_WAPE','SALES_FORECAST_GROWTH','SALES_COHORT_REVENUE_PER_ACTIVE_CUSTOMER','SALES_PRICE_EFFECT','SALES_VOLUME_EFFECT','SALES_PRODUCT_MIX_EFFECT','SALES_VOLATILITY','SALES_TARGET_ATTAINMENT','SALES_BUDGET_VARIANCE','SALES_PER_SELLING_DAY','SALES_DISCOUNT_RATE','SALES_REFUND_RATE','SALES_RETURN_RATE','SALES_MTD','SALES_QTD','SALES_YTD','SALES_CUMULATIVE','SALES_TOP_N_CONCENTRATION'];
 for(const key of keys){const metric=a.outcomes.find(m=>m.key===key)!;assert.equal(metric?.status,'READY',key+': '+metric?.reason);}
 const expected=completeSalesRows.filter(r=>r['Order Date']>='2026-02-01').reduce((s,r)=>s+r.Revenue,0);assert.equal(a.outcomes.find(m=>m.key==='REVENUE')?.value,expected);assert.equal(a.outcomes.find(m=>m.key==='ORDERS')?.value,28);assert.equal(a.outcomes.find(m=>m.key==='SALES_FORECAST_MAE')?.value,0);
 const segment=analyzeDashboardData(projected,'v',i.confirmation,{...query,filters:[...query.filters,{type:'CATEGORY',field:'Category',value:'Furniture'}]});for(const key of ['SALES_GROWTH_CONTRIBUTION','SALES_CONTRIBUTION_SHARE','SALES_REVENUE_RANK'])assert.equal(segment.outcomes.find(m=>m.key===key)?.status,'READY',key);
});
test('opportunity fields support conversion, win rate, pipeline, cycle time and representative metrics',async()=>{
 const {opportunityRows,opportunityAnswers}=await import('./fixtures/sales-completion-data');const data=await prepare(opportunityRows),i=interpretSales(data,'v',opportunityAnswers),a=analyzeDashboardData(projectSalesData(data,i.projection),'v',i.confirmation,{filters:[{type:'DATE_RANGE',field:'Snapshot Date',value:'2026-01-01',end:'2026-01-31'}],compare:false});
 for(const [key,value] of [['SALES_CONVERSION_RATE',1/3],['SALES_WIN_RATE',.5],['SALES_PIPELINE_COVERAGE',.5],['SALES_AVG_CYCLE_DAYS',8],['SALES_PER_REPRESENTATIVE',50]] as const){const m=a.outcomes.find(m=>m.key===key);assert.equal(m?.status,'READY',key+': '+m?.reason);assert.equal(m?.value,value,key);}
});

test('saved business answers remain editable, including No, without duplicate question controls',async()=>{
 const {savedSalesQuestions}=await import('../src/engines/sales/questions');const saved=savedSalesQuestions({recordedNet:false,costIsProductCost:true,salesHistory:false,forecastDays:7},[{key:'forecastDays'}]);assert.ok(saved.some(q=>q.key==='recordedNet'));assert.ok(saved.some(q=>q.key==='salesHistory'));assert.ok(!saved.some(q=>q.key==='forecastDays'));
 const data=await prepare([{'Order ID':'1',Revenue:100,Cost:30,Currency:'USD'}]),i=interpretSales(data,'v',{recordedNet:false,costIsProductCost:true}),a=analyzeDashboardData(projectSalesData(data,i.projection),'v',i.confirmation);assert.equal(salesAvailability(a.outcomes.find(m=>m.key==='REVENUE')!,i.confirmation,i.questions,i.fields,{answers:{recordedNet:false}}).action,'REVIEW_ANSWERS');assert.equal(salesRecoveryTarget.REVIEW_ANSWERS,'sales-saved-answers');
});
