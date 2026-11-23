import {enforceWorkspacePermission} from '../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../server/request-origin";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../server/auth-boundary";
import { renameWorkspace } from "../../../../features/workspaces/service";
type Context={params:Promise<{workspaceId:string}>};
export async function PATCH(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
  const actor=await getAuthenticatedDashboardActor(request);
  if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  let input:unknown;
  try {input=await request.json();}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400});}
  const {workspaceId}=await context.params;
  const result=await renameWorkspace(actor,workspaceId,input);
  return NextResponse.json(result,{status:result.ok?200:result.error==="FORBIDDEN"?403:400,headers:{"Cache-Control":"no-store"}});
}
