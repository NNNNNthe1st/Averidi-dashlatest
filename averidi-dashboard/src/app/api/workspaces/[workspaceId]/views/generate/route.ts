import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {generateWorkspaceDashboard} from '../../../../../../features/analysis/views';
import {analysisHeaders as headers,analysisHttpError,analysisJson} from '../../../../../../features/analysis/http';
type Context={params:Promise<{workspaceId:string}>};
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId}=await context.params;
 try{const data=await generateWorkspaceDashboard(actor,workspaceId,await analysisJson(request));return NextResponse.json({view:data},{headers});}catch(error){return analysisHttpError(error);}
}
