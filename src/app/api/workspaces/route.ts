import {quotaHttpError} from '../../../features/quotas/http';
import { dashboardSameOrigin } from "../../../server/request-origin";
import { NextResponse } from "next/server";
import {dashboardDb} from "../../../server/db";
import { getAuthenticatedDashboardActor } from "../../../server/auth-boundary";
import { createActorWorkspace,listActorWorkspaces } from "../../../features/workspaces/service";
import { dashboardReleaseConfig, isDashboardWorkspaceReleased } from "../../../server/release-gate";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request) {
  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  const workspaces=await listActorWorkspaces(actor);
  const release=dashboardReleaseConfig();
  const visible=release.mode==="BETA" ? workspaces.filter(x=>isDashboardWorkspaceReleased(x.workspace.id,release)) : workspaces;
  const admission=await dashboardDb.dashboardConfiguration.findUnique({where:{key:"WORKSPACE_CREATION_ENABLED"},select:{value:true}});
  return NextResponse.json({workspaces:visible,canCreateWorkspace:admission?.value!==false},{headers});
}
export async function POST(request:Request) {
 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  let input:unknown;
  try {input=await request.json();}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400,headers});}
  try {const result=await createActorWorkspace(actor,input);
  return NextResponse.json(result,{status:result.ok?201:400,headers});}catch(error){if(error instanceof Error&&error.message==="CONFIGURATION_ACTION_DISABLED")return NextResponse.json({error:"WORKSPACE_CREATION_DISABLED"},{status:403,headers});const policy=quotaHttpError(error);if(policy)return policy;throw error;}
}
