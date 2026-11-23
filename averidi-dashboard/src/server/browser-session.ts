import {auditedWrite} from '../features/audit/service';
import {setAuditActor} from '../features/audit/context';
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomUUID } from "node:crypto";
import { dashboardDb } from "./db";
import { resolveVerifiedDashboardActor } from "./workspace-access";
import type { VerifiedDashboardActor } from "./workspace-access";

const tokenIssuer="averidi-dashboard";
const tokenAudience="averidi-dashboard-browser";
function sessionVersion() { return process.env.DASHBOARD_SESSION_VERSION || "1"; }
function sessionKey() {
  const secret=process.env.DASHBOARD_SESSION_SECRET;
  if(!secret || Buffer.byteLength(secret,"utf8")<32)throw new Error("Dashboard session secret is not configured securely.");
  return new TextEncoder().encode(secret);
}
export async function issueDashboardBrowserSession(actor:VerifiedDashboardActor) {
  const signingKey=sessionKey();
  const id=randomUUID();
  const expiresAt=new Date(Date.now()+30*60*1000);
  await auditedWrite(actor,tx=>tx.dashboardSession.create({data:{id,userId:actor.userId,expiresAt}}));
  return new SignJWT({identityIssuer:actor.issuer,sessionVersion:sessionVersion()})
    .setProtectedHeader({alg:"HS256"})
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setSubject(actor.subject)
    .setIssuedAt()
    .setJti(id)
    .setExpirationTime("30m")
    .sign(signingKey);
}
export async function verifyDashboardBrowserSession(token:string) {
  const signingKey=sessionKey();
  let payload:JWTPayload;
  try {
    ({payload}=await jwtVerify(token,signingKey,{issuer:tokenIssuer,audience:tokenAudience,algorithms:["HS256"],requiredClaims:["exp","iat","iss","aud","sub","jti"],maxTokenAge:"30m"}));
  } catch {
    // Invalid, expired, or incorrectly signed tokens are unauthenticated.
    return null;
  }
  if(typeof payload.sub!=="string" || typeof payload.identityIssuer!=="string" || typeof payload.jti!=="string" || payload.sessionVersion!==sessionVersion())return null;
  // Keep identity/database failures visible to the route boundary. Treating them
  // as an invalid token hides infrastructure faults and produces misleading 401s.
  const actor=await resolveVerifiedDashboardActor({subject:payload.sub,issuer:payload.identityIssuer});
  if(!actor)return null;
  const row=await dashboardDb.dashboardSession.findUnique({where:{id:payload.jti},select:{userId:true,revokedAt:true,expiresAt:true}});
  if(!row || row.userId!==actor.userId || row.revokedAt || row.expiresAt.getTime()<=Date.now())return null;
  return actor;
}

export async function revokeDashboardBrowserSession(token:string):Promise<void> {
  try {
    const {payload}=await jwtVerify(token,sessionKey(),{issuer:tokenIssuer,audience:tokenAudience,algorithms:["HS256"],requiredClaims:["exp","iat","iss","aud","sub","jti"],maxTokenAge:"30m"});
    if(typeof payload.jti!=="string")return;
    const actor=typeof payload.identityIssuer==='string'&&typeof payload.sub==='string'?await resolveVerifiedDashboardActor({issuer:payload.identityIssuer,subject:payload.sub}):null;
    if(actor)await auditedWrite(actor,tx=>tx.dashboardSession.updateMany({where:{id:payload.jti,userId:actor.userId,revokedAt:null},data:{revokedAt:new Date()}}));
  }catch { /* Invalid tokens cannot revoke another session. */ }
}

export async function revokeAllDashboardSessions(actor:VerifiedDashboardActor){
 return auditedWrite(actor,tx=>tx.dashboardSession.updateMany({where:{userId:actor.userId,revokedAt:null},data:{revokedAt:new Date()}}));
}

/** Atomically consume the old session so simultaneous refresh requests cannot fork it. */
export async function rotateDashboardBrowserSession(token:string){
 const actor=await verifyDashboardBrowserSession(token);
 if(!actor)return null;
 const {payload}=await jwtVerify(token,sessionKey(),{issuer:tokenIssuer,audience:tokenAudience,algorithms:["HS256"],requiredClaims:["exp","iat","iss","aud","sub","jti"],maxTokenAge:"30m"});
 const id=randomUUID(),expiresAt=new Date(Date.now()+1800_000);
 const replacement=await new SignJWT({identityIssuer:actor.issuer,sessionVersion:sessionVersion()})
  .setProtectedHeader({alg:"HS256"}).setIssuer(tokenIssuer).setAudience(tokenAudience).setSubject(actor.subject)
  .setIssuedAt().setJti(id).setExpirationTime("30m").sign(sessionKey());
 const created=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor);
  const old=await tx.dashboardSession.updateMany({where:{id:payload.jti!,userId:actor.userId,revokedAt:null,expiresAt:{gt:new Date()}},data:{revokedAt:new Date()}});
  if(old.count!==1)return false;
  await tx.dashboardSession.create({data:{id,userId:actor.userId,expiresAt}});
  return true;
 });
 return created?replacement:null;
}

export async function cleanupDashboardAuthentication(now=new Date()){
 const cutoff=new Date(now.getTime()-24*60*60*1000);
 const sessions=await dashboardDb.dashboardSession.deleteMany({where:{OR:[{expiresAt:{lt:cutoff}},{revokedAt:{lt:cutoff}}]}});
 const attempts=await dashboardDb.dashboardLoginAttempt.deleteMany({where:{expiresAt:{lt:now}}});
 const connectorAttempts=await dashboardDb.dashboardConnectorOAuthAttempt.deleteMany({where:{expiresAt:{lt:now}}});
 const requestBuckets=await dashboardDb.dashboardRequestBucket.deleteMany({where:{expiresAt:{lt:now}}});
 return {sessions:sessions.count,attempts:attempts.count,connectorAttempts:connectorAttempts.count,requestBuckets:requestBuckets.count};
}
