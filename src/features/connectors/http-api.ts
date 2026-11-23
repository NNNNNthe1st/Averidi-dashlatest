import {quotaHttpError} from '../quotas/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../server/auth-boundary';
import {dashboardSameOrigin} from '../../server/request-origin';
import {analysisJson} from '../analysis/http';
export const connectorHeaders={'Cache-Control':'private, no-store'};
export async function connectorActor(request:Request,write=false){
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('UNAUTHORIZED');
 if(write&&!dashboardSameOrigin(request))throw Error('CROSS_ORIGIN_REQUEST');return actor;
}
export async function connectorJson(request:Request){try{return await analysisJson(request);}catch{throw Error('INVALID_CONNECTOR_CONFIGURATION');}}
export function connectorHttpError(error:unknown){const quota=quotaHttpError(error);if(quota)return quota;
 const code=error instanceof Error?error.message:'';
 const invalid=['INVALID_CONNECTOR_CONFIGURATION','INVALID_CONNECTOR_CREDENTIAL','CONNECTOR_API_AUTH_UNSUPPORTED','CONNECTOR_OAUTH_UNSUPPORTED','INVALID_JOB_KEY','INVALID_JOB_PAYLOAD'];
 const status=code==='UNAUTHORIZED'?401:code==='FORBIDDEN'||code==='CROSS_ORIGIN_REQUEST'?403:code==='SUBSCRIPTION_REQUIRED'?402:code==='CONNECTOR_NOT_FOUND'?404:code==='CONNECTOR_CHANGED'||code==='CONNECTOR_DISCONNECTED'||code==='IDEMPOTENCY_CONFLICT'?409:invalid.includes(code)?400:['CONNECTOR_OAUTH_REJECTED','CONNECTOR_ACCOUNT_MISMATCH'].includes(code)?401:503;
 return NextResponse.json({error:status===503?'CONNECTOR_UNAVAILABLE':code},{status,headers:connectorHeaders});
}
