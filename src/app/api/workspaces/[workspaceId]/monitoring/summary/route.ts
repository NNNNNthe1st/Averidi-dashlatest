import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {requireAnalysisAccess} from '../../../../../../features/analysis/service';
import {analysisHeaders,analysisHttpError} from '../../../../../../features/analysis/http';
import {dashboardDb as db} from '../../../../../../server/db';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const denied=await enforceWorkspacePermission(request,context,'monitoring.read');if(denied)return denied;
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:analysisHeaders});
 try{const {workspaceId}=await context.params;await requireAnalysisAccess(actor,workspaceId,'VIEWER');
  const [source,business]=await Promise.all([db.dashboardSourceIncident.count({where:{workspaceId,status:'OPEN'}}),db.dashboardAlertEvent.count({where:{workspaceId,status:'OPEN'}})]);
  return NextResponse.json({open:source+business},{headers:analysisHeaders});
 }catch(e){return analysisHttpError(e);}
}
