import {z} from 'zod';
import {billingConfig,checkoutId} from './contracts';
export {checkoutId} from './contracts';
import {stripeVersion} from './stripe';
export type SelfServiceTransport=(method:'GET'|'POST',path:string,fields?:Record<string,string>,idempotencyKey?:string)=>Promise<unknown>;
export const providerPrice=z.object({id:z.string(),object:z.literal('price'),active:z.boolean(),livemode:z.boolean(),currency:z.string(),unit_amount:z.number().int().nonnegative(),billing_scheme:z.literal('per_unit'),type:z.literal('recurring'),transform_quantity:z.null().optional(),custom_unit_amount:z.null().optional(),recurring:z.object({interval:z.enum(['month','year']),interval_count:z.literal(1),usage_type:z.literal('licensed'),trial_period_days:z.null().optional()})});
export const checkoutSnapshot=z.object({
 id:checkoutId,object:z.literal('checkout.session'),livemode:z.boolean(),mode:z.literal('subscription'),status:z.enum(['open','complete','expired']),
 client_reference_id:z.string(),metadata:z.object({dashboardProduct:z.literal('averidi-dashboard'),dashboardCheckoutAttemptId:z.string()}),
 customer:z.string().regex(/^cus_[A-Za-z0-9]{1,100}$/).nullable(),subscription:z.string().regex(/^sub_[A-Za-z0-9]{1,100}$/).nullable(),
 expires_at:z.number().int().positive(),success_url:z.string(),cancel_url:z.string(),url:z.string().nullable(),
 line_items:z.object({has_more:z.literal(false),data:z.array(z.object({quantity:z.literal(1),price:z.object({id:z.string()})})).length(1)}),
});
export function hostedBillingUrl(value:string,host:'checkout.stripe.com'|'billing.stripe.com'){
 let url:URL;try{url=new URL(value);}catch{throw Error('INVALID_BILLING_SNAPSHOT');}
 if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password)throw Error('INVALID_BILLING_SNAPSHOT');return url.toString();
}
/** The existing dedicated billing account and pinned API version; never accepts arbitrary origins. */
export const selfServiceStripeTransport:SelfServiceTransport=async(method,path,fields,key)=>{
 const session='cs_(?:test|live)_[A-Za-z0-9]{1,200}';
 const read=new RegExp('^/(?:prices/price_[A-Za-z0-9]{1,100}|billing_portal/configurations/bpc_[A-Za-z0-9]{1,100}|checkout/sessions/'+session+'\\?expand\\[\\]=line_items)$');
 const write=new RegExp('^/(?:checkout/sessions|checkout/sessions/'+session+'/expire|billing_portal/sessions)$');
 if(method==='GET'?!read.test(path)||fields!==undefined||key!==undefined:!write.test(path)||!fields||!key||!/^dashboard-[a-z]+:[A-Za-z0-9-]{10,100}$/.test(key))throw Error('INVALID_BILLING_RESOURCE');
 const config=billingConfig();
 try{
  const response=await fetch('https://api.stripe.com/v1'+path,{method,headers:{Authorization:'Bearer '+config.key,'Stripe-Version':stripeVersion,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key!}:{})},...(method==='POST'?{body:new URLSearchParams(fields)}:{}),redirect:'error',signal:AbortSignal.timeout(5000),cache:'no-store'});
  if(!response.ok)throw Error('BILLING_PROVIDER_UNAVAILABLE');const reader=response.body?.getReader();if(!reader)throw Error('BILLING_PROVIDER_UNAVAILABLE');const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024*1024){await reader.cancel();throw Error('BILLING_PROVIDER_UNAVAILABLE');}parts.push(part.value);}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
 }catch{throw Error('BILLING_PROVIDER_UNAVAILABLE');}
};
