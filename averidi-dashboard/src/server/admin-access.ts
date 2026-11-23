import {createRemoteJWKSet,jwtVerify} from "jose";
import {validateDashboardOidcConfig} from "./oidc-config";
import {dashboardDb} from "./db";
import {verifyDashboardAdminBridgeToken} from "./admin-bridge";

import {allowsDashboardAdminPermission,type DashboardAdminPermission} from "./admin-permissions";
/**
 * Separate Dashboard administration boundary. A website admin cookie, a Dashboard
 * workspace-owner role, or a user-provided header is never an admin credential.
 * Only a provider-signed, audience-specific, short-lived admin access JWT works.
 */
export async function authorizeDashboardAdmin(request:Request,required:DashboardAdminPermission){
 const issuer=process.env.DASHBOARD_ADMIN_OIDC_ISSUER;
 const jwksUrl=process.env.DASHBOARD_ADMIN_OIDC_JWKS_URL;
 const audience=process.env.DASHBOARD_ADMIN_OIDC_AUDIENCE;
 const bearer=/^Bearer ([A-Za-z0-9._~-]+)$/.exec(request.headers.get("authorization")??"");
 if(!bearer)return null;
 const bridge=await verifyDashboardAdminBridgeToken(bearer[1],required);
 if(bridge)return bridge;
 if(!issuer||!jwksUrl||!audience)return null;
 let parsed;
 try {parsed=validateDashboardOidcConfig({issuer,jwksUrl,audience});}
 catch{return null;}
 try{
  const result=await jwtVerify(bearer[1],createRemoteJWKSet(new URL(parsed.jwksUrl)),{
   issuer:parsed.issuer,audience:parsed.audience,algorithms:["RS256","ES256","PS256"],
   maxTokenAge:"15m",clockTolerance:"15s",
  });
  const permissions=result.payload.dashboard_permissions;
  if(!allowsDashboardAdminPermission(permissions,required))return null;
  if(typeof result.payload.sub!=="string"||!result.payload.sub)return null;
  if(result.payload.token_use!=="access")return null;
  // The administrative capability must belong to a deliberately issued access token.
  // An ordinary ID token or workspace bearer token is never an admin credential.
  return {issuer:parsed.issuer,subject:result.payload.sub,permissions} as const;
 }catch{return null;}
}
export async function dashboardAdminOverview(){
 const [workspaces,users,datasets,views,jobs,subscriptions,openSupportCases,billingBindings]=await Promise.all([
  dashboardDb.dashboardWorkspace.count(),dashboardDb.dashboardUser.count(),
  dashboardDb.dashboardDataset.count(),dashboardDb.dashboardView.count(),
  dashboardDb.dashboardJob.groupBy({by:["status"],_count:{_all:true}}),
  dashboardDb.dashboardSubscription.groupBy({by:["status"],_count:{_all:true}}),
  dashboardDb.dashboardSupportCase.count({where:{status:{in:["OPEN","IN_PROGRESS"]}}}),
  dashboardDb.dashboardBillingBinding.count(),
 ]);
 return {workspaces,users,datasets,views,openSupportCases,billingBindings,subscriptions:subscriptions.map(x=>({status:x.status,count:x._count._all})),jobs:jobs.map(x=>({status:x.status,count:x._count._all}))};
}
