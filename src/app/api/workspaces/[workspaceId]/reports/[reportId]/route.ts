import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {analysisJson,analysisHeaders,analysisHttpError} from '../../../../../../features/analysis/http';
import {saveReportDefinition} from '../../../../../../features/reports/definitions';
export async function PATCH(request:Request,context:{params:Promise<{workspaceId:string;reportId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'reports.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers:analysisHeaders});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:analysisHeaders});
 try{const {workspaceId,reportId}=await context.params;return NextResponse.json({report:await saveReportDefinition(actor,workspaceId,await analysisJson(request,65536),reportId)},{headers:analysisHeaders});}catch(error){if(error instanceof Error&&error.message==='INVALID_REPORT_DEFINITION')return NextResponse.json({error:error.message},{status:400,headers:analysisHeaders});return analysisHttpError(error);}
}
