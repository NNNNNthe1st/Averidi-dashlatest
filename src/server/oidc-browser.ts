import {createHash,randomBytes} from "node:crypto";
import {SignJWT,jwtVerify,createRemoteJWKSet} from "jose";
import {dashboardDb} from "./db";
import {validateDashboardOidcConfig} from "./oidc-config";

const issuerURL=(value:string)=>new URL(value);
export function dashboardBrowserOidcSettings(){
 const issuer=process.env.DASHBOARD_OIDC_ISSUER;
 const jwksUrl=process.env.DASHBOARD_OIDC_JWKS_URL;
 const clientId=process.env.DASHBOARD_OIDC_CLIENT_ID;
 const authorizationUrl=process.env.DASHBOARD_OIDC_AUTHORIZATION_URL;
 const tokenUrl=process.env.DASHBOARD_OIDC_TOKEN_URL;
 const redirectUrl=process.env.DASHBOARD_OIDC_REDIRECT_URL;
 const secret=process.env.DASHBOARD_SESSION_SECRET;
 if(!issuer||!jwksUrl||!clientId||!authorizationUrl||!tokenUrl||!redirectUrl||!secret||Buffer.byteLength(secret)<32)throw new Error("Dashboard browser OIDC is not configured.");
 validateDashboardOidcConfig({issuer,audience:clientId,jwksUrl});
 const auth=issuerURL(authorizationUrl),token=issuerURL(tokenUrl),redirect=issuerURL(redirectUrl),base=issuerURL(issuer);
 if(auth.protocol!=="https:"||token.protocol!=="https:"||auth.origin!==base.origin||token.origin!==base.origin||auth.username||auth.password||token.username||token.password||auth.hash||token.hash||auth.search||token.search)throw new Error("Dashboard OIDC endpoints must be HTTPS and issuer-owned.");
 if(redirect.protocol!=="https:" || redirect.username||redirect.password||redirect.hash||redirect.search||redirect.pathname!=="/dashboard/app/api/auth/callback")throw new Error("Dashboard OIDC redirect must use HTTPS.");
 return {issuer,jwksUrl,clientId,authorizationUrl,tokenUrl,redirectUrl,secret};
}
export const OIDC_PENDING_COOKIE="__Secure-dashboard-oidc-pending";
const key=(secret:string)=>new TextEncoder().encode(secret);
const random=()=>randomBytes(32).toString("base64url");
export async function beginDashboardLogin(){
 const config=dashboardBrowserOidcSettings(),state=random(),nonce=random(),verifier=random();
 const challenge=createHash("sha256").update(verifier).digest("base64url");
 const attemptId=createHash("sha256").update(state).digest("hex");
 await dashboardDb.dashboardLoginAttempt.create({data:{id:attemptId,expiresAt:new Date(Date.now()+300_000)}});
 const pending=await new SignJWT({state,nonce,verifier})
  .setProtectedHeader({alg:"HS256"}).setIssuer("averidi-dashboard-oidc")
  .setAudience("averidi-dashboard-oidc-callback").setIssuedAt().setExpirationTime("5m")
  .sign(key(config.secret));
 const url=new URL(config.authorizationUrl);
 for(const [k,v] of Object.entries({client_id:config.clientId,response_type:"code",scope:"openid",redirect_uri:config.redirectUrl,state,nonce,code_challenge:challenge,code_challenge_method:"S256"}))url.searchParams.set(k,v);
 return {url:url.toString(),pending};
}
export async function completeDashboardLogin(state:string,code:string,pending:string){
 const config=dashboardBrowserOidcSettings();
 if(!/^[A-Za-z0-9_-]{20,256}$/.test(state)||!code||code.length>4096)return null;
 let data;
 try{
  const result=await jwtVerify(pending,key(config.secret),{issuer:"averidi-dashboard-oidc",audience:"averidi-dashboard-oidc-callback",algorithms:["HS256"]});
  data=result.payload;
 }catch{return null;}
 if(data.state!==state||typeof data.nonce!=="string"||typeof data.verifier!=="string")return null;
 const consumed=await dashboardDb.dashboardLoginAttempt.updateMany({where:{id:createHash("sha256").update(state).digest("hex"),consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
 if(consumed.count!==1)return null;
 const response=await fetch(config.tokenUrl,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:config.clientId,redirect_uri:config.redirectUrl,code,code_verifier:data.verifier}),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});
 if(!response.ok)return null;
 // Bound trusted-provider responses as well as request inputs; never buffer an unbounded token body.
 const reader=response.body?.getReader();
 if(!reader)return null;
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return null;}chunks.push(value);}}
 finally{reader.releaseLock();}
 let tokens:unknown;try{tokens=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return null;}
 if(!tokens||typeof tokens!=="object"||!("id_token" in tokens)||typeof tokens.id_token!=="string")return null;
 const {payload}=await jwtVerify(tokens.id_token,createRemoteJWKSet(new URL(config.jwksUrl)),{issuer:config.issuer,audience:config.clientId,algorithms:["RS256","ES256","PS256"],clockTolerance:"30s",requiredClaims:["exp","iat","iss","aud","sub","nonce"],maxTokenAge:"10m"});
 if((Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==config.clientId)||(payload.azp!==undefined&&payload.azp!==config.clientId))return null;
 if(payload.nonce!==data.nonce||typeof payload.sub!=="string"||!payload.sub.trim()||payload.sub.length>255)return null;
 return {issuer:config.issuer,subject:payload.sub};
}
