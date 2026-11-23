import {test} from 'node:test';
import {Prisma} from '@prisma/client';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {dashboardDb as db} from '../src/server/db';
import {savePlan,bindBilling,reconcileBilling,setBillingHold,processBillingWebhook} from '../src/features/billing/service';
import {workspaceDashboardEntitlement} from '../src/features/subscriptions/entitlements';
import {applyDashboardSubscriptionChange} from '../src/features/subscriptions/lifecycle';
import {updateDashboardConfiguration} from '../src/features/administration/configuration';
import {createSupportCase,updateSupportCase} from '../src/features/administration/support';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {POST as webhookRoute} from '../src/app/api/billing/stripe/webhook/route';
import {PUT as planRoute} from '../src/app/api/admin/v1/plans/route';
import {GET as customerBilling} from '../src/app/api/workspaces/[workspaceId]/billing/route';
import {GET as adminEvents} from '../src/app/api/admin/v1/billing/events/route';
import {GET as adminAudit} from '../src/app/api/admin/v1/audit/route';

test('independent billing and administrative acceptance on PostgreSQL and verified HTTPS',async t=>{
 const original={...process.env},originalFetch=globalThis.fetch,tag=randomUUID().replaceAll('-',''),secret='whsec_fixtureBillingSecret123456789';
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'billing-admin',alg:'RS256'};
 let providerStatus=200,requests=0;
 const now=Math.floor(Date.now()/1000),subId='sub_'+tag,customerId='cus_'+tag,invoiceId='in_'+tag,priceId='price_'+tag;
 const snapshot:any={id:subId,object:'subscription',customer:customerId,livemode:false,status:'active',cancel_at_period_end:false,pause_collection:null,items:{has_more:false,data:[{quantity:1,current_period_start:now-86400,current_period_end:now+86400,price:{id:priceId,currency:'usd',unit_amount:2500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]},latest_invoice:invoiceId};
 const invoice:any={id:invoiceId,object:'invoice',customer:customerId,livemode:false,currency:'usd',total:2500,status:'paid',period_start:now-86400,period_end:now+86400,status_transitions:{paid_at:now},parent:{type:'subscription_details',subscription_details:{subscription:subId}}};
 const server=https.createServer({cert:await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key:await readFile(process.env.DASHBOARD_TEST_TLS_KEY!)},(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/jwks'){res.end(JSON.stringify({keys:[jwk]}));return;}
  requests++;
  if(req.headers.authorization!=='Bearer sk_test_fixtureBillingAccount123456'||req.headers['stripe-version']!=='2025-06-30.basil'||req.headers['stripe-account']){res.statusCode=403;res.end('{}');return;}
  res.statusCode=providerStatus;
  res.end(JSON.stringify(req.url==='/v1/subscriptions/'+subId?snapshot:req.url==='/v1/invoices/'+invoiceId?invoice:{}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const issuer=`https://127.0.0.1:${(server.address() as {port:number}).port}`;
 Object.assign(process.env,{DASHBOARD_BILLING_ENABLED:'true',DASHBOARD_BILLING_STRIPE_MODE:'test',DASHBOARD_BILLING_STRIPE_SECRET_KEY:'sk_test_fixtureBillingAccount123456',DASHBOARD_BILLING_STRIPE_WEBHOOK_SECRET:secret,DASHBOARD_ADMIN_OIDC_ISSUER:issuer,DASHBOARD_ADMIN_OIDC_AUDIENCE:'billing-admin-fixture',DASHBOARD_ADMIN_OIDC_JWKS_URL:issuer+'/jwks',DASHBOARD_ADMIN_BRIDGE_ENABLED:'false',DASHBOARD_SESSION_SECRET:'test-only-billing-session-secret-'.repeat(3),DASHBOARD_RELEASE_MODE:'OFF'});
 // Redirect the fixed provider origin only inside this fixture. TLS verification stays enabled.
 globalThis.fetch=((input:any,init:any)=>{const url=String(input);return originalFetch(url.startsWith('https://api.stripe.com/v1/')?issuer+new URL(url).pathname:input,init);}) as typeof fetch;
 const admin={issuer,subject:'fixture-operator'},plan={code:'FIXTURE_'+tag.toUpperCase().slice(0,25),name:'Contract fixture only',active:true,entitlements:{dashboardAccess:true},externalPriceId:priceId,currency:'USD',amountMinor:2500,billingInterval:'month'};
 const workspace=await db.dashboardWorkspace.create({data:{name:'Billing fixture'}}),other=await db.dashboardWorkspace.create({data:{name:'Other fixture'}}),user=await db.dashboardUser.create({data:{externalSubject:issuer+'|'+tag}});
 const actor={userId:user.id,issuer,subject:tag};
 await db.dashboardMembership.create({data:{workspaceId:workspace.id,userId:user.id,role:'OWNER'}});
 const eventIds:string[]=[];
 function event(type='customer.subscription.updated',object:any={id:subId},id='evt_'+randomUUID().replaceAll('-','')){eventIds.push(id);return Buffer.from(JSON.stringify({id,object:'event',type,livemode:false,data:{object}}));}
 function sig(raw:Buffer){const stamp=Math.floor(Date.now()/1000);return `t=${stamp},v1=${createHmac('sha256',secret).update(stamp+'.').update(raw).digest('hex')}`;}
 try{
  await t.test('only a signed administrative access token may change plans or read receipts',async()=>{
   const readToken=await new SignJWT({token_use:'access',dashboard_permissions:['dashboard:read']}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('billing-admin-fixture').setSubject('reader').setIssuedAt().setExpirationTime('5m').sign(privateKey);
   const manageToken=await new SignJWT({token_use:'access',dashboard_permissions:['dashboard:manage']}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('billing-admin-fixture').setSubject('manager').setIssuedAt().setExpirationTime('5m').sign(privateKey);
   function request(token?:string,origin?:string){return new Request('https://dashboard.test/api/admin/v1/plans',{method:'PUT',headers:{...(token?{authorization:'Bearer '+token}:{}),...(origin?{origin}:{})},body:JSON.stringify(plan)});}
   assert.equal((await planRoute(request())).status,403);
   assert.equal((await planRoute(request(readToken))).status,403);
   assert.equal((await planRoute(request(manageToken,'https://evil.test'))).status,403);
   const response=await planRoute(request(manageToken));assert.equal(response.status,200);assert.match(response.headers.get('cache-control')! ,/no-store/);
   assert.equal((await adminEvents(new Request('https://dashboard.test/api/admin/v1/billing/events',{headers:{authorization:'Bearer '+readToken}}))).status,200);
   assert.equal((await adminAudit(new Request('https://dashboard.test/api/admin/v1/audit?limit=1',{headers:{authorization:'Bearer '+readToken}}))).status,200);
  });
  await t.test('binding alone cannot grant access and foreign resource ownership is unique',async()=>{
   await bindBilling(workspace.id,{externalCustomerId:customerId,externalSubscriptionId:subId,reason:'Attach contract fixture'},admin);
   assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,false);
   await assert.rejects(bindBilling(other.id,{externalCustomerId:customerId,externalSubscriptionId:subId,reason:'Attempt cross tenant'},admin));
   assert.equal((await applyDashboardSubscriptionChange(workspace.id,{planCode:plan.code,status:'ACTIVE',currentPeriodEnd:new Date((now+86400)*1000).toISOString()},admin)).error,'PROVIDER_MANAGED');
  });
  await t.test('validated HTTPS reconciliation stores exact invoice money and customer entitlements',async()=>{
   await reconcileBilling(workspace.id,admin);
   assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,true);
   assert.equal(await workspaceDashboardEntitlement(actor,other.id),null);
   const stored=await db.dashboardInvoice.findUniqueOrThrow({where:{provider_externalInvoiceId:{provider:'STRIPE',externalInvoiceId:invoiceId}}});assert.equal(stored.amount.toFixed(2),'25.00');assert.equal(stored.workspaceId,workspace.id);
   await assert.rejects(savePlan({...plan,amountMinor:1},admin),/BILLING_PLAN_IMMUTABLE/);
   assert.ok(requests>=2);
   const command=await promisify(execFile)(process.execPath,['--import','tsx','scripts/check-billing.mjs'],{env:process.env});assert.equal(JSON.parse(command.stdout).provider,'STRIPE');assert.equal(command.stdout.includes('sk_test_'),false);
   await assert.rejects(promisify(execFile)(process.execPath,['--import','tsx','scripts/reconcile-billing.mjs','unknown_fixture_workspace'],{env:process.env}),(e:any)=>e.code===1&&e.stderr.includes('BILLING_BINDING_NOT_FOUND'));
  });
  await t.test('verified webhook HTTP contract deduplicates racing deliveries exactly once',async()=>{
   const raw=event(),before=await db.dashboardAdminAudit.count({where:{workspaceId:workspace.id,action:'BILLING_RECONCILED'}});
   const result=await Promise.all([processBillingWebhook(raw,sig(raw)),processBillingWebhook(raw,sig(raw))]);
   assert.equal(result.filter(x=>x.duplicate).length,1);
   assert.equal(await db.dashboardAdminAudit.count({where:{workspaceId:workspace.id,action:'BILLING_RECONCILED'}}),before+1);
   const duplicate=await webhookRoute(new Request('https://dashboard.test/api/billing/stripe/webhook',{method:'POST',headers:{'stripe-signature':sig(raw)},body:new Uint8Array(raw)}));assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
   const forged=await webhookRoute(new Request('https://dashboard.test/api/billing/stripe/webhook',{method:'POST',body:new Uint8Array(raw)}));assert.equal(forged.status,400);
   const changed=Buffer.from(raw.toString().replace('subscription.updated','subscription.deleted'));await assert.rejects(processBillingWebhook(changed,sig(changed)),/BILLING_EVENT_CONFLICT/);
  });
  await t.test('late payloads cannot restore canceled access; failed payment and recovery follow current state',async()=>{
   snapshot.status='past_due';const failed=event('invoice.payment_failed',{id:invoiceId,parent:invoice.parent});await processBillingWebhook(failed,sig(failed));
   assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,false);
   snapshot.status='active';snapshot.cancel_at_period_end=true;await reconcileBilling(workspace.id,admin);assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,true);
   snapshot.status='canceled';const stale=event('customer.subscription.updated',{id:subId,status:'active'});await processBillingWebhook(stale,sig(stale));assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,false);
   snapshot.status='active';await reconcileBilling(workspace.id,admin);
  });
  await t.test('holds and plan retirement immediately deny access and provider sync cannot clear holds',async()=>{
   await setBillingHold(workspace.id,{accessSuspended:true,reason:'Investigate fixture access'},admin);await reconcileBilling(workspace.id,admin);assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,false);
   await setBillingHold(workspace.id,{accessSuspended:false,reason:'Resolve fixture investigation'},admin);assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,true);
   await savePlan({...plan,active:false},admin);assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,false);await savePlan(plan,admin);
   snapshot.items.data[0].price.id='price_unregistered';await reconcileBilling(workspace.id,admin);assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,false);snapshot.items.data[0].price.id=priceId;
  });
  await t.test('provider outage and foreign invoices roll back receipt and entitlement together, then retry succeeds',async()=>{
   const raw=event();providerStatus=500;await assert.rejects(processBillingWebhook(raw,sig(raw)),/BILLING_PROVIDER_UNAVAILABLE/);assert.equal(await db.dashboardBillingEvent.findUnique({where:{id:JSON.parse(raw.toString()).id}}),null);
   providerStatus=200;invoice.customer='cus_foreign';await assert.rejects(processBillingWebhook(raw,sig(raw)),/BILLING_ACCOUNT_MISMATCH/);assert.equal((await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId:workspace.id}})).planCode,'UNMAPPED');
   invoice.customer=customerId;await processBillingWebhook(raw,sig(raw));assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,true);
   const foreign=event('customer.subscription.updated',{id:'sub_unregistered'});assert.equal((await processBillingWebhook(foreign,sig(foreign))).outcome,'IGNORED');
  });
  await t.test('worker denies jobs under a billing hold before any domain effect',async()=>{
   assert.equal((await workspaceDashboardEntitlement(actor,workspace.id))?.active,true);
   await setBillingHold(workspace.id,{accessSuspended:true,reason:'Pause fixture background processing'},admin);
   const previous=process.env.DASHBOARD_WORKER_ENABLED;process.env.DASHBOARD_WORKER_ENABLED='true';
   const job=await db.dashboardJob.create({data:{workspaceId:workspace.id,kind:'DATASET_PROFILE',payload:{},createdAt:new Date(0)}});
   try{await assert.rejects(runDashboardWorkerOnce(),/SUBSCRIPTION_REQUIRED/);const result=await db.dashboardJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(result.status,'FAILED');assert.equal(result.effectCommittedAt,null);}finally{if(previous===undefined)delete process.env.DASHBOARD_WORKER_ENABLED;else process.env.DASHBOARD_WORKER_ENABLED=previous;await db.dashboardJob.delete({where:{id:job.id}});await setBillingHold(workspace.id,{accessSuspended:false,reason:'Resume fixture background processing'},admin);}
  });
  await t.test('expired owners retain billing visibility while another tenant and anonymous caller are denied',async()=>{
   await db.dashboardSubscription.update({where:{workspaceId:workspace.id},data:{currentPeriodEnd:new Date(0)}});
   const token=await issueDashboardBrowserSession(actor),request=new Request('https://dashboard.test/api',{headers:{cookie:'__Secure-averidi-dashboard='+token}});
   assert.equal((await customerBilling(request,{params:Promise.resolve({workspaceId:workspace.id})})).status,200);
   assert.equal((await customerBilling(request,{params:Promise.resolve({workspaceId:other.id})})).status,403);
   assert.equal((await customerBilling(new Request('https://dashboard.test/api'),{params:Promise.resolve({workspaceId:workspace.id})})).status,403);
   const body=await (await customerBilling(request,{params:Promise.resolve({workspaceId:workspace.id})})).json();assert.equal(body.invoices.items.length,1);assert.equal(body.binding.externalSubscriptionId,undefined);
  });
  await t.test('support transitions reject stale updates and preserve independent audit evidence',async()=>{
   await assert.rejects(createSupportCase(other.id,{subject:'Foreign support',message:'Must never be allowed'},actor),/FORBIDDEN/);
   const record=await createSupportCase(workspace.id,{subject:'Fixture support request',message:'Please check the fixture subscription'},actor);
   const next=await updateSupportCase(record.id,{status:'IN_PROGRESS',expectedUpdatedAt:record.updatedAt.toISOString(),note:'Operator starts fixture investigation'},admin);
   await assert.rejects(updateSupportCase(record.id,{status:'RESOLVED',expectedUpdatedAt:record.updatedAt.toISOString(),note:'Stale conflicting operation'},admin),/SUPPORT_CASE_CONFLICT/);
   await updateSupportCase(record.id,{status:'RESOLVED',expectedUpdatedAt:next.updatedAt.toISOString(),note:'Fixture investigation resolved'},admin);
   assert.equal(await db.dashboardAdminAudit.count({where:{workspaceId:workspace.id,action:'ADMIN_SUPPORT_CASE'}}),2);
  });
  await t.test('configuration is audited, rejects secret keys and controls support admission',async()=>{
   const keys=['SUPPORT_CASE_CREATION_ENABLED','SUPPORT_MAX_OPEN_CASES_PER_USER'];
   const previous=await db.dashboardConfiguration.findMany({where:{key:{in:keys}}});
   try{
    await assert.rejects(updateDashboardConfiguration({key:'DASHBOARD_RELEASE_MODE',value:'GENERAL',reason:'Attempt unauthorized setting'},admin),/INVALID_BILLING_INPUT/);
    await updateDashboardConfiguration({key:keys[0],value:false,reason:'Pause support fixture intake'},admin);
    await assert.rejects(createSupportCase(workspace.id,{subject:'Blocked support',message:'Intake is explicitly paused'},actor),/SUPPORT_DISABLED/);
    await updateDashboardConfiguration({key:keys[0],value:true,reason:'Resume support fixture intake'},admin);
    await updateDashboardConfiguration({key:keys[1],value:1,reason:'Bound support fixture admission'},admin);
    await createSupportCase(workspace.id,{subject:'Allowed support',message:'First open case within the limit'},actor);
    await assert.rejects(createSupportCase(workspace.id,{subject:'Excess support',message:'Must respect configured limit'},actor),/SUPPORT_LIMIT/);
   }finally{await db.dashboardConfiguration.deleteMany({where:{key:{in:keys}}});for(const row of previous)await db.dashboardConfiguration.create({data:{...row,value:row.value===null?Prisma.JsonNull:row.value}});}
  });
  await t.test('billing rejects Connect events and wrong live mode before touching state',async()=>{
   for(const extra of [{livemode:true},{account:'acct_foreign'}]){
    const obj=JSON.parse(event().toString());Object.assign(obj,extra);const raw=Buffer.from(JSON.stringify(obj));const before=requests;
    await assert.rejects(processBillingWebhook(raw,sig(raw)),/BILLING_ACCOUNT_MISMATCH/);assert.equal(requests,before);
   }
  });
  await t.test('disabled ingress fails closed even with a valid signature',async()=>{
   process.env.DASHBOARD_BILLING_ENABLED='false';const raw=event();const response=await webhookRoute(new Request('https://dashboard.test/api/billing/stripe/webhook',{method:'POST',headers:{'stripe-signature':sig(raw)},body:new Uint8Array(raw)}));assert.equal(response.status,503);assert.equal(await db.dashboardBillingEvent.findUnique({where:{id:JSON.parse(raw.toString()).id}}),null);
  });
 }finally{
  globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);
  await db.dashboardBillingEvent.deleteMany({where:{id:{in:eventIds}}});
  await db.dashboardBillingBinding.deleteMany({where:{workspaceId:{in:[workspace.id,other.id]}}});
  await db.dashboardWorkspace.deleteMany({where:{id:{in:[workspace.id,other.id]}}});await db.dashboardUser.delete({where:{id:user.id}});
  await db.dashboardBillingPlan.deleteMany({where:{code:plan.code}});await db.dashboardAdminAudit.deleteMany({where:{OR:[{workspaceId:workspace.id},{actorIssuer:issuer}]}});
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.$disconnect();
 }
});
