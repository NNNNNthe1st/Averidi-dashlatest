import {setAuditActor} from '../audit/context';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Prisma,DashboardBillingPlan,DashboardCheckoutAttempt} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {billingConfig,checkoutRecoverySchema} from './contracts';
import {billingLock,reconcileLocked} from './service';
import {stripeTransport,subscriptionSchema,type BillingTransport} from './stripe';
import {checkoutId,checkoutSnapshot,providerPrice,hostedBillingUrl,selfServiceStripeTransport,type SelfServiceTransport} from './self-service-provider';
type Tx=Prisma.TransactionClient;
const transactionOptions={timeout:25000,maxWait:10000};
const purchase=z.object({planCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)}).strict();
export function customerBillingSettings(){
 if(process.env.DASHBOARD_BILLING_SELF_SERVICE_ENABLED!=='true')throw Error('BILLING_SELF_SERVICE_DISABLED');
 const config=billingConfig();let origin:URL;try{origin=new URL(process.env.DASHBOARD_PUBLIC_ORIGIN??'');}catch{throw Error('BILLING_NOT_CONFIGURED');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('BILLING_NOT_CONFIGURED');
 return {...config,origin:origin.origin};
}
async function owner(tx:Tx,actor:Actor,workspaceId:string){if((await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}}))?.role!=='OWNER')throw Error('FORBIDDEN');}
async function audit(tx:Tx,actor:Pick<Actor,'issuer'|'subject'>,workspaceId:string,action:string,resourceId:string){await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action,resourceType:'BILLING',resourceId}});}
function eligible(plan:DashboardBillingPlan|null):plan is DashboardBillingPlan {return !!plan&&plan.active&&(plan.entitlements as {dashboardAccess?:boolean})?.dashboardAccess===true&&!!plan.externalPriceId&&!!plan.currency&&plan.amountMinor!==null&&['month','year'].includes(plan.billingInterval??'');}
async function validatePrice(plan:DashboardBillingPlan,transport:SelfServiceTransport,live:boolean){
 const p=providerPrice.safeParse(await transport('GET','/prices/'+plan.externalPriceId));
 if(!p.success||!p.data.active||p.data.livemode!==live||p.data.id!==plan.externalPriceId||p.data.currency.toUpperCase()!==plan.currency||p.data.unit_amount!==plan.amountMinor||p.data.recurring.interval!==plan.billingInterval)throw Error('BILLING_PLAN_UNAVAILABLE');
}
function returnUrl(origin:string,workspaceId:string){return origin+'/dashboard/app/workspaces/'+encodeURIComponent(workspaceId)+'/billing';}
function fields(attempt:DashboardCheckoutAttempt){const parsed=z.record(z.string(),z.string()).safeParse(attempt.request);if(!parsed.success)throw Error('INVALID_BILLING_SNAPSHOT');return parsed.data;}
function validateCheckout(attempt:DashboardCheckoutAttempt,raw:unknown,live:boolean){
 const parsed=checkoutSnapshot.safeParse(raw);if(!parsed.success)throw Error('INVALID_BILLING_SNAPSHOT');const s=parsed.data,f=fields(attempt);
 if(s.livemode!==live||s.client_reference_id!==attempt.id||s.metadata.dashboardCheckoutAttemptId!==attempt.id||s.expires_at!==Number(f.expires_at)||s.success_url!==f.success_url||s.cancel_url!==f.cancel_url||s.line_items.data[0].price.id!==f['line_items[0][price]']||attempt.externalSessionId&&s.id!==attempt.externalSessionId||f.customer&&s.customer!==f.customer)throw Error('BILLING_ACCOUNT_MISMATCH');
 if(s.url)hostedBillingUrl(s.url,'checkout.stripe.com');return s;
}
async function currentCheckout(attempt:DashboardCheckoutAttempt,transport:SelfServiceTransport){
 if(attempt.externalSessionId)return transport('GET','/checkout/sessions/'+attempt.externalSessionId+'?expand[]=line_items');
 // Never reuse a forgotten provider idempotency key after Stripe's retention floor.
 // An ambiguous old attempt remains reserved for operator recovery, not a second charge.
 if(Date.now()-attempt.createdAt.getTime()>23*3600_000)throw Error('BILLING_CHECKOUT_RECOVERY_REQUIRED');
 return transport('POST','/checkout/sessions',fields(attempt),'dashboard-checkout:'+attempt.id);
}
async function terminalSubscription(tx:Tx,workspaceId:string,read:BillingTransport){
 const binding=await tx.dashboardBillingBinding.findUnique({where:{workspaceId},include:{customer:true}});if(!binding)return;
 const p=subscriptionSchema.safeParse(await read('/subscriptions/'+binding.externalSubscriptionId));
 if(!p.success||p.data.id!==binding.externalSubscriptionId||p.data.customer!==binding.customer.externalCustomerId||p.data.livemode!==billingConfig().live)throw Error('INVALID_BILLING_SNAPSHOT');
 if(!['canceled','incomplete_expired'].includes(p.data.status))throw Error('BILLING_SUBSCRIPTION_EXISTS');
}
async function applyCheckout(tx:Tx,attempt:DashboardCheckoutAttempt,raw:unknown,read:BillingTransport){
 const s=validateCheckout(attempt,raw,billingConfig().live);
 if(s.status==='open'){
  if(attempt.activeKey!=='ACTIVE'||!s.url)throw Error('BILLING_CHECKOUT_CONFLICT');
  await tx.dashboardCheckoutAttempt.update({where:{id:attempt.id},data:{externalSessionId:s.id,status:'OPEN'}});return {status:'OPEN',url:hostedBillingUrl(s.url,'checkout.stripe.com')};
 }
 if(s.status==='expired'){
  if(attempt.status==='COMPLETED')throw Error('BILLING_CHECKOUT_CONFLICT');
  await tx.dashboardCheckoutAttempt.update({where:{id:attempt.id},data:{externalSessionId:s.id,status:'EXPIRED',activeKey:null}});return {status:'EXPIRED',url:null};
 }
 if(!s.customer||!s.subscription)throw Error('INVALID_BILLING_SNAPSHOT');
 if(attempt.status==='COMPLETED'){
  // A delayed payment event may activate the same subscription, but an old checkout must never rebind a replacement.
  const binding=await tx.dashboardBillingBinding.findUnique({where:{workspaceId:attempt.workspaceId}});
  if(binding?.externalSubscriptionId===s.subscription)await reconcileLocked(tx,attempt.workspaceId,{issuer:'dashboard:billing:stripe',subject:'verified-checkout'},read);
  return {status:'COMPLETED',url:null};
 }
 if(attempt.activeKey!=='ACTIVE')throw Error('BILLING_CHECKOUT_CONFLICT');
 const existing=await tx.dashboardBillingBinding.findUnique({where:{workspaceId:attempt.workspaceId}});
 if(existing&&existing.externalSubscriptionId!==s.subscription)await terminalSubscription(tx,attempt.workspaceId,read);
 const customer=await tx.dashboardBillingCustomer.upsert({where:{workspaceId_provider:{workspaceId:attempt.workspaceId,provider:'STRIPE'}},create:{workspaceId:attempt.workspaceId,provider:'STRIPE',externalCustomerId:s.customer},update:{}});
 if(customer.externalCustomerId!==s.customer)throw Error('BILLING_ACCOUNT_MISMATCH');
 await tx.dashboardBillingBinding.upsert({where:{workspaceId:attempt.workspaceId},create:{workspaceId:attempt.workspaceId,customerId:customer.id,externalSubscriptionId:s.subscription},update:{customerId:customer.id,externalSubscriptionId:s.subscription,reconciledAt:null}});
 await reconcileLocked(tx,attempt.workspaceId,{issuer:'dashboard:billing:stripe',subject:'verified-checkout'},read);
 await tx.dashboardCheckoutAttempt.update({where:{id:attempt.id},data:{externalSessionId:s.id,status:'COMPLETED',activeKey:null}});
 await audit(tx,{issuer:'dashboard:billing:stripe',subject:'verified-checkout'},attempt.workspaceId,'BILLING_CHECKOUT_COMPLETED',attempt.id);return {status:'COMPLETED',url:null};
}
export async function customerBillingOptions(actor:Actor,workspaceId:string){
 await owner(db,actor,workspaceId);
 if(process.env.DASHBOARD_BILLING_SELF_SERVICE_ENABLED!=='true'||process.env.DASHBOARD_BILLING_ENABLED!=='true')return {enabled:false,plans:[],pending:null,canCheckout:false,canManage:false};
 customerBillingSettings();
 const [all,binding,subscription,pending]=await Promise.all([db.dashboardBillingPlan.findMany({where:{active:true,externalPriceId:{not:null}},orderBy:{code:'asc'},take:100}),db.dashboardBillingBinding.findUnique({where:{workspaceId}}),db.dashboardSubscription.findUnique({where:{workspaceId}}),db.dashboardCheckoutAttempt.findUnique({where:{workspaceId_activeKey:{workspaceId,activeKey:'ACTIVE'}},include:{plan:{select:{code:true,name:true}}}})]);
 const legacyActive=!binding&&subscription?.status==='ACTIVE'&&subscription.currentPeriodEnd&&subscription.currentPeriodEnd>new Date();
 return {enabled:true,plans:all.filter(eligible).map(({code,name,currency,amountMinor,billingInterval})=>({code,name,currency,amountMinor,billingInterval})),pending:pending?{status:pending.status,planCode:pending.plan.code,planName:pending.plan.name,expiresAt:pending.expiresAt}:null,canCheckout:!subscription?.accessSuspended&&!legacyActive&&(!binding||['CANCELED','INACTIVE'].includes(subscription?.status??'')),canManage:!!binding&&/^bpc_[A-Za-z0-9]{1,100}$/.test(process.env.DASHBOARD_BILLING_PORTAL_CONFIGURATION??'')};
}
export async function startCustomerCheckout(actor:Actor,workspaceId:string,input:unknown,transport:SelfServiceTransport=selfServiceStripeTransport,read:BillingTransport=stripeTransport){
 const config=customerBillingSettings(),p=purchase.safeParse(input);if(!p.success)throw Error('INVALID_BILLING_INPUT');
 // Commit the reservation BEFORE any provider write, so failed/ambiguous network calls retain their key and parameters.
 const id=await db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);await owner(tx,actor,workspaceId);
  const pending=await tx.dashboardCheckoutAttempt.findUnique({where:{workspaceId_activeKey:{workspaceId,activeKey:'ACTIVE'}},include:{plan:true}});
  if(pending){if(pending.plan.code!==p.data.planCode)throw Error('BILLING_CHECKOUT_IN_PROGRESS');return pending.id;}
  const subscription=await tx.dashboardSubscription.findUnique({where:{workspaceId}});if(subscription?.accessSuspended)throw Error('BILLING_ACCESS_HELD');
  const binding=await tx.dashboardBillingBinding.findUnique({where:{workspaceId}});
  if(binding)await terminalSubscription(tx,workspaceId,read);else if(subscription?.status==='ACTIVE'&&subscription.currentPeriodEnd&&subscription.currentPeriodEnd>new Date())throw Error('BILLING_SUBSCRIPTION_EXISTS');
  const plan=await tx.dashboardBillingPlan.findUnique({where:{code:p.data.planCode}});if(!eligible(plan))throw Error('BILLING_PLAN_UNAVAILABLE');await validatePrice(plan,transport,config.live);
  const customer=await tx.dashboardBillingCustomer.findUnique({where:{workspaceId_provider:{workspaceId,provider:'STRIPE'}}}),attemptId=randomUUID(),expires=Math.floor(Date.now()/1000)+3600,url=returnUrl(config.origin,workspaceId);
  const request:Record<string,string>={mode:'subscription',client_reference_id:attemptId,'metadata[dashboardProduct]':'averidi-dashboard','metadata[dashboardCheckoutAttemptId]':attemptId,'subscription_data[metadata][dashboardProduct]':'averidi-dashboard','subscription_data[metadata][dashboardWorkspaceId]':workspaceId,'line_items[0][price]':plan.externalPriceId!,'line_items[0][quantity]':'1',success_url:url+'?checkout=returned',cancel_url:url+'?checkout=canceled',expires_at:String(expires),'expand[0]':'line_items',...(customer?{customer:customer.externalCustomerId}:{})};
  await tx.dashboardCheckoutAttempt.create({data:{id:attemptId,workspaceId,planId:plan.id,activeKey:'ACTIVE',request,expiresAt:new Date(expires*1000)}});await audit(tx,actor,workspaceId,'BILLING_CHECKOUT_REQUESTED',attemptId);return attemptId;
 },transactionOptions);
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);await owner(tx,actor,workspaceId);const attempt=await tx.dashboardCheckoutAttempt.findFirstOrThrow({where:{id,workspaceId},include:{plan:true}});
  if(attempt.status==='COMPLETED')return {status:'COMPLETED',url:null};if(attempt.activeKey!=='ACTIVE')throw Error('BILLING_CHECKOUT_CONFLICT');
  if(!eligible(attempt.plan))throw Error('BILLING_PLAN_UNAVAILABLE');if((await tx.dashboardSubscription.findUnique({where:{workspaceId}}))?.accessSuspended)throw Error('BILLING_ACCESS_HELD');
  return applyCheckout(tx,attempt,await currentCheckout(attempt,transport),read);
 },transactionOptions);
}
export async function refreshCustomerBilling(actor:Actor,workspaceId:string,transport:SelfServiceTransport=selfServiceStripeTransport,read:BillingTransport=stripeTransport){
 customerBillingSettings();return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);await owner(tx,actor,workspaceId);const attempt=await tx.dashboardCheckoutAttempt.findUnique({where:{workspaceId_activeKey:{workspaceId,activeKey:'ACTIVE'}}});
  if(attempt){
   if(!attempt.externalSessionId){const plan=await tx.dashboardBillingPlan.findUnique({where:{id:attempt.planId}});if(!eligible(plan))throw Error('BILLING_PLAN_UNAVAILABLE');if((await tx.dashboardSubscription.findUnique({where:{workspaceId}}))?.accessSuspended)throw Error('BILLING_ACCESS_HELD');}
   const result=await applyCheckout(tx,attempt,await currentCheckout(attempt,transport),read);return {...result,url:null};
  }
  if(await tx.dashboardBillingBinding.findUnique({where:{workspaceId}}))await reconcileLocked(tx,workspaceId,actor,read);
  await audit(tx,actor,workspaceId,'BILLING_CUSTOMER_REFRESH',workspaceId);return {status:'REFRESHED',url:null};
 },transactionOptions);
}
export async function cancelCustomerCheckout(actor:Actor,workspaceId:string,transport:SelfServiceTransport=selfServiceStripeTransport,read:BillingTransport=stripeTransport){
 customerBillingSettings();return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);await owner(tx,actor,workspaceId);const attempt=await tx.dashboardCheckoutAttempt.findUnique({where:{workspaceId_activeKey:{workspaceId,activeKey:'ACTIVE'}}});if(!attempt)return {status:'EXPIRED',url:null};
  let snapshot=validateCheckout(attempt,await currentCheckout(attempt,transport),billingConfig().live);
  if(snapshot.status==='open'){
   try{await transport('POST','/checkout/sessions/'+snapshot.id+'/expire',{},'dashboard-expire:'+attempt.id);}catch{/* Completion may race expiration; authoritative retrieval decides the result. */}
   snapshot=validateCheckout(attempt,await transport('GET','/checkout/sessions/'+snapshot.id+'?expand[]=line_items'),billingConfig().live);
   if(snapshot.status==='open')throw Error('BILLING_PROVIDER_UNAVAILABLE');
  }
  const result=await applyCheckout(tx,attempt,snapshot,read);await audit(tx,actor,workspaceId,'BILLING_CHECKOUT_CLOSED',attempt.id);return result;
 },transactionOptions);
}
export async function processCustomerCheckoutEvent(event:{id:string;type:string;data:{object:Record<string,unknown>}},digest:string,transport:SelfServiceTransport,read:BillingTransport){
 // Existing checkout obligations still reconcile when new customer purchases are disabled.
 billingConfig();return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dashboard-billing-event:${event.id}`},0))`;
  const previous=await tx.dashboardBillingEvent.findUnique({where:{id:event.id}});if(previous){if(previous.payloadDigest!==digest)throw Error('BILLING_EVENT_CONFLICT');return {outcome:previous.outcome,duplicate:true};}
  const id=checkoutId.safeParse(event.data.object.id);let attempt=typeof event.data.object.client_reference_id==='string'?await tx.dashboardCheckoutAttempt.findUnique({where:{id:event.data.object.client_reference_id}}):null;
  if(!attempt&&id.success)attempt=await tx.dashboardCheckoutAttempt.findUnique({where:{externalSessionId:id.data}});
  let outcome='IGNORED';if(attempt){if(!id.success)throw Error('INVALID_BILLING_EVENT');await billingLock(tx,attempt.workspaceId);attempt=await tx.dashboardCheckoutAttempt.findUniqueOrThrow({where:{id:attempt.id}});await applyCheckout(tx,attempt,await transport('GET','/checkout/sessions/'+id.data+'?expand[]=line_items'),read);outcome='APPLIED';}
  await tx.dashboardBillingEvent.create({data:{id:event.id,type:event.type,payloadDigest:digest,workspaceId:attempt?.workspaceId,outcome}});return {outcome,duplicate:false};
 },transactionOptions);
}

