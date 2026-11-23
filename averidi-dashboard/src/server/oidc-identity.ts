import { createRemoteJWKSet, jwtVerify } from "jose";
import { validateDashboardOidcConfig, type DashboardOidcConfig } from "./oidc-config";
import { resolveVerifiedDashboardActor } from "./workspace-access";
import type { DashboardIdentityProvider } from "./auth-boundary";

export function dashboardOidcProvider(input: DashboardOidcConfig):DashboardIdentityProvider {
  const config=validateDashboardOidcConfig(input);
  const jwksUrl = new URL(config.jwksUrl);
  const keys = createRemoteJWKSet(jwksUrl);
  return {
    async getVerifiedActor(request:Request) {
      const authorization=request.headers.get("authorization");
      const match=/^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization??"");
      if(!match||match[1].length>16384)return null;
      try {
        const {payload}=await jwtVerify(match[1],keys,{
          issuer:config.issuer,audience:config.audience,
          algorithms:["RS256","RS384","RS512","ES256","ES384","ES512","PS256","PS384","PS512"],
          clockTolerance:"30s",requiredClaims:["exp","iss","aud","sub"],
        });
        if(typeof payload.sub!=="string"||!payload.sub.trim()||payload.sub.length>255)return null;
        return resolveVerifiedDashboardActor({issuer:config.issuer,subject:payload.sub});
      } catch { return null; }
    },
  };
}
