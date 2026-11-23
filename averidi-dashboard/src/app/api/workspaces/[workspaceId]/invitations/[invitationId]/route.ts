import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../../../server/request-origin";
import {NextResponse} from "next/server";
import {getAuthenticatedDashboardActor} from "../../../../../../server/auth-boundary";
import {revokeWorkspaceInvitation} from "../../../../../../features/workspaces/invitations";
type C={params:Promise<{workspaceId:string;invitationId:string}>};
export async function DELETE(request:Request,context:C){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 const {workspaceId,invitationId}=await context.params;
 const result=await revokeWorkspaceInvitation(actor,workspaceId,invitationId);
 return NextResponse.json(result,{status:result.ok?200:result.error==="FORBIDDEN"?403:404,headers:{"Cache-Control":"no-store"}});
}
