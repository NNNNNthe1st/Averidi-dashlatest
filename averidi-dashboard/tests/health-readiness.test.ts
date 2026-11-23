import {test} from "node:test";
import assert from "node:assert/strict";
import {checkDashboardReadiness} from "../src/server/health-readiness";

const base={DASHBOARD_RELEASE_MODE:"OFF",DASHBOARD_STORAGE_BACKEND:"local",DASHBOARD_STORAGE_ROOT:"./.local/dashboard-storage",DASHBOARD_WORKER_ENABLED:"false"};
test("readiness checks standalone dependencies without enabling customer release",async()=>{
 const result=await checkDashboardReadiness(base,{database:async()=>1,worker:async()=>{throw Error("disabled worker should not be queried");}});
 assert.equal(result.ready,true);
 assert.equal(result.releaseMode,"OFF");
 assert.deepEqual(result.checks,{database:true,storage:true,worker:true,billing:true});
});
test("database outage causes readiness failure without leaking credentials",async()=>{
 const result=await checkDashboardReadiness(base,{database:async()=>{throw Error("private connection string");},worker:async()=>1});
 assert.equal(result.ready,false);
 assert.equal(result.checks.database,false);
 assert.equal(JSON.stringify(result).includes("private connection string"),false);
});
test("active worker requires a recent independent heartbeat",async()=>{
 const result=await checkDashboardReadiness({...base,DASHBOARD_WORKER_ENABLED:"true"},{database:async()=>1,worker:async()=>0});
 assert.equal(result.ready,false);
 assert.equal(result.checks.worker,false);
});
test("invalid storage or release configuration fails closed",async()=>{
 for(const env of [{...base,DASHBOARD_STORAGE_ROOT:"/"},{...base,DASHBOARD_RELEASE_MODE:"OTHER"}]){
  const result=await checkDashboardReadiness(env,{database:async()=>1,worker:async()=>1});
  assert.equal(result.ready,false);
 }
});

test("billing configuration fails readiness when explicitly enabled without dedicated credentials",async()=>{
 const result=await checkDashboardReadiness({...base,DASHBOARD_BILLING_ENABLED:"true"},{database:async()=>1,worker:async()=>1});
 assert.equal(result.ready,false);assert.equal(result.checks.billing,false);
});
