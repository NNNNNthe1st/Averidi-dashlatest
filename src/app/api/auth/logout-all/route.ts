import {NextResponse} from 'next/server';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {verifyDashboardBrowserSession,revokeAllDashboardSessions} from '../../../../server/browser-session';
import {extractDashboardSessionCookie,DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions} from '../../../../server/session-cookie';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const token=extractDashboardSessionCookie(request);
 const actor=token?await verifyDashboardBrowserSession(token):null;
 if(actor)await revokeAllDashboardSessions(actor);
 const response=NextResponse.json({authenticated:false},{headers});
 response.cookies.set(DASHBOARD_SESSION_COOKIE,'',{...dashboardSessionCookieOptions(),maxAge:0});
 return response;
}
