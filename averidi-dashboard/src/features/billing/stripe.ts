import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {billingConfig} from './contracts';
export const stripeVersion='2025-06-30.basil';
export type BillingTransport=(path:string)=>Promise<unknown>;
const unix=z.number().int().min(0).max(253402300799);
const id=(prefix:string)=>z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`));
export const subscriptionSchema=z.object({
 id:id('sub'),object:z.literal('subscription'),customer:id('cus'),livemode:z.boolean(),
 status:z.enum(['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused']),
 cancel_at_period_end:z.boolean(),pause_collection:z.unknown().nullable().optional(),
 items:z.object({has_more:z.literal(false),data:z.array(z.object({quantity:z.literal(1),current_period_start:unix,current_period_end:unix,
 price:z.object({id:id('price'),currency:z.string().regex(/^[a-z]{3}$/),unit_amount:z.number().int().nonnegative(),
 recurring:z.object({interval:z.enum(['month','year']),interval_count:z.literal(1),usage_type:z.literal('licensed')}),billing_scheme:z.literal('per_unit'),transform_quantity:z.null().optional(),tiers_mode:z.null().optional()})})).length(1)}),
 latest_invoice:z.union([id('in'),z.null()]),
}).refine(v=>v.items.data[0].current_period_end>v.items.data[0].current_period_start);
export const invoiceSchema=z.object({id:id('in'),object:z.literal('invoice'),customer:id('cus'),livemode:z.boolean(),
 currency:z.string().regex(/^[a-z]{3}$/),total:z.number().int().safe(),status:z.enum(['draft','open','paid','uncollectible','void']),
 period_start:unix,period_end:unix,status_transitions:z.object({paid_at:unix.nullable()}),
 parent:z.object({type:z.literal('subscription_details'),subscription_details:z.object({subscription:id('sub')})}),
}).refine(v=>v.period_end>=v.period_start);
export const eventSchema=z.object({id:id('evt'),object:z.literal('event'),type:z.string().min(1).max(120),livemode:z.boolean(),account:z.string().optional(),
 data:z.object({object:z.record(z.string(),z.unknown())})});
export function verifyStripeEvent(raw:Buffer,signature:string,secret:string,now=Date.now()){
 if(raw.length>1024*1024||signature.length>4096)throw Error('INVALID_BILLING_SIGNATURE');
 const parts=signature.split(',').map(x=>x.trim()),timestamps=parts.filter(x=>x.startsWith('t='));
 if(timestamps.length!==1||!/^t=[0-9]{1,12}$/.test(timestamps[0]))throw Error('INVALID_BILLING_SIGNATURE');
 const stamp=timestamps[0].slice(2);
 if(Math.abs(now/1000-Number(stamp))>300)throw Error('INVALID_BILLING_SIGNATURE');
 const expected=createHmac('sha256',secret).update(stamp+'.').update(raw).digest();
 const valid=parts.filter(x=>/^v1=[a-fA-F0-9]{64}$/.test(x)).some(x=>timingSafeEqual(expected,Buffer.from(x.slice(3),'hex')));
 if(!valid)throw Error('INVALID_BILLING_SIGNATURE');
 try{return eventSchema.parse(JSON.parse(raw.toString('utf8')));}catch{throw Error('INVALID_BILLING_EVENT');}
}
/** Separate account billing credential; no Connect headers, arbitrary hosts or redirects. */
export const stripeTransport:BillingTransport=async path=>{
 if(!/^\/(subscriptions\/sub_[A-Za-z0-9]+|invoices\/in_[A-Za-z0-9]+)$/.test(path))throw Error('INVALID_BILLING_RESOURCE');
 const config=billingConfig();
 try{
  const response=await fetch('https://api.stripe.com/v1'+path,{headers:{Authorization:'Bearer '+config.key,'Stripe-Version':stripeVersion},redirect:'error',signal:AbortSignal.timeout(5000),cache:'no-store'});
  if(!response.ok)throw Error('BILLING_PROVIDER_UNAVAILABLE');
  const reader=response.body?.getReader();if(!reader)throw Error('BILLING_PROVIDER_UNAVAILABLE');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1024*1024){await reader.cancel();throw Error('BILLING_PROVIDER_UNAVAILABLE');}chunks.push(part.value);}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
 }catch{throw Error('BILLING_PROVIDER_UNAVAILABLE');}
};
