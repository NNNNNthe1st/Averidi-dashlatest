export type DashboardOidcConfig = Readonly<{issuer:string;audience:string;jwksUrl:string}>;

export function validateDashboardOidcConfig(input: DashboardOidcConfig): DashboardOidcConfig {
  let issuer: URL, jwks: URL;
  try { issuer = new URL(input.issuer); jwks = new URL(input.jwksUrl); }
  catch { throw new Error("Dashboard OIDC URLs are invalid."); }
  if (issuer.protocol !== "https:" || jwks.protocol !== "https:")
    throw new Error("Dashboard OIDC requires HTTPS.");
  if (issuer.username || issuer.password || issuer.hash || issuer.search ||
      jwks.username || jwks.password || jwks.hash || jwks.search)
    throw new Error("Dashboard OIDC URLs must not contain credentials or fragments.");
  if (!input.audience.trim() || input.audience.length > 256)
    throw new Error("Dashboard OIDC audience is invalid.");
  if (issuer.origin !== jwks.origin)
    throw new Error("Dashboard OIDC JWKS must share the issuer origin.");
  // The configured issuer must match the JWT 'iss' claim exactly.
  return Object.freeze({...input});
}
