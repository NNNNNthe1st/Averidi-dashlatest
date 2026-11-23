import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../server/db';
import {dashboardSameOrigin} from '../../../../server/request-origin';
import {normalizeEmail,validEmail,verifyPassword,rateLimit} from '../../../../server/local-credentials';
import {issueDashboardBrowserSession} from '../../../../server/browser-session';
import {DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions} from '../../../../server/session-cookie';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403,headers});
 try{
 const body=await request.json(),email=normalizeEmail(body.email),password=body.password;
 if(!validEmail(email)||typeof password!=='string'||password.length>128)return NextResponse.json({error:'INVALID_CREDENTIALS'},{status:401,headers});
 if(!await rateLimit(request,'login',email,8))return NextResponse.json({error:'RATE_LIMITED'},{status:429,headers});
 const user=await dashboardDb.dashboardUser.findUnique({where:{email},select:{id:true,passwordHash:true,emailVerifiedAt:true,erasureRequestedAt:true}});
 if(!user?.passwordHash||!await verifyPassword(password,user.passwordHash))return NextResponse.json({error:'INVALID_CREDENTIALS'},{status:401,headers});
 if(!user.emailVerifiedAt||user.erasureRequestedAt)return NextResponse.json({error:'ACCOUNT_NOT_VERIFIED'},{status:403,headers});
 const token=await issueDashboardBrowserSession({userId:user.id,issuer:'dashboard-local',subject:user.id});
 const response=NextResponse.json({ok:true,redirect:'/dashboard/app/workspaces'},{headers});response.cookies.set(DASHBOARD_SESSION_COOKIE,token,dashboardSessionCookieOptions());return response;
 }catch{return NextResponse.json({error:'LOGIN_UNAVAILABLE'},{status:503,headers});}
}