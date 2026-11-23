/** @param {Record<string,string|undefined>} [env] */
export function codespacesOrigins(env=process.env){
 if(env.CODESPACES!=='true'||!/^[a-z0-9][a-z0-9-]{6,98}[a-z0-9]$/.test(env.CODESPACE_NAME??'')||env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN!=='app.github.dev'||env.NODE_ENV==='production')throw Error('This helper requires a development GitHub Codespace.');
 const app=`https://${env.CODESPACE_NAME}-3000.app.github.dev`,identity=`https://${env.CODESPACE_NAME}-8081.app.github.dev`;
 return {app,identity,issuer:identity+'/realms/dashboard-development'};
}
/** @param {Record<string,string|undefined>} [env] */
export function codespacesOidcSettings(env=process.env){
 const {app,issuer}=codespacesOrigins(env);
 return {DASHBOARD_PUBLIC_ORIGIN:app,DASHBOARD_OIDC_ISSUER:issuer,DASHBOARD_OIDC_AUDIENCE:'averidi-dashboard-development',DASHBOARD_OIDC_CLIENT_ID:'averidi-dashboard-development',DASHBOARD_OIDC_JWKS_URL:issuer+'/protocol/openid-connect/certs',DASHBOARD_OIDC_AUTHORIZATION_URL:issuer+'/protocol/openid-connect/auth',DASHBOARD_OIDC_TOKEN_URL:issuer+'/protocol/openid-connect/token',DASHBOARD_OIDC_REDIRECT_URL:app+'/dashboard/app/api/auth/callback'};
}
/** Development split routing: public issuer identity is unchanged; only server-side
 * token/JWKS/discovery transport goes to this Codespace's trusted loopback TLS proxy.
 * The browser uses private GitHub port forwarding and the normal provider login. */
/** @param {string|URL} input @param {Record<string,string|undefined>} [env] */
export function oidcLoopbackTarget(input,env=process.env){
 const {identity}=codespacesOrigins(env),url=new URL(input);
 if(url.origin!==identity)return null;
 if(url.username||url.password||url.search||url.hash||!['/realms/dashboard-development/protocol/openid-connect/token','/realms/dashboard-development/protocol/openid-connect/certs','/realms/dashboard-development/.well-known/openid-configuration'].includes(url.pathname))throw Error('Unapproved development OIDC backchannel request.');
 return new URL(url.pathname,'https://localhost:9443').toString();
}
