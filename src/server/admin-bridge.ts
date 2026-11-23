import {createRemoteJWKSet,jwtVerify} from "jose";
import {adminBridgeClaimsSchema,EXTERNAL_AVERIDI_INTEGRATION_ENABLED} from "../contracts/integration";
import {validateDashboardOidcConfig,type DashboardOidcConfig} from "./oidc-config";
import {allowsDashboardAdminPermission,type DashboardAdminPermission} from "./admin-permissions";

/** Verify short-lived access tokens issued by a future independent website bridge.
 * This module never accepts the website session cookie or shares its session database.
 */
/** Explicitly constructed only by offline conformance fixtures until the integration is authorized. */
export function createDashboardAdminBridgeVerifier(input:DashboardOidcConfig){
 const config=validateDashboardOidcConfig(input),keys=createRemoteJWKSet(new URL(config.jwksUrl));
 return async(token:string,required:DashboardAdminPermission)=>{
  if(token.length>16384)return null;
  try{
   const {payload}=await jwtVerify(token,keys,{issuer:config.issuer,audience:config.audience,algorithms:["RS256","ES256","PS256"],requiredClaims:["iss","aud","sub","iat","exp","jti"],maxTokenAge:"5m",clockTolerance:"10s"});
   const parsed=adminBridgeClaimsSchema.safeParse(payload);
   if(!parsed.success||!allowsDashboardAdminPermission(parsed.data.dashboard_permissions,required))return null;
   return {issuer:config.issuer,subject:parsed.data.sub,permissions:parsed.data.dashboard_permissions};
  }catch{return null;}
 };
}
export async function verifyDashboardAdminBridgeToken(token:string,required:DashboardAdminPermission){
 if(!EXTERNAL_AVERIDI_INTEGRATION_ENABLED||process.env.DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED!=="true"||process.env.DASHBOARD_ADMIN_BRIDGE_ENABLED!=="true")return null;
 try{return await createDashboardAdminBridgeVerifier({issuer:process.env.DASHBOARD_ADMIN_BRIDGE_ISSUER??"",audience:process.env.DASHBOARD_ADMIN_BRIDGE_AUDIENCE??"",jwksUrl:process.env.DASHBOARD_ADMIN_BRIDGE_JWKS_URL??""})(token,required);}catch{return null;}
}
