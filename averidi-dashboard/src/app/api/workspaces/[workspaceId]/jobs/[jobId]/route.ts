import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {cancelActorDashboardJob} from '../../../../../../worker/queue';
export async function DELETE(request:Request,context:{params:Promise<{workspaceId:string;jobId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'jobs.manage');if(permissionDenied)return permissionDenied;

 const headers={'Cache-Control':'private, no-store'};
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId,jobId}=await context.params;
 try{
  const job=await cancelActorDashboardJob(actor,workspaceId,jobId);
  return NextResponse.json(job?{job}:{error:'NOT_FOUND'},{status:job?200:404,headers});
 }catch{return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});}
}
