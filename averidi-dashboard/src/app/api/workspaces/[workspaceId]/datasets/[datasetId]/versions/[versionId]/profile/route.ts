import {enforceWorkspacePermission} from '../../../../../../../../../features/permissions/http';
import {requireDashboardEntitlement} from "../../../../../../../../../features/subscriptions/entitlements";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../../../../../server/auth-boundary";
import { requireWorkspaceRole } from "../../../../../../../../../server/workspace-access";
import { dashboardDb } from "../../../../../../../../../server/db";

type Context={params:Promise<{workspaceId:string;datasetId:string;versionId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.read');if(permissionDenied)return permissionDenied;

  const headers={"Cache-Control":"private, no-store"};
  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  const {workspaceId,datasetId,versionId}=await context.params;
  if(!await requireWorkspaceRole(actor,workspaceId,"VIEWER"))
    return NextResponse.json({error:"FORBIDDEN"},{status:403,headers});
  if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers});
  const version=await dashboardDb.dashboardDatasetVersion.findFirst({
    where:{id:versionId,datasetId,dataset:{workspaceId}},
    select:{id:true,version:true,rowCount:true,profile:true,semantics:true,profiledAt:true},
  });
  if(!version)return NextResponse.json({error:"NOT_FOUND"},{status:404,headers});
  return NextResponse.json({version},{headers});
}
