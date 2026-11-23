import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {analysisJson,analysisHeaders as headers,analysisHttpError} from '../../../../../../features/analysis/http';
import {redeemShare} from '../../../../../../features/sharing/service';
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;
if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId}=await context.params;return NextResponse.json(await redeemShare(actor,workspaceId,await analysisJson(request)),{headers});}catch(e){if(e instanceof Error&&['INVALID_SHARE','SHARING_LIMIT'].includes(e.message))return NextResponse.json({error:e.message},{status:e.message==='SHARING_LIMIT'?409:404,headers});return analysisHttpError(e);}}
