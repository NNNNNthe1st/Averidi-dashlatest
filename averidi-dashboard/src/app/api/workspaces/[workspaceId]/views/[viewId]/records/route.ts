import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {analysisJson,analysisHeaders as headers,analysisHttpError} from '../../../../../../../features/analysis/http';
import {readDrilldownRecords} from '../../../../../../../features/views/exploration';
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;viewId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'datasets.read');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 try{const {workspaceId,viewId}=await context.params;return NextResponse.json(await readDrilldownRecords(actor,workspaceId,viewId,await analysisJson(request)),{headers});}catch(error){return analysisHttpError(error);}
}
