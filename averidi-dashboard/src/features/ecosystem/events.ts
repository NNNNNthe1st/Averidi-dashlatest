import {createHash} from 'node:crypto';
import {SignJWT,createRemoteJWKSet,jwtVerify,type CryptoKey,type KeyObject} from 'jose';
import {dashboardEventSchema,signedEventClaimsSchema,type DashboardEvent} from '../../contracts/integration';
import {validateDashboardOidcConfig,type DashboardOidcConfig} from '../../server/oidc-config';
/** Offline-ready event codec. It neither sends events nor changes subscriptions or identities. */
export async function signDashboardEvent(input:unknown,key:CryptoKey|KeyObject|Uint8Array,kid:string,issuer:string,audience:string){
 const event=dashboardEventSchema.parse(input),now=Math.floor(Date.now()/1000);
 const claims=signedEventClaimsSchema.parse({iss:issuer,aud:audience,sub:'workspace:'+event.workspaceId,iat:now,exp:now+300,jti:event.eventId,integration:'averidi-dashboard-events-v1',event});
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(kid))throw Error('INVALID_EVENT_KEY');
 return new SignJWT(claims).setProtectedHeader({alg:'RS256',typ:'JWT',kid}).sign(key);
}
export function createDashboardEventVerifier(input:DashboardOidcConfig){
 const config=validateDashboardOidcConfig(input),keys=createRemoteJWKSet(new URL(config.jwksUrl));
 return async(token:string):Promise<DashboardEvent>=>{
  if(token.length>16384)throw Error('INVALID_EVENT');
  try{
   const {payload}=await jwtVerify(token,keys,{issuer:config.issuer,audience:config.audience,algorithms:['RS256','ES256','PS256'],requiredClaims:['iss','aud','sub','iat','exp','jti'],maxTokenAge:'5m',clockTolerance:'10s'});
   const result=signedEventClaimsSchema.safeParse(payload);if(!result.success)throw Error('INVALID_EVENT');return result.data.event;
  }catch{throw Error('INVALID_EVENT');}
 };
}

export type AtomicDashboardEventReceiver={
 /** Persist eventId + digest and apply the receiver effect atomically in the receiver's OWN store. */
 accept:(event:DashboardEvent,digest:string)=>Promise<'APPLIED'|'DUPLICATE'|'CONFLICT'>;
};
export async function consumeDashboardEvent(token:string,verify:ReturnType<typeof createDashboardEventVerifier>,receiver:AtomicDashboardEventReceiver){
 const event=await verify(token),digest=createHash('sha256').update(JSON.stringify(event)).digest('hex');
 const outcome=await receiver.accept(event,digest);if(outcome==='CONFLICT')throw Error('EVENT_IDEMPOTENCY_CONFLICT');return {eventId:event.eventId,outcome};
}
