import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {authorizedView} from "../../../../../../../features/sharing/access";
import {requireDashboardEntitlement} from "../../../../../../../features/subscriptions/entitlements";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../../../server/auth-boundary";
import { requireWorkspaceRole } from "../../../../../../../server/workspace-access";
import { dashboardDb } from "../../../../../../../server/db";
import { definitionSchema } from "../../../../../../../features/views/validation";
import { exportDashboardDefinitionCsv } from "../../../../../../../features/reports/view-export";

type Context = {params:Promise<{workspaceId:string;viewId:string}>};

export async function GET(request:Request,context:Context) {
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.export');if(permissionDenied)return permissionDenied;

  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
  const {workspaceId,viewId}=await context.params;
  if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers:{"Cache-Control":"no-store"}});
  if(!await requireWorkspaceRole(actor,workspaceId,"VIEWER"))
    return NextResponse.json({error:"FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}});
  const view=await authorizedView(actor,workspaceId,viewId).catch(()=>null);
  if(!view)return NextResponse.json({error:"NOT_FOUND"},{status:404,headers:{"Cache-Control":"no-store"}});
  const parsed=definitionSchema.safeParse(view.definition);
  if(!parsed.success)return NextResponse.json({error:"INVALID_SAVED_VIEW"},{status:422,headers:{"Cache-Control":"no-store"}});
  const csv=exportDashboardDefinitionCsv(parsed.data);
  return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="dashboard-definition.csv"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
