import {salesBreakdownsSchema} from '../../../../../../../engines/sales/hierarchy';
import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {readWorkspaceDashboardData} from '../../../../../../../features/analysis/views';
import {analysisHeaders as headers,analysisHttpError,analysisJson} from '../../../../../../../features/analysis/http';
type Context={params:Promise<{workspaceId:string;viewId:string}>};
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId,viewId}=await context.params;
 try{const raw=request.headers.get('X-Sales-Breakdowns');if(raw&&raw.length>1024)throw Error('INVALID_QUERY');let input:unknown={};if(raw){try{input=JSON.parse(raw);}catch{throw Error('INVALID_QUERY');}}const breakdowns=salesBreakdownsSchema.safeParse(input);if(!breakdowns.success)throw Error('INVALID_QUERY');const data=await readWorkspaceDashboardData(actor,workspaceId,viewId,await analysisJson(request),breakdowns.data);return NextResponse.json(data,{headers});}catch(error){return analysisHttpError(error);}
}
