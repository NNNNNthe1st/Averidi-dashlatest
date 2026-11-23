import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareDashboardSynchronization} from "../src/features/datasets/synchronize";
import {DashboardIngestValidationError} from "../src/engines/ingestion/ingest";

test("complete snapshot updates delayed corrections without double counting",()=>{
 const previous=[{transaction:"A",day:"2026-01-02",revenue:100},{transaction:"B",day:"2026-01-04",revenue:90}];
 const snapshot=[{transaction:"A",day:"2026-01-02",revenue:110},{transaction:"C",day:"2025-12-31",revenue:30}];
 const result=prepareDashboardSynchronization(previous,snapshot,"transaction",{completeSnapshot:true});
 assert.deepEqual({added:result.added,updated:result.updated,removed:result.removed,unchanged:result.unchanged},{added:1,updated:1,removed:1,unchanged:0});
 assert.equal(result.prepared.rows.reduce((sum,row)=>sum+Number(row.revenue),0),140);
});
test("incomplete snapshot and repeated identities cannot be synchronized silently",()=>{
 assert.throws(()=>prepareDashboardSynchronization([{id:"A"}],[{id:"B"}],"id",{completeSnapshot:false}),DashboardIngestValidationError);
 assert.throws(()=>prepareDashboardSynchronization([{id:"A"}],[{id:"B"},{id:"B"}],"id",{completeSnapshot:true}),DashboardIngestValidationError);
});
