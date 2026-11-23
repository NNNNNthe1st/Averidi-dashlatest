import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {readWorkspaceDashboardData} from '../../../../../../../features/analysis/views';
import {exportDashboardMetricReport} from '../../../../../../../engines/reporting/metric-report';
import {analysisHeaders as headers,analysisHttpError,analysisJson} from '../../../../../../../features/analysis/http';
type Context={params:Promise<{workspaceId:string;viewId:string}>};
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.export');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId,viewId}=await context.params;
 try{const data=await readWorkspaceDashboardData(actor,workspaceId,viewId,await analysisJson(request));return new Response(exportDashboardMetricReport(data),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="dashboard-metrics.csv"','X-Content-Type-Options':'nosniff'}});}catch(error){return analysisHttpError(error);}
}
