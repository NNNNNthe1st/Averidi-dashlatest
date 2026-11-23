import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {analysisJson,analysisHeaders as headers,analysisHttpError} from '../../../../../../../features/analysis/http';
import {readSharing,mutateSharing} from '../../../../../../../features/sharing/service';
type Context={params:Promise<{workspaceId:string;viewId:string}>};
function error(e:unknown){if(e instanceof Error&&['INVALID_SHARING','INVALID_MEMBER','SHARING_LIMIT'].includes(e.message))return NextResponse.json({error:e.message},{status:e.message==='SHARING_LIMIT'?409:422,headers});return analysisHttpError(e);}
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;
const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId,viewId}=await context.params;return NextResponse.json(await readSharing(actor,workspaceId,viewId),{headers});}catch(e){return error(e);}}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId,viewId}=await context.params;return NextResponse.json(await mutateSharing(actor,workspaceId,viewId,await analysisJson(request)),{headers});}catch(e){return error(e);}}
