import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareDashboardAppend} from "../src/features/datasets/append";
import {DashboardIngestValidationError} from "../src/engines/ingestion/ingest";

test("append retains existing transactions and skips identical overlap",()=>{
 const prior=[{id:"A",amount:100,date:"2026-06-01"},{id:"B",amount:200,date:"2026-06-02"}];
 const incoming=[{id:"B",amount:200,date:"2026-06-02"},{id:"C",amount:300,date:"2026-05-30"}];
 const result=prepareDashboardAppend(prior,incoming,"id");
 assert.equal(result.prepared.rows.length,3);
 assert.equal(result.addedRows,1);
 assert.equal(result.duplicateRowsSkipped,1);
 assert.equal(result.overlapRows,1);
 assert.ok(result.prepared.rows.some(row=>row.id==="C"));
 assert.equal(result.prepared.rows.reduce((sum,row)=>sum+Number(row.amount),0),600);
});
test("changed overlapping transactions require explicit replacement or synchronization",()=>{
 assert.throws(()=>prepareDashboardAppend([{id:"A",amount:100}],[{id:"A",amount:250}],"id"),DashboardIngestValidationError);
});
test("ambiguous, missing or duplicate source identities fail closed",()=>{
 assert.throws(()=>prepareDashboardAppend([{id:"A",amount:100},{id:"A",amount:100}],[{id:"B",amount:200}],"id"),DashboardIngestValidationError);
 assert.throws(()=>prepareDashboardAppend([{id:"A"}],[{id:null}],"id"),DashboardIngestValidationError);
 assert.throws(()=>prepareDashboardAppend([{id:"A"}],[{id:"B"}],"missing"),DashboardIngestValidationError);
});
test("repeating the same append does not increase row count or revenue",()=>{
 const original=[{id:"A",amount:10}],newRows=[{id:"A",amount:10},{id:"B",amount:20}];
 const once=prepareDashboardAppend(original,newRows,"id");
 const twice=prepareDashboardAppend(once.prepared.rows,newRows,"id");
 assert.equal(once.prepared.rows.length,2);
 assert.equal(twice.prepared.rows.length,2);
 assert.equal(twice.addedRows,0);
 assert.equal(twice.duplicateRowsSkipped,2);
});
