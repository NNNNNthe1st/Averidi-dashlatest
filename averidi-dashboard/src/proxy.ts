import { NextResponse, type NextRequest } from "next/server";
import {checkDashboardRequestRate} from "./server/rate-limit";
import { dashboardReleaseConfig, isDashboardWorkspaceReleased } from "./server/release-gate";

/** Gate at the HTTP boundary, not merely by hiding UI controls. */
function releaseResponse(request:NextRequest) {
  let config;
  try {config=dashboardReleaseConfig();}
  catch {return NextResponse.json({error:"RELEASE_CONFIGURATION_INVALID"},{status:503});}
  const pathname=request.nextUrl.pathname.replace(/^\/dashboard\/app(?=\/|$)/,"");
  if(pathname==="/api/health"||pathname==="/api/health/ready")return NextResponse.next();
  // Public demo accepts only fictional built-in rows and never reads customer state.
  if(pathname==="/demo"&&["GET","HEAD"].includes(request.method))return NextResponse.next();
  if(pathname==="/api/demo/sales"&&request.method==="POST")return NextResponse.next();
  // Public product landing page remains previewable before Dashboard release.
  if(pathname==="/product"&&["GET","HEAD"].includes(request.method))return NextResponse.next();
  // Independent admin API enforces its own signed admin-token authorization.
  // Operational monitoring must remain reachable when customer release is OFF.
  if(pathname.startsWith("/api/admin/v1/"))return NextResponse.next();
  // Discovery has no customer data; resource handlers independently deny while inactive.
  if(pathname.startsWith("/api/integrations/v1/"))return NextResponse.next();
  // Provider verification and its separate OFF-by-default flag remain mandatory.
  if(pathname==="/api/billing/stripe/webhook"&&request.method==="POST")return NextResponse.next();
  if((pathname==="/account-erasure"||/^\/api\/account-erasure\/[a-f0-9-]{36}$/.test(pathname))&&["GET","POST"].includes(request.method))return NextResponse.next();
  if(pathname==="/signed-out" && request.method==="GET")return NextResponse.next();
  // Logout must remain possible even while the feature is disabled.
  if(pathname==="/api/auth/logout"||pathname==="/api/auth/logout-all")return NextResponse.next();
  if(pathname==="/api/custom-source-oauth/callback"&&request.method==="GET"&&config.mode!=="OFF")return NextResponse.next();
  if(pathname==="/api/connectors/callback"&&request.method==="GET"&&config.mode!=="OFF")return NextResponse.next();
  // Token exchange must be reachable by an already-allowlisted identity.
  // Authorization is verified by the session API; its availability is not entitlement.
  if((pathname==="/api/auth/refresh" || pathname==="/api/auth/session" || pathname==="/api/auth/me" || pathname==="/api/auth/login" || pathname==="/api/auth/callback") && config.mode!=="OFF")return NextResponse.next();
  // Credential handlers remain responsible for origin, validation and email checks.
  // Allow authentication in BETA without releasing any additional workspace.
  if(config.mode!=="OFF" && ["/api/auth/signup","/api/auth/password-login","/api/auth/verify","/api/auth/resend-verification","/api/auth/password-reset"].includes(pathname) && request.method==="POST")return NextResponse.next();
  if(config.mode==="OFF")return NextResponse.json({error:"DASHBOARD_NOT_RELEASED"},{status:503});
  if(config.mode==="BETA") {
    if(["/","/studio","/workspaces","/organizations","/settings","/settings/erase","/activity"].includes(pathname) && request.method==="GET")return NextResponse.next();
    if(pathname==="/api/workspaces" && request.method==="GET")return NextResponse.next();
    if(pathname==="/api/invitations/accept" && request.method==="POST")return NextResponse.next();
    // Authenticated organization metadata has no implicit workspace entitlement.
    if(pathname==="/api/account/erasure" && ["GET","POST"].includes(request.method))return NextResponse.next();
    if(pathname==="/api/account/activity" && request.method==="GET")return NextResponse.next();
    if(pathname==="/api/account" || pathname==="/api/organizations" || /^\/api\/organizations\/[^/]+$/.test(pathname) || pathname==="/api/organization-invitations/accept")return NextResponse.next();
    const match=/^\/(?:api\/)?workspaces\/([^/]+)/.exec(pathname);
    if(!match || !isDashboardWorkspaceReleased(safeDecode(match[1]),config))
      return NextResponse.json({error:"DASHBOARD_BETA_RESTRICTED"},{status:403});
  }
  return NextResponse.next();
}
/** Release denial stays authoritative; allowed APIs then share a cross-process request budget. */
export async function proxy(request:NextRequest) {
 const response=releaseResponse(request);
 if(response.headers.get('x-middleware-next')!=='1')return response;
 const pathname=request.nextUrl.pathname.replace(/^\/dashboard\/app(?=\/|$)/,'');
 try {
  const result=await checkDashboardRequestRate(request,pathname);if(!result)return response;
  const headers={'Cache-Control':'no-store','X-RateLimit-Limit':String(result.limit),'X-RateLimit-Remaining':String(result.remaining),'X-RateLimit-Reset':String(result.reset)};
  if(!result.allowed)return NextResponse.json({error:'RATE_LIMITED'},{status:429,headers:{...headers,'Retry-After':String(result.retryAfter)}});
  for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
  return response;
 }catch {
  // A missing migration, bad configuration or store outage must not silently disable protection.
  return NextResponse.json({error:'REQUEST_PROTECTION_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
 }
}
function safeDecode(value:string):string {
  try {return decodeURIComponent(value);} catch{return "";}
}
export const config={matcher:["/","/demo","/studio/:path*","/organizations/:path*","/settings/:path*","/activity","/account-erasure","/workspaces/:path*","/api/:path*"]};
