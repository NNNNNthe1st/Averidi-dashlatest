import {quotaHttpError} from '../quotas/http';
import {NextResponse} from 'next/server';
import {Prisma} from '@prisma/client';
import {authorizeDashboardAdmin} from '../../server/admin-access';
import {analysisJson} from '../analysis/http';
export const billingHeaders={'Cache-Control':'private, no-store'};
export function billingJson(value:unknown,status=200){return NextResponse.json(value,{status,headers:billingHeaders});}
export async function billingAdmin(request:Request,write=false){
 const actor=await authorizeDashboardAdmin(request,write?'dashboard:manage':'dashboard:read');if(!actor)throw Error('FORBIDDEN');
 const origin=request.headers.get('origin');if(write&&origin&&origin!==new URL(request.url).origin)throw Error('FORBIDDEN');return actor;
}
export async function billingBody(request:Request){try{return await analysisJson(request);}catch{throw Error('INVALID_BILLING_INPUT');}}
export async function rawBillingBody(request:Request){
 const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BILLING_EVENT');
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024*1024){await reader.cancel();throw Error('INVALID_BILLING_EVENT');}chunks.push(part.value);}}finally{reader.releaseLock();}return Buffer.concat(chunks);
}
export function billingError(error:unknown){const quota=quotaHttpError(error);if(quota)return quota;
 if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2003'].includes(error.code))return billingJson({error:'BILLING_CONFLICT'},409);
 const code=error instanceof Error?error.message:'';
 const status=code==='FORBIDDEN'||code==='SUPPORT_DISABLED'?403:code==='SUPPORT_LIMIT'?429:code==='NOT_FOUND'||code==='BILLING_BINDING_NOT_FOUND'?404:code.startsWith('INVALID_BILLING_')?400:['CONFIGURATION_CONFLICT','BILLING_EVENT_CONFLICT','BILLING_BINDING_CONFLICT','BILLING_PLAN_IMMUTABLE','SUPPORT_CASE_CONFLICT','BILLING_CHECKOUT_CONFLICT','BILLING_CHECKOUT_IN_PROGRESS','BILLING_CHECKOUT_RECOVERY_REQUIRED','BILLING_SUBSCRIPTION_EXISTS','BILLING_PLAN_UNAVAILABLE','BILLING_ACCESS_HELD','BILLING_PORTAL_UNAVAILABLE'].includes(code)?409:code==='BILLING_DISABLED'?503:503;
 const safe=status===503?(code==='BILLING_DISABLED'?code:'BILLING_UNAVAILABLE'):code;
 return billingJson({error:safe},status);
}
