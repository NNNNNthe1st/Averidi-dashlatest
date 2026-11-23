import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import { NextResponse } from "next/server";
import { getAuthenticatedDashboardActor } from "../../../../../server/auth-boundary";
import { listWorkspaceMembers } from "../../../../../features/workspaces/service";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 const {workspaceId}=await context.params;
 const members=await listWorkspaceMembers(actor,workspaceId);
 if(!members)return NextResponse.json({error:"FORBIDDEN"},{status:403});
 return NextResponse.json({members},{headers:{"Cache-Control":"private, no-store"}});
}
