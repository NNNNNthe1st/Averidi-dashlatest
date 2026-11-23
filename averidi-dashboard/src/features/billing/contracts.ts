import {z} from 'zod';
import {quotaSchema} from '../quotas/contracts';
export type AdminActor={issuer:string;subject:string};
export const currencies={USD:2,EUR:2,GBP:2,JPY:0,CAD:2,AUD:2,CHF:2,NZD:2,SGD:2,HKD:2,AED:2,SAR:2,INR:2,KWD:3,BHD:3} as const;
export const planSchema=z.object({
 code:z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),name:z.string().trim().min(2).max(100),
 active:z.boolean(),entitlements:z.object({dashboardAccess:z.boolean(),quotas:quotaSchema.optional()}).strict(),
 externalPriceId:z.string().regex(/^price_[a-zA-Z0-9]{1,100}$/).nullable(),
 currency:z.enum(Object.keys(currencies) as [keyof typeof currencies,...(keyof typeof currencies)[]]).nullable(),
 amountMinor:z.number().int().min(0).max(2147483647).nullable(),billingInterval:z.enum(['month','year']).nullable(),
}).strict().superRefine((v,c)=>{
 const values=[v.externalPriceId,v.currency,v.amountMinor,v.billingInterval];
 if(values.some(x=>x!==null)&&values.some(x=>x===null))c.addIssue({code:'custom',message:'Price mapping must be complete'});
});
export const bindingSchema=z.object({externalCustomerId:z.string().regex(/^cus_[a-zA-Z0-9]{1,100}$/),externalSubscriptionId:z.string().regex(/^sub_[a-zA-Z0-9]{1,100}$/),reason:z.string().trim().min(8).max(500)}).strict();
export const holdSchema=z.object({accessSuspended:z.boolean(),reason:z.string().trim().min(8).max(500)}).strict();
export function billingConfig(env:Partial<NodeJS.ProcessEnv>=process.env){
 if(env.DASHBOARD_BILLING_ENABLED!=='true')throw Error('BILLING_DISABLED');
 const key=env.DASHBOARD_BILLING_STRIPE_SECRET_KEY??'',secret=env.DASHBOARD_BILLING_STRIPE_WEBHOOK_SECRET??'';
 const live=env.DASHBOARD_BILLING_STRIPE_MODE==='live';
 if(!['test','live'].includes(env.DASHBOARD_BILLING_STRIPE_MODE??'')||!new RegExp(`^(?:sk|rk)_${live?'live':'test'}_[A-Za-z0-9]{8,}$`).test(key)||!/^whsec_[A-Za-z0-9]{16,}$/.test(secret))throw Error('BILLING_NOT_CONFIGURED');
 return {key,secret,live};
}

export const checkoutId=z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{1,200}$/);
export const checkoutRecoverySchema=z.object({attemptId:z.string().uuid(),sessionId:checkoutId,reason:z.string().trim().min(8).max(500)}).strict();
