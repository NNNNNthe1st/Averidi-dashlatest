import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../../../server/request-origin";
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../../server/auth-boundary";
import { changeWorkspaceMemberRole, removeWorkspaceMember } from "../../../../../../features/workspaces/service";
type Context={params:Promise<{workspaceId:string;userId:string}>};
export async function PATCH(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 let input:unknown;
 try{input=await request.json();}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400});}
 if(!input || typeof input!=="object" || !("role" in input))return NextResponse.json({error:"INVALID_ROLE"},{status:400});
 const {workspaceId,userId}=await context.params;
 const result=await changeWorkspaceMemberRole(actor,workspaceId,userId,(input as {role:unknown}).role);
 return NextResponse.json(result,{status:result.ok?200:result.error==="FORBIDDEN"?403:result.error==="NOT_FOUND"?404:result.error==="CONFLICT"?409:400,headers:{"Cache-Control":"no-store"}});
}

export async function DELETE(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 const {workspaceId,userId}=await context.params;
 const result=await removeWorkspaceMember(actor,workspaceId,userId);
 return NextResponse.json(result,{status:result.ok?200:result.error==="FORBIDDEN"?403:result.error==="NOT_FOUND"?404:409,headers:{"Cache-Control":"no-store"}});
}
