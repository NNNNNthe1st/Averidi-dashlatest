import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NextRequest} from 'next/server';
import {buildSampleDashboard,DEMO_ROWS,DEMO_CSV} from '../src/features/demo/sample';
import {definitionSchema} from '../src/features/views/validation';
import {proxy} from '../src/proxy';
test('fictional demo uses governed engines for deterministic exact filters, ratios and calendar comparison',()=>{
 const full=buildSampleDashboard(),metric=(key:string)=>full.data.analysis.outcomes.find(m=>m.key===key)!;assert.equal(metric('REVENUE').value,900);assert.equal(metric('PROFIT').value,540);assert.equal(metric('GROSS_MARGIN').value,.6);assert.equal(metric('ORDERS').value,4);assert.equal(full.data.analysis.quality.status,'PASS');assert.equal(full.data.analysis.quality.selectedRows,4);assert.equal(full.data.analysis.comparison?.REVENUE.previous,700);assert.equal(full.data.analysis.comparison?.REVENUE.absolute,200);assert.equal(full.data.analysis.comparisonPeriods?.previous.start,'2026-01-01');assert.ok(definitionSchema.safeParse(full.definition).success);assert.deepEqual(full,buildSampleDashboard());
 const web=buildSampleDashboard({channel:'Web',period:'FEB'});assert.equal(web.data.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,400);assert.equal(web.data.analysis.outcomes.find(m=>m.key==='AVERAGE_ORDER_VALUE')?.value,200);assert.equal(web.data.analysis.comparison?.REVENUE.previous,300);assert.equal(web.data.analysis.quality.selectedRows,2);assert.deepEqual(web.data.widgets.find(w=>w.id==='demo-revenue-channel')!.series.map(p=>[p.label,p.value]),[['Web',400]]);
 const jan=buildSampleDashboard({period:'JAN'});assert.equal(jan.data.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,700);assert.equal(jan.data.analysis.comparison,null);
});
test('demo accepts only fixed fictional selections and its downloadable CSV exactly matches immutable examples',async()=>{
 for(const input of [{workspaceId:'foreign'},{datasetId:'customer'},{channel:'secret'},{channel:['Web','Shop']},{period:'2026-03'},{filters:[]}])assert.throws(()=>buildSampleDashboard(input));
 assert.equal(DEMO_ROWS.length,8);assert.ok(Object.isFrozen(DEMO_ROWS)&&DEMO_ROWS.every(Object.isFrozen));assert.equal(await readFile('public/demo-orders.csv','utf8'),DEMO_CSV);assert.ok(DEMO_ROWS.every(row=>row.order_id.startsWith('DEMO-')&&row.customer_id.startsWith('DEMO-')));
});
test('public fictional demo passes release gating while protected customer routes remain closed',async()=>{
 const old=process.env.DASHBOARD_RELEASE_MODE;process.env.DASHBOARD_RELEASE_MODE='OFF';try{
  for(const method of ['GET','HEAD'])assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/demo',{method}))).headers.get('x-middleware-next'),'1');
  assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/workspaces'))).status,503);
  assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/api/workspaces'))).status,503);
 }finally{if(old===undefined)delete process.env.DASHBOARD_RELEASE_MODE;else process.env.DASHBOARD_RELEASE_MODE=old;}
});
