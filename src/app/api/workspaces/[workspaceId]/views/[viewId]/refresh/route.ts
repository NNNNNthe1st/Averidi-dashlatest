import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {refreshWorkspaceDashboard} from '../../../../../../../features/analysis/views';
import {analysisHeaders as headers,analysisHttpError,analysisJson} from '../../../../../../../features/analysis/http';
type Context={params:Promise<{workspaceId:string;viewId:string}>};
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId,viewId}=await context.params;
 try{const body=z.object({expectedUpdatedAt:z.string()}).strict().safeParse(await analysisJson(request));if(!body.success)throw Error('INVALID_VIEW');return NextResponse.json(await refreshWorkspaceDashboard(actor,workspaceId,viewId,body.data.expectedUpdatedAt),{headers});}catch(error){return analysisHttpError(error);}
}
