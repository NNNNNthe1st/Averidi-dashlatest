import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {NextResponse} from "next/server";
import {getAuthenticatedDashboardActor} from "../../../../../server/auth-boundary";
import {workspaceDashboardEntitlement} from "../../../../../features/subscriptions/entitlements";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'workspace.read');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 const {workspaceId}=await context.params;
 const entitlement=await workspaceDashboardEntitlement(actor,workspaceId);
 if(!entitlement)return NextResponse.json({error:"FORBIDDEN"},{status:403});
 return NextResponse.json({entitlement},{headers:{"Cache-Control":"private, no-store"}});
}
