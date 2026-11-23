import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../../../../server/request-origin";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../../../server/auth-boundary";
import { requireDashboardEntitlement } from "../../../../../../../features/subscriptions/entitlements";
import { confirmWorkspaceDatasetMetricRules } from "../../../../../../../features/datasets/service";

type Context={params:Promise<{workspaceId:string;datasetId:string}>};
const headers={"Cache-Control":"no-store"};
export async function POST(request:Request,context:Context) {
 const permissionDenied=await enforceWorkspacePermission(request,context,'analysis.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  const {workspaceId,datasetId}=await context.params;
  if(!await requireDashboardEntitlement(actor,workspaceId))
    return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers});
  let input:unknown;
  try{
    const raw=await request.text();
    if(raw.length>8192)return NextResponse.json({error:"BODY_TOO_LARGE"},{status:413,headers});
    input=JSON.parse(raw);
  }catch{return NextResponse.json({error:"INVALID_JSON"},{status:400,headers});}
  const result=await confirmWorkspaceDatasetMetricRules(actor,workspaceId,datasetId,input);
  if(!result.ok)return NextResponse.json({error:result.error},{status:
    result.error==="FORBIDDEN"?403:result.error==="DATASET_UNAVAILABLE"?404:result.error==="VERSION_CONFLICT"?409:400,headers});
  return NextResponse.json(result,{headers});
}
