import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {startCustomerCheckout,refreshCustomerBilling,cancelCustomerCheckout,customerBillingOptions,openCustomerBillingPortal,recoverCustomerCheckout} from '../src/features/billing/self-service';
import {hostedBillingUrl,selfServiceStripeTransport,type SelfServiceTransport} from '../src/features/billing/self-service-provider';
import {savePlan,bindBilling,processBillingWebhook} from '../src/features/billing/service';
import {applyDashboardSubscriptionChange} from '../src/features/subscriptions/lifecycle';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {POST as checkoutRoute,DELETE as cancelRoute} from '../src/app/api/workspaces/[workspaceId]/billing/checkout/route';
import {POST as refreshRoute} from '../src/app/api/workspaces/[workspaceId]/billing/refresh/route';
import {POST as portalRoute} from '../src/app/api/workspaces/[workspaceId]/billing/portal/route';
import {POST as recoveryRoute} from '../src/app/api/admin/v1/workspaces/[workspaceId]/billing/checkout/route';
import {GET as optionsRoute} from '../src/app/api/workspaces/[workspaceId]/billing/options/route';
after(()=>db.$disconnect());
test('customer checkout and portal preserve independent billing authority',async t=>{
 const previous={...process.env},tag=randomUUID().replaceAll('-',''),issuer='https://billing-fixture.test',secret='whsec_fixtureCustomerBilling123456789';
 Object.assign(process.env,{DASHBOARD_BILLING_ENABLED:'true',DASHBOARD_BILLING_SELF_SERVICE_ENABLED:'true',DASHBOARD_PUBLIC_ORIGIN:'https://dashboard.test',DASHBOARD_BILLING_STRIPE_MODE:'test',DASHBOARD_BILLING_STRIPE_SECRET_KEY:'sk_test_fixtureBillingAccount123456',DASHBOARD_BILLING_STRIPE_WEBHOOK_SECRET:secret,DASHBOARD_BILLING_PORTAL_CONFIGURATION:'bpc_fixture',DASHBOARD_SESSION_SECRET:'test-only-customer-session-'.repeat(4)});
 const workspace=await db.dashboardWorkspace.create({data:{name:'Customer billing fixture'}}),other=await db.dashboardWorkspace.create({data:{name:'Other billing fixture'}}),user=await db.dashboardUser.create({data:{externalSubject:issuer+'|'+tag}});
 const actor={userId:user.id,issuer,subject:tag};await db.dashboardMembership.create({data:{workspaceId:workspace.id,userId:user.id,role:'OWNER'}});
 const code='BUY_'+tag.toUpperCase().slice(0,24),price='price_'+tag,customer='cus_'+tag,sub='sub_'+tag,now=Math.floor(Date.now()/1000),events:string[]=[];
 const plan=await savePlan({code,name:'Fixture plan',active:true,entitlements:{dashboardAccess:true},externalPriceId:price,currency:'USD',amountMinor:2500,billingInterval:'month'},actor);
 const upgraded=await savePlan({code:code+'_PRO',name:'Fixture higher plan',active:true,entitlements:{dashboardAccess:true},externalPriceId:price+'pro',currency:'USD',amountMinor:5000,billingInterval:'month'},actor);
 let checkout:any,ambiguous=false,createCalls=0,portalCalls=0,foreignPrice=false,badQuantity=false,expireRace=false,providerPriceMismatch=false;
 const keys:string[]=[],requests:Record<string,string>[]=[];
 const subscription:any={id:sub,object:'subscription',customer,livemode:false,status:'active',cancel_at_period_end:false,pause_collection:null,items:{has_more:false,data:[{quantity:1,current_period_start:now-60,current_period_end:now+86400,price:{id:price,currency:'usd',unit_amount:2500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]},latest_invoice:null};
 const read=async(path:string)=>{assert.equal(path,'/subscriptions/'+sub);return structuredClone(subscription);};
 const transport:SelfServiceTransport=async(method,path,fields,key)=>{
  if(path==='/prices/'+price||path==='/prices/'+price+'pro')return {id:path.slice('/prices/'.length),object:'price',active:true,livemode:false,currency:'usd',unit_amount:providerPriceMismatch?999:path.endsWith('pro')?5000:2500,billing_scheme:'per_unit',type:'recurring',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}};
  if(path==='/billing_portal/configurations/bpc_fixture')return {id:'bpc_fixture',object:'billing_portal.configuration',active:true,livemode:false,application:null,features:{payment_method_update:{enabled:true},invoice_history:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:true,default_allowed_updates:badQuantity?['price','quantity']:['price'],proration_behavior:'none',products:[{product:'prod_fixture',prices:foreignPrice?['price_foreign']:[price,price+'pro']}]}}};
  if(path==='/billing_portal/sessions'){portalCalls++;return {id:'bps_fixture',object:'billing_portal.session',customer,configuration:'bpc_fixture',livemode:false,return_url:fields!.return_url,url:'https://billing.stripe.com/p/session/fixture'};}
  if(path==='/checkout/sessions'&&method==='POST'){
   createCalls++;keys.push(key!);requests.push(structuredClone(fields!));
   if(!checkout||checkout.client_reference_id!==fields!.client_reference_id)checkout={id:'cs_test_'+randomUUID().replaceAll('-',''),object:'checkout.session',livemode:false,mode:'subscription',status:'open',client_reference_id:fields!.client_reference_id,metadata:{dashboardProduct:'averidi-dashboard',dashboardCheckoutAttemptId:fields!.client_reference_id},customer:fields!.customer??null,subscription:null,expires_at:Number(fields!.expires_at),success_url:fields!.success_url,cancel_url:fields!.cancel_url,url:'https://checkout.stripe.com/c/pay/fixture',line_items:{has_more:false,data:[{quantity:1,price:{id:price}}]}};
   if(ambiguous){ambiguous=false;throw Error('BILLING_PROVIDER_UNAVAILABLE');}return structuredClone(checkout);
  }
  if(path.endsWith('/expire')){checkout.status=expireRace?'complete':'expired';if(expireRace){checkout.customer=customer;checkout.subscription=sub;throw Error('BILLING_PROVIDER_UNAVAILABLE');}return structuredClone(checkout);}
  assert.equal(path,'/checkout/sessions/'+checkout.id+'?expand[]=line_items');return structuredClone(checkout);
 };
 function signed(type='checkout.session.completed'){const id='evt_'+randomUUID().replaceAll('-','');events.push(id);const raw=Buffer.from(JSON.stringify({id,object:'event',livemode:false,type,data:{object:{id:checkout.id,client_reference_id:checkout.client_reference_id}}})),stamp=Math.floor(Date.now()/1000);return {raw,signature:`t=${stamp},v1=${createHmac('sha256',secret).update(stamp+'.').update(raw).digest('hex')}`};}
 const start=()=>startCustomerCheckout(actor,workspace.id,{planCode:code},transport,read);
 try{
  await t.test('disabled, untrusted owner/input and price mismatch never create a checkout',async()=>{
   process.env.DASHBOARD_BILLING_SELF_SERVICE_ENABLED='false';assert.equal((await customerBillingOptions(actor,workspace.id)).enabled,false);await assert.rejects(start(),/DISABLED/);process.env.DASHBOARD_BILLING_SELF_SERVICE_ENABLED='true';
   await assert.rejects(startCustomerCheckout(actor,other.id,{planCode:code},transport,read),/FORBIDDEN/);
   await assert.rejects(startCustomerCheckout(actor,workspace.id,{planCode:code,customer:'cus_attacker'},transport,read),/INVALID_BILLING_INPUT/);
   providerPriceMismatch=true;await assert.rejects(start(),/PLAN_UNAVAILABLE/);providerPriceMismatch=false;assert.equal(createCalls,0);
  });
  await t.test('ambiguous provider writes retain a durable reservation and identical retry key/parameters',async()=>{
   ambiguous=true;await assert.rejects(start(),/PROVIDER_UNAVAILABLE/);const pending=await db.dashboardCheckoutAttempt.findFirstOrThrow({where:{workspaceId:workspace.id}});assert.equal(pending.status,'CREATING');assert.equal(pending.externalSessionId,null);
   await assert.rejects(bindBilling(workspace.id,{externalCustomerId:customer,externalSubscriptionId:sub,reason:'Manual binding while checkout is pending'},actor),/CHECKOUT_IN_PROGRESS/);
   assert.equal((await applyDashboardSubscriptionChange(workspace.id,{planCode:code,status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000).toISOString()},actor)).error,'PROVIDER_MANAGED');
   const results=await Promise.all([start(),start(),start()]);assert.ok(results.every(r=>r.status==='OPEN'));assert.equal(createCalls,2);assert.equal(new Set(keys).size,1);assert.deepEqual(requests[0],requests[1]);assert.equal(await db.dashboardCheckoutAttempt.count({where:{workspaceId:workspace.id,activeKey:'ACTIVE'}}),1);
   await assert.rejects(startCustomerCheckout(actor,workspace.id,{planCode:'OTHER'},transport,read),/IN_PROGRESS/);
  });
  await t.test('browser returns and open checkouts grant no entitlement; expiration permits a new attempt',async()=>{
   assert.equal((await refreshCustomerBilling(actor,workspace.id,transport,read)).url,null);assert.equal(await db.dashboardSubscription.count({where:{workspaceId:workspace.id}}),0);
   assert.equal((await cancelCustomerCheckout(actor,workspace.id,transport,read)).status,'EXPIRED');assert.equal(await db.dashboardCheckoutAttempt.count({where:{workspaceId:workspace.id,activeKey:'ACTIVE'}}),0);await start();assert.equal(new Set(keys).size,2);
  });
  await t.test('signed verified completion binds only the owned session; incomplete payment remains inactive',async()=>{
   checkout.status='complete';checkout.customer=customer;checkout.subscription=sub;subscription.status='incomplete';const event=signed();
   await assert.rejects(processBillingWebhook(event.raw,'forged',read,transport),/INVALID_BILLING/);
   const old=checkout.metadata.dashboardCheckoutAttemptId;checkout.metadata.dashboardCheckoutAttemptId='foreign';await assert.rejects(processBillingWebhook(event.raw,event.signature,read,transport),/ACCOUNT_MISMATCH/);checkout.metadata.dashboardCheckoutAttemptId=old;
   assert.equal((await processBillingWebhook(event.raw,event.signature,read,transport)).outcome,'APPLIED');assert.equal((await processBillingWebhook(event.raw,event.signature,read,transport)).duplicate,true);
   assert.equal((await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId:workspace.id}})).status,'INACTIVE');await assert.rejects(start(),/SUBSCRIPTION_EXISTS/);
   subscription.status='active';const paid=signed('checkout.session.async_payment_succeeded');await processBillingWebhook(paid.raw,paid.signature,read,transport);assert.equal((await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId:workspace.id}})).status,'ACTIVE');
  });
  await t.test('portal rejects foreign catalog prices/quantity changes and uses only the owned customer',async()=>{
   foreignPrice=true;await assert.rejects(openCustomerBillingPortal(actor,workspace.id,transport),/PORTAL_UNAVAILABLE/);foreignPrice=false;
   badQuantity=true;await assert.rejects(openCustomerBillingPortal(actor,workspace.id,transport),/PORTAL_UNAVAILABLE/);badQuantity=false;
   await assert.rejects(openCustomerBillingPortal(actor,other.id,transport),/FORBIDDEN/);assert.equal(portalCalls,0);
   assert.match((await openCustomerBillingPortal(actor,workspace.id,transport)).url,/^https:\/\/billing.stripe.com\//);assert.equal(portalCalls,1);
  });
  await t.test('approved upgrades and downgrades reconcile financial mapping without changing entitlement rules',async()=>{
   subscription.items.data[0].price.id=price+'pro';subscription.items.data[0].price.unit_amount=5000;
   await refreshCustomerBilling(actor,workspace.id,transport,read);assert.equal((await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId:workspace.id}})).planCode,upgraded.code);
   subscription.items.data[0].price.id=price;subscription.items.data[0].price.unit_amount=2500;
   await refreshCustomerBilling(actor,workspace.id,transport,read);assert.equal((await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId:workspace.id}})).planCode,code);
  });
  await t.test('scheduled cancellation preserves paid access and existing operator holds survive refresh',async()=>{
   subscription.cancel_at_period_end=true;await db.dashboardSubscription.update({where:{workspaceId:workspace.id},data:{accessSuspended:true}});await refreshCustomerBilling(actor,workspace.id,transport,read);
   const state=await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId:workspace.id}});assert.equal(state.accessSuspended,true);assert.equal(state.status,'ACTIVE');assert.equal((await db.dashboardBillingBinding.findUniqueOrThrow({where:{workspaceId:workspace.id}})).cancelAtPeriodEnd,true);await assert.rejects(start(),/ACCESS_HELD/);
   await db.dashboardSubscription.update({where:{workspaceId:workspace.id},data:{accessSuspended:false}});
  });
  await t.test('terminal cancellation permits repurchase and a completion/expire race follows provider state',async()=>{
   subscription.status='canceled';await refreshCustomerBilling(actor,workspace.id,transport,read);await start();assert.equal(requests.at(-1)!.customer,customer);expireRace=true;
   assert.equal((await cancelCustomerCheckout(actor,workspace.id,transport,read)).status,'COMPLETED');assert.equal(await db.dashboardCheckoutAttempt.count({where:{workspaceId:workspace.id,activeKey:'ACTIVE'}}),0);
  });
  await t.test('an old completed checkout cannot rebind a replacement subscription',async()=>{
   const previousSub=subscription.id,binding=await db.dashboardBillingBinding.findUniqueOrThrow({where:{workspaceId:workspace.id}});
   await db.dashboardBillingBinding.update({where:{id:binding.id},data:{externalSubscriptionId:'sub_replacement'+tag}});
   const late=signed();await processBillingWebhook(late.raw,late.signature,read,transport);
   assert.equal((await db.dashboardBillingBinding.findUniqueOrThrow({where:{workspaceId:workspace.id}})).externalSubscriptionId,'sub_replacement'+tag);
   await db.dashboardBillingBinding.update({where:{id:binding.id},data:{externalSubscriptionId:previousSub}});
  });
  await t.test('active legacy access and ambiguous old provider attempts cannot create duplicate purchases',async()=>{
   await db.dashboardMembership.create({data:{workspaceId:other.id,userId:user.id,role:'OWNER'}});
   await db.dashboardSubscription.create({data:{workspaceId:other.id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}});
   const calls=createCalls;await assert.rejects(startCustomerCheckout(actor,other.id,{planCode:code},transport,read),/SUBSCRIPTION_EXISTS/);assert.equal(createCalls,calls);
   await db.dashboardSubscription.update({where:{workspaceId:other.id},data:{status:'INACTIVE'}});
   const attempt=await db.dashboardCheckoutAttempt.create({data:{workspaceId:other.id,planId:plan.id,activeKey:'ACTIVE',request:{},expiresAt:new Date(0),createdAt:new Date(Date.now()-24*3600000)}});
   await assert.rejects(startCustomerCheckout(actor,other.id,{planCode:code},transport,read),/RECOVERY_REQUIRED/);assert.equal(createCalls,calls);
   assert.equal((await db.dashboardCheckoutAttempt.findUniqueOrThrow({where:{id:attempt.id}})).activeKey,'ACTIVE');
  });
  await t.test('operator recovery requires a verified matching session and preserves reservation on mismatches',async()=>{
   assert.equal((await recoveryRoute(new Request('https://dashboard.test/api',{method:'POST',body:'{}'}),{params:Promise.resolve({workspaceId:other.id})})).status,403);
   const attempt=await db.dashboardCheckoutAttempt.findFirstOrThrow({where:{workspaceId:other.id,activeKey:'ACTIVE'}});
   await assert.rejects(recoverCustomerCheckout(other.id,{attemptId:attempt.id,sessionId:checkout.id,reason:'Investigating ambiguous provider response'},actor,transport,read),/INVALID_BILLING_SNAPSHOT|ACCOUNT_MISMATCH/);
   assert.equal((await db.dashboardCheckoutAttempt.findUniqueOrThrow({where:{id:attempt.id}})).activeKey,'ACTIVE');
   const request=requests[0],owned=await db.dashboardCheckoutAttempt.findUniqueOrThrow({where:{id:request.client_reference_id}}),existing=checkout;
   checkout={...existing,id:owned.externalSessionId,status:'expired',client_reference_id:owned.id,metadata:{dashboardProduct:'averidi-dashboard',dashboardCheckoutAttemptId:owned.id},expires_at:Number(request.expires_at),success_url:request.success_url,cancel_url:request.cancel_url,customer:null,subscription:null};
   const result=await recoverCustomerCheckout(workspace.id,{attemptId:owned.id,sessionId:checkout.id,reason:'Verified expired provider session in dedicated test account'},actor,transport,read);assert.equal(result.status,'EXPIRED');checkout=existing;
  });
  await t.test('customer route mutations require verified identity, same origin and bounded strict input',async()=>{
   const session=await issueDashboardBrowserSession(actor),context={params:Promise.resolve({workspaceId:workspace.id})};
   function req(body:unknown={},origin='https://dashboard.test',cookie=true,method='POST'){return new Request('https://dashboard.test/dashboard/app/api/workspaces/'+workspace.id+'/billing',{method,headers:{origin,...(cookie?{cookie:'__Secure-averidi-dashboard='+session}:{})},body:JSON.stringify(body)});}
   for(const route of [checkoutRoute,cancelRoute,refreshRoute,portalRoute]){assert.equal((await route(req({},'https://evil.test'),context)).status,403);assert.equal((await route(req({},'https://dashboard.test',false),context)).status,403);assert.equal((await route(req({actor:'spoof'}),context)).status,400);}
   assert.equal((await optionsRoute(new Request('https://dashboard.test',{headers:{cookie:'__Secure-averidi-dashboard='+session}}),context)).status,200);
   await db.dashboardMembership.update({where:{userId_workspaceId:{userId:user.id,workspaceId:workspace.id}},data:{role:'VIEWER'}});assert.equal((await optionsRoute(new Request('https://dashboard.test',{headers:{cookie:'__Secure-averidi-dashboard='+session}}),context)).status,403);
  });
 }finally{
  await db.dashboardBillingEvent.deleteMany({where:{id:{in:events}}});await db.dashboardWorkspace.deleteMany({where:{id:{in:[workspace.id,other.id]}}});await db.dashboardUser.delete({where:{id:user.id}});await db.dashboardBillingPlan.deleteMany({where:{code:{in:[code,upgraded.code]}}});
  for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);
 }
});
test('hosted payment URLs and fixed provider resource paths reject arbitrary destinations',async()=>{
 for(const url of ['http://checkout.stripe.com/a','https://checkout.stripe.com.evil.test/a','https://user@checkout.stripe.com/a','https://checkout.stripe.com:444/a'])assert.throws(()=>hostedBillingUrl(url,'checkout.stripe.com'),/INVALID_BILLING_SNAPSHOT/);
 for(const path of ['/customers/cus_foreign','https://evil.test','/prices/../customers','/billing_portal/sessions?customer=cus_foreign'])await assert.rejects(selfServiceStripeTransport('GET',path),/INVALID_BILLING_RESOURCE/);
});
