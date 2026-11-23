import {quotaHttpError} from '../quotas/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../server/auth-boundary';
import {dashboardSameOrigin} from '../../server/request-origin';
export const headers={'Cache-Control':'private, no-store'};
export async function dataActor(request:Request,write=false){if(write&&!dashboardSameOrigin(request))throw Error('FORBIDDEN');const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('FORBIDDEN');return actor;}
export function dataError(e:unknown){const quota=quotaHttpError(e);if(quota)return quota;const message=e instanceof Error?e.message:'';const forbidden=message==='FORBIDDEN',notFound=['NOT_FOUND','DATASET_UNAVAILABLE'].includes(message),conflict=['VERSION_CONFLICT','SUPERSEDED_ANALYSIS','RELATIONSHIP_CONFLICT','QUALITY_CONFLICT','IDEMPOTENCY_CONFLICT'].includes(message),invalid=['RELATIONSHIP_LIMIT','INVALID_RELATIONSHIP','RELATIONSHIP_CARDINALITY','JOIN_LIMIT_EXCEEDED','EMPTY_JOIN','INVALID_QUALITY_REVIEW','QUALITY_VERIFICATION_REQUIRED','INVALID_QUERY','INVALID_JOB_PAYLOAD'].includes(message);const status=forbidden?403:message==='SUBSCRIPTION_REQUIRED'?402:notFound?404:conflict?409:invalid?422:503;return NextResponse.json({error:status===503?'DATA_WORKFLOW_UNAVAILABLE':message},{status,headers});}