const portalConfiguration=z.object({id:z.string(),object:z.literal('billing_portal.configuration'),active:z.literal(true),livemode:z.boolean(),application:z.null().optional(),features:z.object({
 payment_method_update:z.object({enabled:z.literal(true)}),invoice_history:z.object({enabled:z.literal(true)}),
 subscription_cancel:z.object({enabled:z.literal(true),mode:z.literal('at_period_end')}),
 subscription_update:z.object({enabled:z.literal(true),default_allowed_updates:z.array(z.literal('price')).length(1),proration_behavior:z.enum(['none','create_prorations','always_invoice']),products:z.array(z.object({product:z.string(),prices:z.array(z.string()).min(1).max(10)})).min(1).max(10)})
})});
export async function openCustomerBillingPortal(actor:Actor,workspaceId:string,transport:SelfServiceTransport=selfServiceStripeTransport){
 const config=customerBillingSettings(),id=process.env.DASHBOARD_BILLING_PORTAL_CONFIGURATION??'';
 if(!/^bpc_[A-Za-z0-9]{1,100}$/.test(id))throw Error('BILLING_PORTAL_UNAVAILABLE');
 await owner(db,actor,workspaceId);
 const raw=portalConfiguration.safeParse(await transport('GET','/billing_portal/configurations/'+id));
 if(!raw.success||raw.data.id!==id||raw.data.livemode!==config.live)throw Error('BILLING_PORTAL_UNAVAILABLE');
 const prices=[...new Set(raw.data.features.subscription_update.products.flatMap(product=>product.prices))];
 if(prices.length>10)throw Error('BILLING_PORTAL_UNAVAILABLE');
 const plans=await db.dashboardBillingPlan.findMany({where:{externalPriceId:{in:prices}}});
 if(prices.some(price=>!plans.some(plan=>plan.externalPriceId===price&&eligible(plan))))throw Error('BILLING_PORTAL_UNAVAILABLE');
 await Promise.all(plans.map(plan=>validatePrice(plan,transport,config.live)));
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);await owner(tx,actor,workspaceId);
  const current=await tx.dashboardBillingPlan.findMany({where:{id:{in:plans.map(plan=>plan.id)}}});
  if(current.length!==plans.length||current.some(plan=>!eligible(plan)))throw Error('BILLING_PORTAL_UNAVAILABLE');
  const binding=await tx.dashboardBillingBinding.findUnique({where:{workspaceId},include:{customer:true}});if(!binding)throw Error('BILLING_BINDING_NOT_FOUND');
  const url=returnUrl(config.origin,workspaceId),result=z.object({id:z.string().regex(/^bps_[A-Za-z0-9]+$/),object:z.literal('billing_portal.session'),customer:z.string(),configuration:z.string(),livemode:z.boolean(),return_url:z.string(),url:z.string()}).safeParse(await transport('POST','/billing_portal/sessions',{customer:binding.customer.externalCustomerId,configuration:id,return_url:url},'dashboard-portal:'+randomUUID()));
  if(!result.success||result.data.customer!==binding.customer.externalCustomerId||result.data.configuration!==id||result.data.livemode!==config.live||result.data.return_url!==url)throw Error('INVALID_BILLING_SNAPSHOT');
  const hosted=hostedBillingUrl(result.data.url,'billing.stripe.com');await audit(tx,actor,workspaceId,'BILLING_PORTAL_OPENED',result.data.id);return {url:hosted};
 },transactionOptions);
}
/** Operator recovery only accepts a provider session whose full immutable checkout request matches the durable reservation. */
export async function recoverCustomerCheckout(workspaceId:string,input:unknown,actor:Pick<Actor,'issuer'|'subject'>,transport:SelfServiceTransport=selfServiceStripeTransport,read:BillingTransport=stripeTransport){
 billingConfig();const parsed=checkoutRecoverySchema.safeParse(input);if(!parsed.success)throw Error('INVALID_BILLING_INPUT');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);const attempt=await tx.dashboardCheckoutAttempt.findFirst({where:{id:parsed.data.attemptId,workspaceId}});if(!attempt)throw Error('NOT_FOUND');
  const result=await applyCheckout(tx,attempt,await transport('GET','/checkout/sessions/'+parsed.data.sessionId+'?expand[]=line_items'),read);
  await tx.dashboardAdminAudit.create({data:{actorIssuer:actor.issuer,actorSubject:actor.subject,action:'BILLING_CHECKOUT_RECOVERED',workspaceId,details:JSON.stringify({attemptId:attempt.id,sessionId:parsed.data.sessionId,status:result.status,reason:parsed.data.reason})}});
  return {status:result.status};
 },transactionOptions);
}
