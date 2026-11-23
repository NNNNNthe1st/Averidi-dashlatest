import {quotaHttpError} from '../../../../../features/quotas/http';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../../server/request-origin";
import {requireDashboardEntitlement} from "../../../../../features/subscriptions/entitlements";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../server/auth-boundary";
import { createWorkspaceDataset, listWorkspaceDatasets } from "../../../../../features/datasets/service";

type Ctx = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: Ctx) {
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.read');if(permissionDenied)return permissionDenied;

  const actor = await getAuthenticatedDashboardActor(request);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  const { workspaceId } = await context.params;
  if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers:noStore});
  const datasets = await listWorkspaceDatasets(actor, workspaceId);
  if (!datasets) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: noStore });
  return NextResponse.json({ datasets }, { headers: noStore });
}

export async function POST(request: Request, context: Ctx) {
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.write');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const actor = await getAuthenticatedDashboardActor(request);
  if (!actor) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  const { workspaceId } = await context.params;
  if(!await requireDashboardEntitlement(actor,workspaceId))return NextResponse.json({error:"SUBSCRIPTION_REQUIRED"},{status:402,headers:noStore});
  let payload: unknown;
  try {
    const body = await request.text();
    if (body.length > 4096) return NextResponse.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers: noStore });
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400, headers: noStore });
  }
  const candidate = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as { name?: unknown }).name : undefined;
  try {
  const result = await createWorkspaceDataset(actor, workspaceId, candidate);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "FORBIDDEN" ? 403 : 400, headers: noStore });
  return NextResponse.json({ dataset: result.dataset }, { status: 201, headers: noStore });
  }catch(error){const quota=quotaHttpError(error);if(quota)return quota;throw error;}
}
