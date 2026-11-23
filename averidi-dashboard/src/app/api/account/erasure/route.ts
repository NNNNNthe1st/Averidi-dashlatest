import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {analysisJson} from '../../../../features/analysis/http';
import {requestAccountErasure} from '../../../../features/account-erasure/service';
import {reviewAccountErasure} from '../../../../features/account-erasure/review';
import {erasureHeaders,erasureHttpError} from '../../../../features/account-erasure/http';
import {DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions} from '../../../../server/session-cookie';
export async function GET(request:Request){try{const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('UNAUTHORIZED');return NextResponse.json(await reviewAccountErasure(actor),{headers:erasureHeaders});}catch(e){return erasureHttpError(e);}}
export async function POST(request:Request){try{if(!dashboardSameOrigin(request))throw Error('FORBIDDEN');const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('UNAUTHORIZED');const result=await requestAccountErasure(actor,await analysisJson(request));const response=NextResponse.json(result,{status:202,headers:erasureHeaders});response.cookies.set(DASHBOARD_SESSION_COOKIE,'',{...dashboardSessionCookieOptions(),maxAge:0});return response;}catch(e){return erasureHttpError(e);}}
