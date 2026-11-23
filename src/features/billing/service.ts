import {setAuditActor} from '../audit/context';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {billingConfig,bindingSchema,currencies,holdSchema,planSchema,type AdminActor} from './contracts';
import {invoiceSchema,subscriptionSchema,stripeTransport,verifyStripeEvent,type BillingTransport} from './stripe';
export async function billingLock(tx:Prisma.TransactionClient,workspaceId:string){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dashboard-billing:${workspaceId}`},0))`;
}
async function audit(tx:Prisma.TransactionClient,actor:AdminActor,action:string,workspaceId:string|null,details:unknown){
 await tx.dashboardAdminAudit.create({data:{actorIssuer:actor.issuer,actorSubject:actor.subject,action,workspaceId,details:JSON.stringify(details)}});
}
export async function savePlan(input:unknown,actor:AdminActor){
 const parsed=planSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_BILLING_PLAN');
 const value=parsed.data;
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,"plan:"+value.code);
  const previous=await tx.dashboardBillingPlan.findUnique({where:{code:value.code}});
  // A provider price has immutable financial semantics. Retire a code and create a new one to change its mapping.
  if(previous&&[previous.externalPriceId,previous.currency,previous.amountMinor,previous.billingInterval].some((v,i)=>v!==[value.externalPriceId,value.currency,value.amountMinor,value.billingInterval][i]))throw Error('BILLING_PLAN_IMMUTABLE');
  const plan=await tx.dashboardBillingPlan.upsert({where:{code:value.code},create:value,update:value});
  await audit(tx,actor,'ADMIN_BILLING_PLAN',null,{previous,next:plan});return plan;
 });
}
export async function bindBilling(workspaceId:string,input:unknown,actor:AdminActor){
 billingConfig();const parsed=bindingSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_BILLING_BINDING');
 const value=parsed.data;
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);
  if(!await tx.dashboardWorkspace.findUnique({where:{id:workspaceId}}))throw Error('NOT_FOUND');
  const existing=await tx.dashboardBillingBinding.findUnique({where:{workspaceId},include:{customer:true}});
  if(existing){if(existing.externalSubscriptionId!==value.externalSubscriptionId||existing.customer.externalCustomerId!==value.externalCustomerId)throw Error('BILLING_BINDING_CONFLICT');return existing;}
  if(await tx.dashboardCheckoutAttempt.findUnique({where:{workspaceId_activeKey:{workspaceId,activeKey:'ACTIVE'}}}))throw Error('BILLING_CHECKOUT_IN_PROGRESS');
  const customer=await tx.dashboardBillingCustomer.upsert({where:{workspaceId_provider:{workspaceId,provider:'STRIPE'}},create:{workspaceId,provider:'STRIPE',externalCustomerId:value.externalCustomerId},update:{}});
  if(customer.externalCustomerId!==value.externalCustomerId)throw Error('BILLING_BINDING_CONFLICT');
  const binding=await tx.dashboardBillingBinding.create({data:{workspaceId,customerId:customer.id,externalSubscriptionId:value.externalSubscriptionId}});
  // Linking an ID alone never grants access; only a validated provider reconciliation can do so.
  await tx.dashboardSubscription.upsert({where:{workspaceId},create:{workspaceId,planCode:'UNMAPPED',status:'INACTIVE'},update:{status:'INACTIVE',currentPeriodEnd:null,billingPlanId:null}});
  await audit(tx,actor,'ADMIN_BILLING_BINDING',workspaceId,{externalSubscriptionId:value.externalSubscriptionId,reason:value.reason});return binding;
 });
}
export async function setBillingHold(workspaceId:string,input:unknown,actor:AdminActor){
 const parsed=holdSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_BILLING_HOLD');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);
  const previous=await tx.dashboardSubscription.findUnique({where:{workspaceId}});if(!previous)throw Error('NOT_FOUND');
  await tx.dashboardSubscription.update({where:{workspaceId},data:{accessSuspended:parsed.data.accessSuspended}});
  await audit(tx,actor,'ADMIN_SUBSCRIPTION_HOLD',workspaceId,{previous:previous.accessSuspended,...parsed.data});return {accessSuspended:parsed.data.accessSuspended};
 });
}
const systemActor={issuer:'dashboard:billing:stripe',subject:'verified-provider'};
/** Lock first, then retrieve authoritative current state. Never order by event timestamps. */
export async function reconcileLocked(tx:Prisma.TransactionClient,workspaceId:string,actor:AdminActor,transport:BillingTransport,invoiceId?:string){
 const config=billingConfig();
 const binding=await tx.dashboardBillingBinding.findUnique({where:{workspaceId},include:{customer:true}});if(!binding)throw Error('BILLING_BINDING_NOT_FOUND');
 const parsed=subscriptionSchema.safeParse(await transport('/subscriptions/'+binding.externalSubscriptionId));if(!parsed.success)throw Error('INVALID_BILLING_SNAPSHOT');
 const remote=parsed.data,item=remote.items.data[0];
 if(remote.id!==binding.externalSubscriptionId||remote.customer!==binding.customer.externalCustomerId||remote.livemode!==config.live)throw Error('BILLING_ACCOUNT_MISMATCH');
 const plan=await tx.dashboardBillingPlan.findUnique({where:{externalPriceId:item.price.id}});
 const matches=!!plan&&plan.currency===item.price.currency.toUpperCase()&&plan.amountMinor===item.price.unit_amount&&plan.billingInterval===item.price.recurring.interval;
 const enabled=matches&&plan.active&&(plan.entitlements as {dashboardAccess?:boolean}|null)?.dashboardAccess===true;
 const status=!enabled?'INACTIVE':remote.status==='active'&&!remote.pause_collection?'ACTIVE':['past_due','unpaid'].includes(remote.status)?'PAST_DUE':remote.status==='canceled'?'CANCELED':'INACTIVE';
 const data={planCode:matches?plan.code:'UNMAPPED',billingPlanId:matches?plan.id:null,status,currentPeriodEnd:new Date(item.current_period_end*1000)};
 const previous=await tx.dashboardSubscription.findUnique({where:{workspaceId}});
 const record=await tx.dashboardSubscription.upsert({where:{workspaceId},create:{workspaceId,...data},update:data});
 const invoices=[...new Set([invoiceId,remote.latest_invoice].filter((x):x is string=>!!x))];
 for(const id of invoices){
  const parsedInvoice=invoiceSchema.safeParse(await transport('/invoices/'+id));if(!parsedInvoice.success)throw Error('INVALID_BILLING_SNAPSHOT');
  const inv=parsedInvoice.data,currency=inv.currency.toUpperCase() as keyof typeof currencies;
  if(inv.id!==id||inv.customer!==remote.customer||inv.parent.subscription_details.subscription!==remote.id||inv.livemode!==config.live||!(currency in currencies))throw Error('BILLING_ACCOUNT_MISMATCH');
  const old=await tx.dashboardInvoice.findUnique({where:{provider_externalInvoiceId:{provider:'STRIPE',externalInvoiceId:id}}});
  if(old&&(old.workspaceId!==workspaceId||old.customerId!==binding.customerId||old.subscriptionId!==record.id))throw Error('BILLING_ACCOUNT_MISMATCH');
  const fields={currency,amount:new Prisma.Decimal(inv.total).div(new Prisma.Decimal(10).pow(currencies[currency])),status:inv.status.toUpperCase(),periodStart:new Date(inv.period_start*1000),periodEnd:new Date(inv.period_end*1000),paidAt:inv.status_transitions.paid_at===null?null:new Date(inv.status_transitions.paid_at*1000)};
  await tx.dashboardInvoice.upsert({where:{provider_externalInvoiceId:{provider:'STRIPE',externalInvoiceId:id}},create:{...fields,workspaceId,provider:'STRIPE',externalInvoiceId:id,subscriptionId:record.id,customerId:binding.customerId},update:fields});
 }
 await tx.dashboardBillingBinding.update({where:{workspaceId},data:{cancelAtPeriodEnd:remote.cancel_at_period_end,providerStatus:remote.status,reconciledAt:new Date()}});
 await audit(tx,actor,'BILLING_RECONCILED',workspaceId,{previous:previous?{status:previous.status,planCode:previous.planCode,currentPeriodEnd:previous.currentPeriodEnd}:null,next:data,cancelAtPeriodEnd:remote.cancel_at_period_end,reason:enabled?'PROVIDER_STATE':'PLAN_UNAVAILABLE'});
 return {subscription:record,cancelAtPeriodEnd:remote.cancel_at_period_end};
}
export async function reconcileBilling(workspaceId:string,actor:AdminActor,transport:BillingTransport=stripeTransport){
 billingConfig();return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await billingLock(tx,workspaceId);return reconcileLocked(tx,workspaceId,actor,transport);},{timeout:25000,maxWait:10000});
}
export async function processBillingWebhook(raw:Buffer,signature:string,transport:BillingTransport=stripeTransport,checkoutTransport?:import('./self-service-provider').SelfServiceTransport){
 const config=billingConfig(),event=verifyStripeEvent(raw,signature,config.secret);
 if(event.livemode!==config.live||event.account)throw Error('BILLING_ACCOUNT_MISMATCH');
 const digest=createHash('sha256').update(raw).digest('hex');
 if(['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(event.type)){
  const {processCustomerCheckoutEvent}=await import('./self-service');
  const {selfServiceStripeTransport}=await import('./self-service-provider');
  return processCustomerCheckoutEvent(event,digest,checkoutTransport??selfServiceStripeTransport,transport);
 }
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dashboard-billing-event:${event.id}`},0))`;
  const previous=await tx.dashboardBillingEvent.findUnique({where:{id:event.id}});
  if(previous){if(previous.payloadDigest!==digest)throw Error('BILLING_EVENT_CONFLICT');return {outcome:previous.outcome,duplicate:true};}
  const subscriptionEvent=['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed'].includes(event.type);
  const invoiceEvent=['invoice.paid','invoice.payment_failed','invoice.updated','invoice.voided','invoice.marked_uncollectible','invoice.finalized'].includes(event.type);
  const obj=event.data.object;
  let externalSubscriptionId:unknown=subscriptionEvent?obj.id:null;
  if(invoiceEvent){const parent=obj.parent as {type?:unknown;subscription_details?:{subscription?:unknown}}|undefined;externalSubscriptionId=parent?.type==='subscription_details'?parent.subscription_details?.subscription:null;}
  const binding=typeof externalSubscriptionId==='string'?await tx.dashboardBillingBinding.findUnique({where:{externalSubscriptionId}}):null;
  let outcome='IGNORED';
  if(binding){
   await billingLock(tx,binding.workspaceId);
   if(invoiceEvent&&(typeof obj.id!=='string'||!/^in_[A-Za-z0-9]{1,100}$/.test(obj.id)))throw Error('INVALID_BILLING_EVENT');
   await reconcileLocked(tx,binding.workspaceId,systemActor,transport,invoiceEvent?obj.id as string:undefined);outcome='APPLIED';
  }
  await tx.dashboardBillingEvent.create({data:{id:event.id,type:event.type,payloadDigest:digest,workspaceId:binding?.workspaceId,outcome}});
  return {outcome,duplicate:false};
 },{timeout:25000,maxWait:10000});
}
