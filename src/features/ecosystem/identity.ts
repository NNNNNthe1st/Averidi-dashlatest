import {createRemoteJWKSet,jwtVerify} from 'jose';
import {ecosystemClaimsSchema,type EcosystemClaims} from '../../contracts/integration';
import {validateDashboardOidcConfig,type DashboardOidcConfig} from '../../server/oidc-config';
export function createEcosystemTokenVerifier(input:DashboardOidcConfig){
 const config=validateDashboardOidcConfig(input),keys=createRemoteJWKSet(new URL(config.jwksUrl));
 return async(request:Request):Promise<EcosystemClaims|null>=>{
  const match=/^Bearer ([A-Za-z0-9._~-]{1,16384})$/.exec(request.headers.get('authorization')??'');if(!match)return null;
  try{
   const {payload}=await jwtVerify(match[1],keys,{issuer:config.issuer,audience:config.audience,algorithms:['RS256','ES256','PS256'],requiredClaims:['iss','sub','aud','iat','exp','jti'],maxTokenAge:'5m',clockTolerance:'10s'});
   const parsed=ecosystemClaimsSchema.safeParse(payload);return parsed.success?parsed.data:null;
  }catch{return null;}
 };
}
