import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../server/auth-boundary';
import {workspacePolicy} from './policy';
import type {WorkspacePermission} from './catalog';
export async function enforceWorkspacePermission(request:Request,context:{params:Promise<{workspaceId:string}>},permission:WorkspacePermission|'owner'){
 try{const actor=await getAuthenticatedDashboardActor(request);if(actor){const {workspaceId}=await context.params;const policy=await workspacePolicy(actor.userId,workspaceId);if(policy?.restricted&&(permission==='owner'||!policy.permissions.includes(permission)))throw Error('FORBIDDEN');}return null;}
 catch(error){return NextResponse.json({error:error instanceof Error&&error.message==='FORBIDDEN'?'FORBIDDEN':'PERMISSIONS_UNAVAILABLE'},{status:error instanceof Error&&error.message==='FORBIDDEN'?403:503,headers:{'Cache-Control':'private, no-store'}});}
}
