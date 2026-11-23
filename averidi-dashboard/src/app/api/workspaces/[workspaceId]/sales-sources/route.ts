import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {requireDashboardEntitlement} from '../../../../../features/subscriptions/entitlements';
import {quotaHttpError} from '../../../../../features/quotas/http';
import {listSalesSources,registerSalesSource} from '../../../../../features/sales/sources';
type Ctx={params:Promise<{workspaceId:string}>};
const headers={'Cache-Control':'no-store'};
async function access(request:Request,context:Ctx,write:boolean){
 const denied=await enforceWorkspacePermission(request,context,write?'datasets.write':'datasets.read');if(denied)return {response:denied};
 if(write&&!dashboardSameOrigin(request))return {response:NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers})};
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return {response:NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers})};
 const {workspaceId}=await context.params;
 if(!await requireDashboardEntitlement(actor,workspaceId))return {response:NextResponse.json({error:'SUBSCRIPTION_REQUIRED'},{status:402,headers})};
 return {actor,workspaceId};
}
export async function GET(request:Request,context:Ctx){const a=await access(request,context,false);if(a.response)return a.response;
 const datasets=await listSalesSources(a.actor!,a.workspaceId!);return NextResponse.json(datasets?{datasets}:{error:'FORBIDDEN'},{status:datasets?200:403,headers});}
export async function POST(request:Request,context:Ctx){const a=await access(request,context,true);if(a.response)return a.response;
 try{const text=await request.text();if(text.length>4096)return NextResponse.json({error:'BODY_TOO_LARGE'},{status:413,headers});
  let input:unknown;try{input=JSON.parse(text);}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400,headers});}
  return NextResponse.json({dataset:await registerSalesSource(a.actor!,a.workspaceId!,input)},{status:201,headers});
 }catch(error){const quota=quotaHttpError(error);if(quota)return quota;
  if(error instanceof Error&&['FORBIDDEN','INVALID_NAME'].includes(error.message))return NextResponse.json({error:error.message},{status:error.message==='FORBIDDEN'?403:400,headers});throw error;}
}
