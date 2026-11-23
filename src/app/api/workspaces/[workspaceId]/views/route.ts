import {quotaHttpError} from '../../../../../features/quotas/http';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../../server/request-origin";
import {requireDashboardEntitlement} from "../../../../../features/subscriptions/entitlements";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../server/auth-boundary";
import { createWorkspaceView, listWorkspaceViews } from "../../../../../features/views/service";

type Context={params:Promise<{workspaceId:string}>};
const headers={"Cache-Control":"no-store"};

export async function GET(request:Request,context:Context) {
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;

  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  const {workspaceId}=await context.params;
  if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers});
  const views=await listWorkspaceViews(actor,workspaceId);
  if(!views)return NextResponse.json({error:"FORBIDDEN"},{status:403,headers});
  return NextResponse.json({views},{headers});
}

export async function POST(request:Request,context:Context) {
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  const {workspaceId}=await context.params;
  if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers});
  let input:unknown;
  try{
    const raw=await request.text();
    if(raw.length>65536)return NextResponse.json({error:"BODY_TOO_LARGE"},{status:413,headers});
    input=JSON.parse(raw);
  }catch{
    return NextResponse.json({error:"INVALID_JSON"},{status:400,headers});
  }
  try {const result=await createWorkspaceView(actor,workspaceId,input);
  if(!result.ok)return NextResponse.json({error:result.error},{status:result.error==="FORBIDDEN"?403:400,headers});
  return NextResponse.json({view:result.view},{status:201,headers});}catch(error){const policy=quotaHttpError(error);if(policy)return policy;throw error;}
}
