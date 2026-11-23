import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {memberViewWhere} from '../../../../../../features/sharing/access';
import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../../../server/db';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {requireAnalysisAccess} from '../../../../../../features/analysis/service';
import {queueInAppReportDelivery} from '../../../../../../features/reports/delivery';
import {workerHeaders as headers,workerHttpError,workerJson} from '../../../../../../worker/http';
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'reports.read');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId}=await context.params;
 try{await requireAnalysisAccess(actor,workspaceId,'VIEWER');const allowed=await memberViewWhere(actor.userId,workspaceId);const deliveries=await dashboardDb.dashboardReportDelivery.findMany({where:{workspaceId,destination:'user:'+actor.userId,status:'DELIVERED',export:{report:{OR:[{viewId:null},{view:allowed}]},AND:[{OR:[{sourceViewId:null},{sourceView:allowed}]}],status:'READY',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}},select:{id:true,exportId:true,deliveredAt:true},orderBy:{deliveredAt:'desc'},take:100});return NextResponse.json({deliveries},{headers});}catch(error){return workerHttpError(error);}
}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'reports.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId}=await context.params;
 try{return NextResponse.json(await queueInAppReportDelivery(actor,workspaceId,await workerJson(request),request.headers.get('idempotency-key')??''),{status:202,headers});}catch(error){return workerHttpError(error);}
}
