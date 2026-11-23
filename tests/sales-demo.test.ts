import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSalesDemo} from '../src/features/demo/sales';
import {POST} from '../src/app/api/demo/sales/route';
test('public sample uses production Sales calculations and recomputes selected segments',()=>{
 const all=buildSalesDemo(),segment=buildSalesDemo({filters:[{type:'CATEGORY',field:'Segment',value:'Corporate'}]});
 const revenue=(v:typeof all)=>v.analysis.outcomes.find(m=>m.key==='REVENUE')!;
 // Each product has 24 sales; alternating quantities average 2 or 3.
 assert.equal(revenue(all).status,'READY');assert.equal(revenue(all).value,24*(120*2+80*3+200*2+60*3+40*2+150*3));assert.equal(revenue(segment).value,24*(80*3+40*2));assert.equal(all.analysis.outcomes.find(m=>m.key==='ORDERS')?.value,144);
 assert.ok(all.analysis.dimensions.some(d=>d.field==='Order Date'&&d.role==='DATE'));
});
test('sample endpoint rejects tenant/source injection, invalid query and oversized input',async()=>{
 for(const input of [{workspaceId:'other-customer'}, {filters:[{type:'SQL',field:'Sales',value:'all'}]}, {filters:[],compare:false,source:'private'}])assert.equal((await POST(new Request('https://sample.test/api/demo/sales',{method:'POST',body:JSON.stringify(input)}))).status,400);
 assert.equal((await POST(new Request('https://sample.test/api/demo/sales',{method:'POST',body:' '.repeat(12001)}))).status,413);
 const good=await POST(new Request('https://sample.test/api/demo/sales',{method:'POST',body:'{}'}));assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');
});
