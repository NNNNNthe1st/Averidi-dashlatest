import {quotaHttpError} from '../features/quotas/http';
import {NextResponse} from 'next/server';
import {analysisJson} from '../features/analysis/http';
export const workerHeaders={'Cache-Control':'private, no-store'};
export async function workerJson(request:Request){try{return await analysisJson(request);}catch{throw Error('INVALID_JOB_PAYLOAD');}}
export function workerHttpError(error:unknown){const quota=quotaHttpError(error);if(quota)return quota;
 const code=error instanceof Error?error.message:'';
 const invalid=['UNSUPPORTED_JOB_KIND','INVALID_JOB_PAYLOAD','INVALID_JOB_KEY','INVALID_SCHEDULE','INVALID_STORAGE_SCOPE','INVALID_RECIPIENTS'];
 const missing=['NOT_FOUND','DATASET_UNAVAILABLE','REPORT_UNAVAILABLE','DELIVERY_UNAVAILABLE','ALERT_UNAVAILABLE','SCHEDULE_UNAVAILABLE','RECIPIENT_UNAVAILABLE'];
 const status=code==='FORBIDDEN'?403:code==='SUBSCRIPTION_REQUIRED'?402:['IDEMPOTENCY_CONFLICT','RELATIONSHIP_CONFLICT'].includes(code)?409:invalid.includes(code)?400:missing.includes(code)?404:503;
 return NextResponse.json({error:status===503?'QUEUE_UNAVAILABLE':code},{status,headers:workerHeaders});
}
