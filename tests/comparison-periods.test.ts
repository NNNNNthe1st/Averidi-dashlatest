import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {resolveComparisonPeriods} from '../src/engines/metrics/comparison-periods';
import {analyzeDashboardData,analysisQuerySchema,analysisConfirmationSchema,retainedTextFields} from '../src/engines/analysis/pipeline';
import {prepareDashboardFile} from '../src/engines/ingestion/ingest';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {saveFilterPreset,listFilterPresets,readDrilldownRecords} from '../src/features/views/exploration';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {exportDashboardMetricReport} from '../src/engines/reporting/metric-report';
import {saveReportDefinition} from '../src/features/reports/definitions';
import {readDashboardObject} from '../src/server/storage';
after(()=>db.$disconnect());
test('calendar comparisons preserve actual month ends, leap years, custom ranges and supported date boundaries',()=>{
 assert.deepEqual(resolveComparisonPeriods('2024-03-01','2024-03-31',{mode:'PREVIOUS_MONTH'}).previous,{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(resolveComparisonPeriods('2025-03-01','2025-03-31',{mode:'PREVIOUS_MONTH'}).previous,{start:'2025-02-01',end:'2025-02-28'});
 assert.deepEqual(resolveComparisonPeriods('2026-01-15','2026-01-20',{mode:'PREVIOUS_MONTH'}).previous,{start:'2025-12-15',end:'2025-12-20'});
 assert.deepEqual(resolveComparisonPeriods('2024-02-29','2024-02-29',{mode:'PREVIOUS_YEAR'}).previous,{start:'2023-02-28',end:'2023-02-28'});
 assert.deepEqual(resolveComparisonPeriods('2024-01-01','2024-12-31',{mode:'PREVIOUS_YEAR'}).previous,{start:'2023-01-01',end:'2023-12-31'});
 const custom=resolveComparisonPeriods('2026-01-01','2026-01-10',{mode:'CUSTOM',start:'2025-06-01',end:'2025-06-05'});assert.equal(custom.currentDays,10);assert.equal(custom.previousDays,5);assert.equal(custom.partial,false);
 for(const values of [['2026-02-30','2026-03-01'],['2026-02-02','2026-02-01'],['0000-01-01','0000-01-02']])assert.throws(()=>resolveComparisonPeriods(values[0],values[1]));
 assert.throws(()=>resolveComparisonPeriods('0001-01-01','0001-01-31',{mode:'PREVIOUS_MONTH'}),/INVALID_COMPARISON_PERIOD/);
});
test('partial observed periods align elapsed days without inferring completeness or silently dropping current data',()=>{
 const r=resolveComparisonPeriods('2026-03-01','2026-03-31',{mode:'PREVIOUS_MONTH',through:'2026-03-10'});
 assert.deepEqual(r.current,{start:'2026-03-01',end:'2026-03-10'});assert.deepEqual(r.previous,{start:'2026-02-01',end:'2026-02-10'});assert.equal(r.currentDays,r.previousDays);assert.equal(r.partial,true);
 assert.throws(()=>resolveComparisonPeriods('2026-03-01','2026-03-31',{mode:'PREVIOUS_MONTH',through:'2026-03-30'}),/COMPARISON_PERIOD_TOO_SHORT/);
 for(const through of ['2026-02-28','2026-04-01'])assert.throws(()=>resolveComparisonPeriods('2026-03-01','2026-03-31',{mode:'PREVIOUS_MONTH',through}));
 const custom=resolveComparisonPeriods('2026-01-01','2026-01-31',{mode:'CUSTOM',start:'2026-01-01',end:'2026-01-31',through:'2026-01-02'});assert.equal(custom.overlap,true);assert.equal(custom.previousDays,2);
 assert.equal(analysisQuerySchema.safeParse({compare:false,comparison:{mode:'PREVIOUS_MONTH'}}).success,false);
 assert.equal(analysisQuerySchema.safeParse({compare:true,comparison:{mode:'CUSTOM',start:'2026-02-30',end:'2026-03-01'}}).success,false);
});
test('governed comparison calculations preserve category filters, business timezone, missing prior data and zero-denominator handling',async()=>{
 const confirmation=analysisConfirmationSchema.parse({confirmedMappings:[{sourceField:'id',canonicalConcept:'ORDER'},{sourceField:'amount',canonicalConcept:'REVENUE'},{sourceField:'day',canonicalConcept:'TIME'},{sourceField:'channel',canonicalConcept:'CHANNEL'}],metricRules:{versionId:'v',grain:'ORDER',currency:'USD',currencyMode:'SINGLE',revenueBasis:'NET',costBasis:'COGS',refundsIncluded:true,discountsIncluded:true,taxIncluded:false,shippingIncluded:false,cancellationTreatment:'ALREADY_EXCLUDED',returnTreatment:'ALREADY_NETTED',timezone:'America/New_York'}});
 const prepared=await prepareDashboardFile({fileName:'comparison.csv',bytes:Buffer.from('id,amount,day,channel\n1,10,2026-02-01T12:00:00Z,Web\n2,20,2026-02-02T12:00:00Z,Web\n3,999,2026-02-02T12:00:00Z,Shop\n4,100,2026-03-01T12:00:00Z,Web\n5,200,2026-03-02T12:00:00Z,Web\n6,999,2026-03-03T12:00:00Z,Web\n7,0,2025-03-01T12:00:00Z,Web\n'),preserveTextFields:retainedTextFields(confirmation)});
 const query=analysisQuerySchema.parse({filters:[{type:'DATE_RANGE',field:'day',value:'2026-03-01',end:'2026-03-31'},{type:'CATEGORY',field:'channel',value:'Web'}],compare:true,comparison:{mode:'PREVIOUS_MONTH',through:'2026-03-02'}});
 const r=analyzeDashboardData(prepared,'v',confirmation,query);assert.deepEqual(r.comparison?.REVENUE,{current:300,previous:30,absolute:270,percentage:9});assert.equal(r.quality.selectedRows,2);assert.equal(r.outcomes.find(m=>m.key==='REVENUE')?.lineage.filters?.[0].end,'2026-03-02');
 const zero=analyzeDashboardData(prepared,'v',confirmation,{...query,comparison:{mode:'PREVIOUS_YEAR',through:'2026-03-01'}});assert.equal(zero.comparison?.REVENUE.previous,0);assert.equal(zero.comparison?.REVENUE.percentage,null);
 const absent=analyzeDashboardData(prepared,'v',confirmation,{...query,comparison:{mode:'CUSTOM',start:'2022-01-01',end:'2022-01-31'}});assert.equal(absent.comparison?.REVENUE.previous,null);
 const timestamp=await prepareDashboardFile({fileName:'timezone.csv',bytes:Buffer.from('id,amount,day,channel\na,40,2026-03-01T02:00:00Z,Web\nb,60,2026-03-01T06:00:00Z,Web\n'),preserveTextFields:retainedTextFields(confirmation)});
 const zoned=analyzeDashboardData(timestamp,'v',confirmation,analysisQuerySchema.parse({filters:[{type:'DATE_RANGE',field:'day',value:'2026-03-01',end:'2026-03-01'}],compare:true}));assert.equal(zoned.comparison?.REVENUE.current,60);assert.equal(zoned.comparison?.REVENUE.previous,40);
});
test('comparison presets, source records, exports, worker reports and freshness use the same authorized observed period',async()=>{
 const f=await governedWorkspace();try{
  const query=analysisQuerySchema.parse({filters:[{type:'DATE_RANGE',field:'day',value:'2026-01-01',end:'2026-01-02'}],compare:true,comparison:{mode:'CUSTOM',start:'2026-01-01',end:'2026-01-02',through:'2026-01-01'}});
  await saveFilterPreset(f.actor,f.workspace.id,f.viewId,{name:'Partial custom period',query});const presets=await listFilterPresets(f.actor,f.workspace.id,f.viewId);assert.deepEqual(presets[0].filters,query);
  // This shared fixture uses UTC-midnight timestamps; New York Jan 1 contains record 002.
  const records=await readDrilldownRecords(f.reader,f.workspace.id,f.viewId,{query});assert.equal(records.total,1);assert.equal(records.rows[0].id,'002');
  const data=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,query);assert.equal(data.analysis.comparison?.REVENUE.current,200);assert.equal(data.analysis.comparison?.REVENUE.previous,200);assert.ok(data.widgets[0].outcome.lineage.refreshedAt);assert.ok(data.widgets[0].outcome.lineage.calculatedAt);
  assert.equal(data.widgets[0].outcome.lineage.refreshedAt,(await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}})).profiledAt?.toISOString());
  const csv=exportDashboardMetricReport(data);assert.match(csv,/CUSTOM/);assert.match(csv,/Source processed at/);assert.match(csv,/2026-01-01/);
  await assert.rejects(readWorkspaceDashboardData(f.actor,f.foreign.id,f.viewId,query),/NOT_FOUND/);
  const report=await saveReportDefinition(f.actor,f.workspace.id,{name:'Compared report',viewId:f.viewId,definition:{query}});
  const generated=await f.run('REPORT_GENERATE',{reportId:report.id});const artifact=await db.dashboardReportExport.findUniqueOrThrow({where:{id:generated.exportId}});const bytes=await readDashboardObject(artifact.storageKey!);assert.match(bytes.toString(),/CUSTOM/);assert.match(bytes.toString(),/Partial period aligned/);
 }finally{await f.cleanup();}
});
