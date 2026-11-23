import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {z} from 'zod';
import {workerErrorCode} from '../../../../../worker/job-claim';
import {workerJson,workerHttpError} from '../../../../../worker/http';
import {NextResponse} from 'next/server';
import {dashboardDb} from '../../../../../server/db';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {requireWorkspaceRole} from '../../../../../server/workspace-access';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {enqueueActorDashboardJob} from '../../../../../worker/queue';
type Context={params:Promise<{workspaceId:string}>};
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'jobs.read');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId}=await context.params;
 if(!await requireWorkspaceRole(actor,workspaceId,'VIEWER'))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});
 const jobs=await dashboardDb.dashboardJob.findMany({where:{workspaceId},select:{id:true,kind:true,status:true,progress:true,attempts:true,lastError:true,createdAt:true,finishedAt:true,cancelRequestedAt:true},orderBy:{createdAt:'desc'},take:100});
 return NextResponse.json({jobs:jobs.map(({lastError,...job})=>({...job,errorCode:lastError?workerErrorCode(lastError):null}))},{headers});
}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'jobs.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);
 if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId}=await context.params;
 try{
  const parsed=z.object({kind:z.string().min(1).max(80),payload:z.unknown()}).strict().safeParse(await workerJson(request));if(!parsed.success)throw Error('INVALID_JOB_PAYLOAD');const input=parsed.data;
  const job=await enqueueActorDashboardJob(actor,workspaceId,input.kind,input.payload,request.headers.get('idempotency-key')??'');
  return NextResponse.json({job:{id:job.id,status:job.status}},{status:202,headers});
 }catch(error){return workerHttpError(error);}
}
