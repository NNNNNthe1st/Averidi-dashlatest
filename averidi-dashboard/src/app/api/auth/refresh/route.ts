import {NextResponse} from 'next/server';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {rotateDashboardBrowserSession} from '../../../../server/browser-session';
import {extractDashboardSessionCookie,DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions} from '../../../../server/session-cookie';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const old=extractDashboardSessionCookie(request);
 let token:string|null=null;
 try{
  token=old?await rotateDashboardBrowserSession(old):null;
 }catch{
  // A database or session-service failure is not evidence that credentials are invalid.
  return NextResponse.json({error:'AUTH_SERVICE_UNAVAILABLE'},{status:503,headers});
 }
 const response=NextResponse.json({authenticated:!!token},{status:token?200:401,headers});
 // A failed concurrent refresh must not erase a newer successful Set-Cookie response.
 // Invalid sessions still receive 401; explicit logout is responsible for cookie removal.
 if(token)response.cookies.set(DASHBOARD_SESSION_COOKIE,token,dashboardSessionCookieOptions());
 return response;
}
