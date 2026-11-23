import * as oidcModule from '../src/server/oidc-browser.ts';
import * as dbModule from '../src/server/db.ts';
const {dashboardBrowserOidcSettings}=oidcModule.default??oidcModule;
const {dashboardDb}=dbModule.default??dbModule;
try{
 const config=dashboardBrowserOidcSettings();
 const response=await fetch(config.issuer.replace(/\/$/,'')+'/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Dashboard identity discovery is unavailable.');
 const metadata=await response.json();
 for(const [key,value] of Object.entries({issuer:config.issuer,authorization_endpoint:config.authorizationUrl,token_endpoint:config.tokenUrl,jwks_uri:config.jwksUrl}))if(metadata[key]!==value)throw new Error('Dashboard OIDC discovery mismatch: '+key);
 if(!metadata.response_types_supported?.includes('code')||!metadata.code_challenge_methods_supported?.includes('S256'))throw new Error('Identity provider must support authorization code and PKCE S256.');
 await dashboardDb.dashboardLoginAttempt.count();
 await dashboardDb.dashboardSession.count();
 console.log(JSON.stringify({configured:true,discovery:true,pkce:true,sessionDatabase:true}));
}finally{await dashboardDb.$disconnect();}
