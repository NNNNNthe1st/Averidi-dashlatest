import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {analysisJson,analysisHeaders as headers,analysisHttpError} from '../../../../../../../features/analysis/http';
import {readDashboardLayout,saveDashboardLayout} from '../../../../../../../features/views/layout-service';
type Context={params:Promise<{workspaceId:string;viewId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;
const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId,viewId}=await context.params;return NextResponse.json(await readDashboardLayout(actor,workspaceId,viewId),{headers});}catch(e){return analysisHttpError(e);}}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.manage');if(permissionDenied)return permissionDenied;
if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId,viewId}=await context.params;return NextResponse.json(await saveDashboardLayout(actor,workspaceId,viewId,await analysisJson(request)),{headers});}catch(e){if(e instanceof Error&&e.message==='INVALID_LAYOUT')return NextResponse.json({error:'INVALID_LAYOUT'},{status:422,headers});return analysisHttpError(e);}}
