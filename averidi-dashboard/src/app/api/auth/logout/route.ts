import {dashboardSameOrigin} from "../../../../server/request-origin";
import { NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions,extractDashboardSessionCookie } from "../../../../server/session-cookie";

import { revokeDashboardBrowserSession } from "../../../../server/browser-session";

export async function POST(request:Request) {
  if(!dashboardSameOrigin(request))
    return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const token=extractDashboardSessionCookie(request);
  if(token)await revokeDashboardBrowserSession(token);
  const response=NextResponse.json({authenticated:false},{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(DASHBOARD_SESSION_COOKIE,"",{...dashboardSessionCookieOptions(),maxAge:0});
  response.cookies.set("__Host-averidi-dashboard","",{secure:true,httpOnly:true,sameSite:"lax",path:"/",maxAge:0});
  return response;
}
