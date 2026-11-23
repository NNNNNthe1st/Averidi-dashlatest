import {test} from "node:test";
import assert from "node:assert/strict";
import {subscriptionChangeSchema} from "../src/features/subscriptions/lifecycle";
test("lifecycle validates independently managed paid periods",()=>{
 const future=new Date(Date.now()+86400000).toISOString();
 assert.equal(subscriptionChangeSchema.safeParse({planCode:"DASHBOARD_PRO",status:"ACTIVE",currentPeriodEnd:future}).success,true);
 assert.equal(subscriptionChangeSchema.safeParse({planCode:"DASHBOARD_PRO",status:"ACTIVE",currentPeriodEnd:null}).success,false);
 assert.equal(subscriptionChangeSchema.safeParse({planCode:"ANALYST/SHARED",status:"ACTIVE",currentPeriodEnd:future}).success,false);
 assert.equal(subscriptionChangeSchema.safeParse({planCode:"DASHBOARD_PRO",status:"ACTIVE",currentPeriodEnd:new Date(0).toISOString()}).success,false);
 assert.equal(subscriptionChangeSchema.safeParse({planCode:"DASHBOARD_PRO",status:"CANCELED",currentPeriodEnd:null}).success,true);
});
