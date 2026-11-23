import {dashboardSameOrigin} from "../../../../server/request-origin";
import { NextResponse } from "next/server";
import { dashboardOidcProvider } from "../../../../server/oidc-identity";
import { issueDashboardBrowserSession } from "../../../../server/browser-session";
import { DASHBOARD_SESSION_COOKIE,dashboardSessionCookieOptions } from "../../../../server/session-cookie";

export async function POST(request:Request) {
  if(request.headers.has("cookie")&&!dashboardSameOrigin(request))
    return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const issuer=process.env.DASHBOARD_OIDC_ISSUER;
  const audience=process.env.DASHBOARD_OIDC_AUDIENCE;
  const jwksUrl=process.env.DASHBOARD_OIDC_JWKS_URL;
  if(!issuer||!audience||!jwksUrl)return NextResponse.json({error:"AUTH_NOT_CONFIGURED"},{status:503,headers:{"Cache-Control":"no-store"}});
  // A bearer token is required: never create a browser session from user-supplied profile JSON.
  if(!request.headers.get("authorization")?.startsWith("Bearer "))
    return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
  let actor;
  try {actor=await dashboardOidcProvider({issuer,audience,jwksUrl}).getVerifiedActor(request);}
  catch {return NextResponse.json({error:"AUTH_CONFIGURATION_INVALID"},{status:503,headers:{"Cache-Control":"no-store"}});}
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
  const token=await issueDashboardBrowserSession(actor);
  const response=NextResponse.json({authenticated:true},{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(DASHBOARD_SESSION_COOKIE,token,dashboardSessionCookieOptions());
  return response;
}
