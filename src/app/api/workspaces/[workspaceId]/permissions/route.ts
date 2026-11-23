import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {workspacePolicy} from '../../../../../features/permissions/policy';
export async function GET(request:Request,c:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,c,'workspace.read');if(permissionDenied)return permissionDenied;
const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401});const policy=await workspacePolicy(actor.userId,(await c.params).workspaceId);return NextResponse.json(policy??{error:'FORBIDDEN'},{status:policy?200:403,headers:{'Cache-Control':'private, no-store'}});}
