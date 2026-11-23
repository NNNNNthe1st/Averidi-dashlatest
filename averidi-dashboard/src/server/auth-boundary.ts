import type { VerifiedDashboardActor } from "./workspace-access";
import { dashboardOidcProvider } from "./oidc-identity";
import { extractDashboardSessionCookie, hasDashboardSessionCookie } from "./session-cookie";
import { verifyDashboardBrowserSession } from "./browser-session";

// Contract only. There is deliberately no insecure local-development bypass.
// The actual provider adapter must verify issuer, audience, signature, expiry,
// and session state before returning an actor.
export interface DashboardIdentityProvider {
  getVerifiedActor(request: Request): Promise<VerifiedDashboardActor | null>;
}

let installedProvider: DashboardIdentityProvider | null = null;

export function installDashboardIdentityProvider(provider: DashboardIdentityProvider): void {
  if (installedProvider) throw new Error("Identity provider already installed");
  installedProvider = provider;
}

async function verifyDashboardRequestActor(request: Request): Promise<VerifiedDashboardActor | null> {
  const session=extractDashboardSessionCookie(request);
  if(hasDashboardSessionCookie(request)){
    if(!session)return null;
    const actor=await verifyDashboardBrowserSession(session);
    if(actor)return actor;
    return null; // Never fall through from an invalid browser session to another identity.
  }
  if (installedProvider) return installedProvider.getVerifiedActor(request);
  const issuer=process.env.DASHBOARD_OIDC_ISSUER;
  const audience=process.env.DASHBOARD_OIDC_AUDIENCE;
  const jwksUrl=process.env.DASHBOARD_OIDC_JWKS_URL;
  if (!issuer && !audience && !jwksUrl) return null;
  if (!issuer || !audience || !jwksUrl) throw new Error("Incomplete Dashboard OIDC configuration.");
  installedProvider=dashboardOidcProvider({issuer,audience,jwksUrl});
  return installedProvider.getVerifiedActor(request);
}

// Permission middleware and route handlers must use the same verified identity
// within one HTTP request. No actor is persisted across independent requests.
const requestActors=new WeakMap<Request,Promise<VerifiedDashboardActor|null>>();
export function getAuthenticatedDashboardActor(request:Request):Promise<VerifiedDashboardActor|null>{
 const existing=requestActors.get(request);
 if(existing)return existing;
 const verification=verifyDashboardRequestActor(request);
 requestActors.set(request,verification);
 return verification;
}
