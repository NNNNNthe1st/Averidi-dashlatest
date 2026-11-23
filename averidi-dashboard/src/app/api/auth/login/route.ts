import {NextResponse} from "next/server";
import {beginDashboardLogin,OIDC_PENDING_COOKIE} from "../../../../server/oidc-browser";
import {DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions} from "../../../../server/session-cookie";
export async function GET(request:Request){
 try{
  const {url,pending}=await beginDashboardLogin();
  const response=NextResponse.redirect(url,{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(OIDC_PENDING_COOKIE,pending,{secure:true,httpOnly:true,sameSite:"lax",path:"/dashboard/app/api/auth",maxAge:300});
  // Clear the active session at its current path and the legacy root path.
  response.cookies.set(DASHBOARD_SESSION_COOKIE,"",{...dashboardSessionCookieOptions(),maxAge:0});
  response.cookies.set(DASHBOARD_SESSION_COOKIE,"",{secure:true,httpOnly:true,sameSite:"lax",path:"/",maxAge:0});
  // Clear legacy cookies from earlier session implementations.
  response.cookies.set("__Host-averidi-dashboard","",{secure:true,httpOnly:true,sameSite:"lax",path:"/",maxAge:0});
  response.cookies.set("__Host-dashboard-oidc-pending","",{secure:true,httpOnly:true,sameSite:"lax",path:"/",maxAge:0});
  return response;
 }catch{return NextResponse.json({error:"AUTH_NOT_CONFIGURED"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
