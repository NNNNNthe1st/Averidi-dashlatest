import {NextResponse} from 'next/server';
import {decodeJwt} from 'jose';
import {getAuthenticatedDashboardActor} from '../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../server/request-origin';
import {DASHBOARD_SESSION_COOKIE,extractDashboardSessionCookie,dashboardSessionCookieOptions} from '../../../server/session-cookie';
import {analysisJson} from '../../../features/analysis/http';
import {headers,accountError} from '../../../features/organizations/http';
import {readAccount,updateAccount} from '../../../features/account/service';
// Only inspect the session id after the full signature, issuer and live-state boundary succeeds.
function sessionId(request:Request){const token=extractDashboardSessionCookie(request);return token?decodeJwt(token).jti:undefined;}
export async function GET(request:Request){const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{return NextResponse.json(await readAccount(actor,sessionId(request)),{headers});}catch(error){return accountError(error);}}
export async function POST(request:Request){if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{
 const input=await analysisJson(request);const current=sessionId(request);const result=await updateAccount(actor,input);const signedOut=!!current&&typeof input==='object'&&input!==null&&'action' in input&&input.action==='REVOKE_SESSION'&&'id' in input&&input.id===current;
 const response=NextResponse.json({...result,signedOut},{headers});if(signedOut)response.cookies.set(DASHBOARD_SESSION_COOKIE,'',{...dashboardSessionCookieOptions(),maxAge:0});return response;
}catch(error){return accountError(error);}}
