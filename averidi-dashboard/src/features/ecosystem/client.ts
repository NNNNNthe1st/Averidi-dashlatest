import {dashboardResourceId,subscriptionSummarySchema,navigationSchema,DASHBOARD_INTEGRATION_BASE_PATH,type DashboardSubscriptionSummary,type DashboardNavigation} from '../../contracts/integration';
import {averidiIntegrationsActive} from './config';
export class IntegrationClientError extends Error{constructor(public readonly code:string,public readonly retryAfterSeconds:number|null=null){super(code);}}
type Options={origin:string;token:()=>Promise<string>;active?:()=>boolean;transport?:typeof fetch};
/** Dashboard-owned conformance client. Other products implement their own adapters from the wire specification. */
export function createDashboardContractClient(options:Options){
 const active=options.active??averidiIntegrationsActive,transport=options.transport??fetch;
 async function read(workspaceId:string,resource:'subscription'|'navigation'){
  // Gate before resolving credentials, validating destinations or making any request.
  if(!active())throw new IntegrationClientError('INTEGRATIONS_INACTIVE');
  const parsed=dashboardResourceId.safeParse(workspaceId);if(!parsed.success)throw new IntegrationClientError('INVALID_CONTRACT_REQUEST');
  let origin:URL;try{origin=new URL(options.origin);if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash)throw Error();}catch{throw new IntegrationClientError('INVALID_CONTRACT_ORIGIN');}
  const token=await options.token();if(!/^[A-Za-z0-9._~-]{1,16384}$/.test(token))throw new IntegrationClientError('INVALID_INTEGRATION_TOKEN');
  let response:Response;
  try{response=await transport(origin.origin+DASHBOARD_INTEGRATION_BASE_PATH+`/workspaces/${workspaceId}/${resource}`,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000)});}catch{throw new IntegrationClientError('INTEGRATION_UNAVAILABLE',30);}
  if(!response.ok){await response.body?.cancel();const retry=response.status===429||response.status===503;const raw=response.headers.get('retry-after');throw new IntegrationClientError(response.status===401?'UNAUTHORIZED':response.status===403?'FORBIDDEN':'INTEGRATION_UNAVAILABLE',retry?raw&&/^\d{1,5}$/.test(raw)?Math.max(1,Math.min(3600,Number(raw))):30:null);}
  if(response.headers.get('x-dashboard-contract-version')!=='1.0'||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw new IntegrationClientError('INVALID_CONTRACT_RESPONSE');}
  const chunks:Uint8Array[]=[];let size=0;
  const reader=response.body?.getReader();if(!reader)throw new IntegrationClientError('INVALID_CONTRACT_RESPONSE');
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader.cancel();throw Error();}chunks.push(part.value);}}
  catch{throw new IntegrationClientError('INVALID_CONTRACT_RESPONSE');}finally{reader.releaseLock();}
  try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=(resource==='subscription'?subscriptionSummarySchema:navigationSchema).parse(body);if(result.workspaceId!==workspaceId)throw Error();return result;}catch{throw new IntegrationClientError('INVALID_CONTRACT_RESPONSE');}
 }
 return {subscription:(id:string)=>read(id,'subscription') as Promise<DashboardSubscriptionSummary>,navigation:(id:string)=>read(id,'navigation') as Promise<DashboardNavigation>};
}
