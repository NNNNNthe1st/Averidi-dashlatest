import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../../../server/request-origin";
import {requireDashboardEntitlement} from "../../../../../../features/subscriptions/entitlements";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../../server/auth-boundary";
import { updateWorkspaceView } from "../../../../../../features/views/service";

type Context = { params: Promise<{ workspaceId:string; viewId:string }> };
const headers = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: Context) {
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const actor = await getAuthenticatedDashboardActor(request);
  if (!actor) return NextResponse.json({ error:"UNAUTHORIZED" }, { status:401, headers });
  const { workspaceId, viewId } = await context.params;
  if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers});
  let definition: unknown;
  let expectedUpdatedAt: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 65536) return NextResponse.json({ error:"BODY_TOO_LARGE" }, { status:413, headers });
    const body:unknown = JSON.parse(raw);
    definition = body && typeof body === "object" && !Array.isArray(body) ? (body as {definition?:unknown}).definition : undefined;
    expectedUpdatedAt = body && typeof body === "object" && !Array.isArray(body) ? (body as {expectedUpdatedAt?:unknown}).expectedUpdatedAt : undefined;
  } catch {
    return NextResponse.json({ error:"INVALID_JSON" }, { status:400, headers });
  }
  const result = await updateWorkspaceView(actor,workspaceId,viewId,definition,expectedUpdatedAt);
  if (!result.ok) return NextResponse.json({error:result.error}, { status:result.error==="FORBIDDEN"?403:result.error==="NOT_FOUND"?404:result.error==="CONFLICT"?409:400, headers });
  return NextResponse.json({updated:true,updatedAt:result.updatedAt}, {headers});
}
