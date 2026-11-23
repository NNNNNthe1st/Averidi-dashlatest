import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluateDashboardSubscription,evaluateDashboardTrial} from "../src/features/subscriptions/entitlements";
const now=new Date("2026-10-22T00:00:00Z");
test("subscription denies by default, for expiry and inactive state",()=>{
 assert.equal(evaluateDashboardSubscription(null,now).active,false);
 assert.equal(evaluateDashboardSubscription({status:"INACTIVE",planCode:"PAID",currentPeriodEnd:new Date("2026-11-01")},now).active,false);
 assert.equal(evaluateDashboardSubscription({status:"ACTIVE",planCode:"PAID",currentPeriodEnd:now},now).active,false);
 assert.equal(evaluateDashboardSubscription({status:"ACTIVE",planCode:"PAID",currentPeriodEnd:new Date("2026-11-01")},now).active,true);
});

test("trial begins at account creation and ends after one calendar month",()=>{
 const start=new Date("2026-10-27T08:15:00Z");
 assert.equal(evaluateDashboardTrial(start,start).active,true);
 assert.equal(evaluateDashboardTrial(start,new Date("2026-11-27T08:14:59Z")).active,true);
 assert.equal(evaluateDashboardTrial(start,new Date("2026-11-27T08:15:00Z")).active,false);
 assert.equal(evaluateDashboardTrial(start,new Date("2026-10-26T00:00:00Z")).active,false);
});
test("trial clamps month-end dates",()=>{
 assert.equal(evaluateDashboardTrial(new Date("2027-01-31T12:00:00Z")).expiresAt,"2027-02-28T12:00:00.000Z");
 assert.equal(evaluateDashboardTrial(new Date("2028-01-31T12:00:00Z")).expiresAt,"2028-02-29T12:00:00.000Z");
});

test("trial status is deterministic for every member of the same workspace",()=>{
 const storedWorkspaceStart=new Date("2026-10-27T12:00:00Z");
 const guestJoined=new Date("2026-11-20T12:00:00Z");
 assert.equal(evaluateDashboardTrial(storedWorkspaceStart,guestJoined).expiresAt,"2026-11-27T12:00:00.000Z");
 assert.equal(evaluateDashboardTrial(storedWorkspaceStart,new Date("2026-11-28T12:00:00Z")).active,false);
});
