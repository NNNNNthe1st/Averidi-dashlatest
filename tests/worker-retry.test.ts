import {test} from "node:test";
import assert from "node:assert/strict";
import {retryDelay} from "../src/worker/job-claim";
test("worker retries use bounded exponential backoff",()=>{
 assert.equal(retryDelay(1),30000);
 assert.equal(retryDelay(2),60000);
 assert.equal(retryDelay(3),120000);
 assert.equal(retryDelay(50),3600000);
});
