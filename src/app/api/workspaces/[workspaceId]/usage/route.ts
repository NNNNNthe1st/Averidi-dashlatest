import {NextResponse} from 'next/server';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {readWorkspaceQuotaUsage} from '../../../../../features/quotas/service';
import {analysisHeaders,analysisHttpError} from '../../../../../features/analysis/http';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const denied=await enforceWorkspacePermission(request,context,'workspace.read');if(denied)return denied;
 try{const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:analysisHeaders});return NextResponse.json(await readWorkspaceQuotaUsage(actor,(await context.params).workspaceId),{headers:analysisHeaders});}catch(error){return analysisHttpError(error);}
}
