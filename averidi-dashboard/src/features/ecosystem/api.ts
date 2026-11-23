import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {dashboardReleaseConfig,isDashboardWorkspaceReleased} from '../../server/release-gate';
import type {EcosystemClaims} from '../../contracts/integration';
import {subscriptionSummarySchema,navigationSchema,dashboardResourceId} from '../../contracts/integration';
import {averidiIntegrationsActive,ecosystemIdentityConfig} from './config';
import {createEcosystemTokenVerifier} from './identity';
import {readIntegrationNavigation,readIntegrationSubscription} from './service';
const headers={'Cache-Control':'private, no-store','X-Dashboard-Contract-Version':'1.0'};
type Dependencies={active:()=>boolean;verify:(request:Request)=>Promise<EcosystemClaims|null>;released:(workspaceId:string)=>boolean;subscription:typeof readIntegrationSubscription;navigation:typeof readIntegrationNavigation};
/** A dependency seam for offline conformance fixtures. HTTP input cannot alter activation. */
export function createEcosystemApi(deps:Dependencies){
 return async(request:Request,workspaceId:string,resource:'subscription'|'navigation')=>{
  const requestId=randomUUID();
  const fail=(error:string,status:number)=>NextResponse.json({contractVersion:'1.0',error,requestId},{status,headers});
  if(!deps.active())return fail('INTEGRATIONS_INACTIVE',503);
  try{
   if(request.method!=='GET'||new URL(request.url).search||!dashboardResourceId.safeParse(workspaceId).success)return fail('INVALID_CONTRACT_REQUEST',400);
   const actor=await deps.verify(request);if(!actor)return fail('UNAUTHORIZED',401);
   if(!actor.workspace_ids.includes(workspaceId))return fail('FORBIDDEN',403);
   if(!deps.released(workspaceId))return fail('DASHBOARD_NOT_RELEASED',503);
   const data=await deps[resource](actor,workspaceId),schema=resource==='subscription'?subscriptionSummarySchema:navigationSchema;
   const result=schema.safeParse(data);if(!result.success)return fail('INVALID_CONTRACT_RESPONSE',502);
   return NextResponse.json(result.data,{headers});
  }catch(error){const code=error instanceof Error?error.message:'';return fail(code==='FORBIDDEN'?'FORBIDDEN':code==='INVALID_CONTRACT_REQUEST'?code:'INTEGRATION_UNAVAILABLE',code==='FORBIDDEN'?403:code==='INVALID_CONTRACT_REQUEST'?400:503);}
 };
}
let verifier:ReturnType<typeof createEcosystemTokenVerifier>|undefined;
export const ecosystemApi=createEcosystemApi({active:averidiIntegrationsActive,verify:request=>{verifier??=createEcosystemTokenVerifier(ecosystemIdentityConfig());return verifier(request);},released:id=>isDashboardWorkspaceReleased(id,dashboardReleaseConfig()),subscription:readIntegrationSubscription,navigation:readIntegrationNavigation});
