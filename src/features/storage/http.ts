import {quotaHttpError} from '../quotas/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../server/auth-boundary';
import {dashboardSameOrigin} from '../../server/request-origin';
import {analysisJson} from '../analysis/http';
import {requireStorageOwner} from './lifecycle';
export const storageHeaders={'Cache-Control':'private, no-store'};
export async function storageOwner(request:Request,workspaceId:string,write=false){const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('UNAUTHORIZED');if(write&&!dashboardSameOrigin(request))throw Error('CROSS_ORIGIN_REQUEST');await requireStorageOwner(actor,workspaceId);return actor;}
export async function storageJson(request:Request){try{return await analysisJson(request);}catch{throw Error('INVALID_STORAGE_POLICY');}}
export function storageHttpError(error:unknown){const quota=quotaHttpError(error);if(quota)return quota;const code=error instanceof Error?error.message:'';const status=code==='UNAUTHORIZED'?401:['FORBIDDEN','CROSS_ORIGIN_REQUEST'].includes(code)?403:code==='DATASET_UNAVAILABLE'?404:['INVALID_STORAGE_POLICY','INVALID_JOB_KEY'].includes(code)?400:['STORAGE_POLICY_REQUIRED','STORAGE_LEGAL_HOLD','STORAGE_MAINTENANCE','STORAGE_OBJECT_RETIRED'].includes(code)?409:503;return NextResponse.json({error:status===503?'STORAGE_UNAVAILABLE':code},{status,headers:storageHeaders});}
