import {quotaHttpError} from '../../../../../features/quotas/http';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import { dashboardSameOrigin } from "../../../../../server/request-origin";
import {NextResponse} from "next/server";
import {getAuthenticatedDashboardActor} from "../../../../../server/auth-boundary";
import {createWorkspaceInvitation,listWorkspaceInvitations} from "../../../../../features/workspaces/invitations";
type C={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:C){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 const {workspaceId}=await context.params;
 const items=await listWorkspaceInvitations(actor,workspaceId);
 return items?NextResponse.json({invitations:items},{headers:{"Cache-Control":"private, no-store"}}):NextResponse.json({error:"FORBIDDEN"},{status:403});
}
export async function POST(request:Request,context:C){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:"CROSS_ORIGIN_REQUEST"},{status:403,headers:{"Cache-Control":"no-store"}});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
 let input:unknown;try{input=await request.json();}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400});}
 const {workspaceId}=await context.params;
 const role=input&&typeof input==="object"&&"role" in input?(input as {role:unknown}).role:null;
 try {const result=await createWorkspaceInvitation(actor,workspaceId,role);
 return NextResponse.json(result,{status:result.ok?201:result.error==="FORBIDDEN"?403:400,headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const policy=quotaHttpError(error);if(policy)return policy;throw error;}
}
