import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {readWorkspacePresentation,updateWorkspacePresentation} from '../../../../../features/workspaces/presentation';
import {analysisJson} from '../../../../../features/analysis/http';
const headers={'Cache-Control':'private, no-store'};
type Context={params:Promise<{workspaceId:string}>};
function failure(error:unknown){const code=error instanceof Error?error.message:'';const status=code==='FORBIDDEN'?403:code==='WORKSPACE_PRESENTATION_CONFLICT'?409:code==='INVALID_WORKSPACE_PRESENTATION'||code==='INVALID_QUERY'?400:503;return NextResponse.json({error:status===503?'WORKSPACE_PRESENTATION_UNAVAILABLE':code},{status,headers});}
export async function GET(request:Request,context:Context){
 const denied=await enforceWorkspacePermission(request,context,'workspace.read');if(denied)return denied;
 try{const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId}=await context.params;return NextResponse.json(await readWorkspacePresentation(actor,workspaceId),{headers});}catch(error){return failure(error);}}
export async function PUT(request:Request,context:Context){
 const denied=await enforceWorkspacePermission(request,context,'owner');if(denied)return denied;
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 try{const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId}=await context.params;return NextResponse.json(await updateWorkspacePresentation(actor,workspaceId,await analysisJson(request)),{headers});}catch(error){return failure(error);}
}
