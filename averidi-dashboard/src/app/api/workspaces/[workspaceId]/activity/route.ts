import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {workspaceMutationAudit} from '../../../../../features/audit/service';
import {headers,accountError} from '../../../../../features/organizations/http';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){const denied=await enforceWorkspacePermission(request,context,'owner');if(denied)return denied;const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{return NextResponse.json(await workspaceMutationAudit(actor,(await context.params).workspaceId,request),{headers});}catch(e){return accountError(e);}}
