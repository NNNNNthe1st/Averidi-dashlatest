export const DASHBOARD_SESSION_COOKIE = "__Secure-averidi-dashboard";
export function dashboardSessionCookieOptions() {
  return {httpOnly:true as const,secure:true as const,sameSite:"lax" as const,path:"/dashboard/app",maxAge:1800};
}
/** Presence is separate from validity: a malformed cookie must never enable bearer fallback. */
export function hasDashboardSessionCookie(request:Request):boolean {
  return (request.headers.get("cookie")??"").split(";").some(part=>part.trim().split("=",1)[0]===DASHBOARD_SESSION_COOKIE);
}
export function extractSingleDashboardCookie(request:Request,name:string,maxLength=4096):string|null {
  const matches=(request.headers.get("cookie")??"").split(";").map(part=>part.trim()).filter(part=>part.split("=",1)[0]===name);
  if(matches.length!==1||!matches[0].startsWith(name+"="))return null;
  const value=matches[0].slice(name.length+1);
  return value.length<=maxLength&&/^[A-Za-z0-9._~-]+$/.test(value)?value:null;
}
export function extractDashboardSessionCookie(request:Request):string|null {
  return extractSingleDashboardCookie(request,DASHBOARD_SESSION_COOKIE);
}
