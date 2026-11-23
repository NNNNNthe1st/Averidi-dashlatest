import {test,after} from 'node:test';
import {dashboardDb as rateLimitDb} from '../src/server/db';
after(()=>rateLimitDb.$disconnect());
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {billingConfig,planSchema} from '../src/features/billing/contracts';
import {verifyStripeEvent,stripeTransport} from '../src/features/billing/stripe';
import {evaluateDashboardSubscription} from '../src/features/subscriptions/entitlements';
import {proxy} from '../src/proxy';
import {NextRequest} from 'next/server';
const secret='whsec_fixtureSecretForBillingOnly123',now=Date.now(),stamp=Math.floor(now/1000);
const raw=Buffer.from(JSON.stringify({id:'evt_fixture',object:'event',type:'customer.subscription.updated',livemode:false,data:{object:{id:'sub_fixture'}}}));
function signature(t=stamp,b=raw){return `t=${t},v1=${createHmac('sha256',secret).update(t+'.').update(b).digest('hex')}`;}
test('billing verifies raw bytes, rotating signatures and both sides of timestamp tolerance',()=>{
 assert.equal(verifyStripeEvent(raw,signature(),secret,now).id,'evt_fixture');
 assert.equal(verifyStripeEvent(raw,signature()+',v1='+'0'.repeat(64),secret,now).id,'evt_fixture');
 for(const header of [signature(stamp-301),signature(stamp+301),signature()+`,t=${stamp}`,'t=abc,v1='+'0'.repeat(64),''])assert.throws(()=>verifyStripeEvent(raw,header,secret,now),/INVALID_BILLING_SIGNATURE/);
 assert.throws(()=>verifyStripeEvent(Buffer.concat([raw,Buffer.from(' ')]),signature(),secret,now),/INVALID_BILLING_SIGNATURE/);
 assert.throws(()=>verifyStripeEvent(Buffer.alloc(1024*1024+1),signature(),secret,now),/INVALID_BILLING_SIGNATURE/);
});
test('billing catalog requires complete immutable price semantics and explicit entitlement',()=>{
 const v={code:'DASHBOARD_TEST',name:'Fixture plan',active:false,entitlements:{dashboardAccess:true},externalPriceId:null,currency:null,amountMinor:null,billingInterval:null};
 assert.equal(planSchema.safeParse(v).success,true);
 assert.equal(planSchema.safeParse({...v,externalPriceId:'price_fixture'}).success,false);
 assert.equal(planSchema.safeParse({...v,entitlements:{dashboardAccess:true,unapproved:true}}).success,false);
 assert.equal(planSchema.safeParse({...v,externalPriceId:'price_fixture',currency:'JPY',amountMinor:2000,billingInterval:'year'}).success,true);
});
test('billing remains disabled by default and never accepts connector credentials',async()=>{
 const old=process.env.DASHBOARD_BILLING_ENABLED;delete process.env.DASHBOARD_BILLING_ENABLED;
 try{assert.throws(billingConfig,/BILLING_DISABLED/);await assert.rejects(stripeTransport('//evil.test'),/INVALID_BILLING_RESOURCE/);}finally{if(old===undefined)delete process.env.DASHBOARD_BILLING_ENABLED;else process.env.DASHBOARD_BILLING_ENABLED=old;}
});
test('entitlements immediately deny a suspended, retired or disabled catalog plan',()=>{
 const v={planCode:'TEST',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)};
 assert.equal(evaluateDashboardSubscription(v).active,true);
 assert.equal(evaluateDashboardSubscription({...v,accessSuspended:true}).active,false);
 assert.equal(evaluateDashboardSubscription({...v,billingPlan:{active:false,entitlements:{dashboardAccess:true}}}).active,false);
 assert.equal(evaluateDashboardSubscription({...v,billingPlan:{active:true,entitlements:{dashboardAccess:false}}}).active,false);
});
test('signed billing ingress remains reachable while customer release is OFF',async()=>{
 const previous=process.env.DASHBOARD_RELEASE_MODE;process.env.DASHBOARD_RELEASE_MODE='OFF';
 try{assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/api/billing/stripe/webhook',{method:'POST'}))).headers.get('x-middleware-next'),'1');assert.equal((await proxy(new NextRequest('https://dashboard.test/dashboard/app/api/workspaces'))).status,503);}finally{if(previous===undefined)delete process.env.DASHBOARD_RELEASE_MODE;else process.env.DASHBOARD_RELEASE_MODE=previous;}
});
