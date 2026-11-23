import {NextRequest,NextResponse} from "next/server";
import {completeDashboardLogin,OIDC_PENDING_COOKIE,dashboardBrowserOidcSettings} from "../../../../server/oidc-browser";
import {dashboardDb} from "../../../../server/db";
import {issueDashboardBrowserSession} from "../../../../server/browser-session";
import {DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions,extractSingleDashboardCookie} from "../../../../server/session-cookie";
export async function GET(request:NextRequest){
 const state=request.nextUrl.searchParams.get("state")??"";
 const code=request.nextUrl.searchParams.get("code")??"";
 const pending=extractSingleDashboardCookie(request,OIDC_PENDING_COOKIE)??"";
 let identity;
 try{identity=request.nextUrl.searchParams.getAll("state").length===1&&request.nextUrl.searchParams.getAll("code").length===1&&!request.nextUrl.searchParams.has("error")?await completeDashboardLogin(state,code,pending):null;}
 catch {identity=null;}
 if(!identity){
  const response=NextResponse.json({error:"AUTHENTICATION_FAILED"},{status:401,headers:{"Cache-Control":"no-store"}});
  response.cookies.set(OIDC_PENDING_COOKIE,"",{secure:true,httpOnly:true,sameSite:"lax",path:"/dashboard/app/api/auth",maxAge:0});
  return response;
 }
 try{
 const externalSubject=identity.issuer+"|"+identity.subject;
 const user=await dashboardDb.dashboardUser.upsert({where:{externalSubject},create:{externalSubject},update:{},select:{id:true}});
 const token=await issueDashboardBrowserSession({userId:user.id,...identity});
 const response=NextResponse.redirect(new URL("/dashboard/app/workspaces",dashboardBrowserOidcSettings().redirectUrl),{headers:{"Cache-Control":"no-store"}});
 response.cookies.set(OIDC_PENDING_COOKIE,"",{secure:true,httpOnly:true,sameSite:"lax",path:"/dashboard/app/api/auth",maxAge:0});
 response.cookies.set(DASHBOARD_SESSION_COOKIE,token,dashboardSessionCookieOptions());
 return response;
 }catch{
  const response=NextResponse.json({error:"AUTHENTICATION_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});
  response.cookies.set(OIDC_PENDING_COOKIE,"",{secure:true,httpOnly:true,sameSite:"lax",path:"/dashboard/app/api/auth",maxAge:0});
  return response;
 }
}
