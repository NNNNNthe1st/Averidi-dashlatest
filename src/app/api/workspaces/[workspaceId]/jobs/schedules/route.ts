import {setAuditActor} from '../../../../../../features/audit/context';
import {assertDashboardAdmission} from '../../../../../../features/administration/configuration';
import {assertCustomPermission} from '../../../../../../features/permissions/policy';
import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {authorizedView,assertReportView,memberViewWhere} from '../../../../../../features/sharing/access';
import {authorizeReportWork,authorizeReportRecipients} from '../../../../../../features/sharing/report-access';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {dashboardDb} from '../../../../../../server/db';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {requireAnalysisAccess} from '../../../../../../features/analysis/service';
import {scheduleDashboardJob} from '../../../../../../worker/queue';
import {assertReportScheduleRecipients} from '../../../../../../worker/resource-scope';
import {workerHeaders as headers,workerHttpError,workerJson} from '../../../../../../worker/http';
type Context={params:Promise<{workspaceId:string}>};
const common={intervalSeconds:z.number().int().min(60).max(2592000),nextRunAt:z.string().datetime({offset:true})};
const schema=z.discriminatedUnion('type',[
 z.object({type:z.literal('JOB'),kind:z.string().min(1).max(80),payload:z.unknown(),...common}).strict(),
 z.object({type:z.literal('REPORT'),reportId:z.string().min(1).max(128),recipients:z.unknown(),...common}).strict(),
]);
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'jobs.read');if(permissionDenied)return permissionDenied;
const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId}=await context.params;
 try{await requireAnalysisAccess(actor,workspaceId,'EDITOR');const allowed=await memberViewWhere(actor.userId,workspaceId,'EDIT');const [jobs,reports]=await Promise.all([dashboardDb.dashboardJobSchedule.findMany({where:{workspaceId},select:{id:true,kind:true,intervalSeconds:true,nextRunAt:true,enabled:true,lastErrorCode:true},take:100}),dashboardDb.dashboardReportSchedule.findMany({where:{workspaceId,report:{OR:[{viewId:null},{view:allowed}]}},select:{id:true,reportId:true,intervalSeconds:true,nextRunAt:true,enabled:true,lastErrorCode:true},take:100})]);return NextResponse.json({jobs,reports},{headers});}catch(error){return workerHttpError(error);}}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'jobs.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId}=await context.params;
 try{await requireAnalysisAccess(actor,workspaceId,'EDITOR');const p=schema.safeParse(await workerJson(request));if(!p.success)throw Error('INVALID_SCHEDULE');const v=p.data;if(v.type==='REPORT')await assertCustomPermission(actor,workspaceId,'reports.manage');if(v.type==='JOB')await authorizeReportWork(actor,workspaceId,v.kind,v.payload);
 const schedule=v.type==='JOB'?await scheduleDashboardJob(workspaceId,v.kind,v.payload,v.intervalSeconds,new Date(v.nextRunAt)):await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor);await assertDashboardAdmission(tx,'SCHEDULE_CREATION_ENABLED');if(!await tx.dashboardReportDefinition.count({where:{id:v.reportId,workspaceId}}))throw Error('REPORT_UNAVAILABLE');const report=await tx.dashboardReportDefinition.findFirstOrThrow({where:{id:v.reportId,workspaceId}});await assertReportView(actor,workspaceId,report.viewId,'EDIT',tx);const recipients=await assertReportScheduleRecipients(tx,workspaceId,v.recipients);await authorizeReportRecipients(tx,workspaceId,report.viewId,recipients);return tx.dashboardReportSchedule.create({data:{workspaceId,reportId:v.reportId,recipients,intervalSeconds:v.intervalSeconds,nextRunAt:new Date(v.nextRunAt),enabled:true}});});return NextResponse.json({schedule:{id:schedule.id,nextRunAt:schedule.nextRunAt,enabled:schedule.enabled}},{status:201,headers});
 }catch(error){return workerHttpError(error);}
}
export async function DELETE(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'jobs.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId}=await context.params;
 try{await requireAnalysisAccess(actor,workspaceId,'EDITOR');const p=z.object({type:z.enum(['JOB','REPORT']),id:z.string().min(1).max(128)}).strict().safeParse(await workerJson(request));if(!p.success)throw Error('INVALID_SCHEDULE');if(p.data.type==='REPORT'){const schedule=await dashboardDb.dashboardReportSchedule.findFirst({where:{id:p.data.id,workspaceId},include:{report:true}});if(!schedule)throw Error('SCHEDULE_UNAVAILABLE');await assertReportView(actor,workspaceId,schedule.report.viewId,'EDIT');}else{const schedule=await dashboardDb.dashboardJobSchedule.findFirst({where:{id:p.data.id,workspaceId}});if(schedule)await authorizeReportWork(actor,workspaceId,schedule.kind,schedule.payload);}const changed=p.data.type==='JOB'?await dashboardDb.dashboardJobSchedule.updateMany({where:{id:p.data.id,workspaceId},data:{enabled:false}}):await dashboardDb.dashboardReportSchedule.updateMany({where:{id:p.data.id,workspaceId},data:{enabled:false}});return NextResponse.json({disabled:changed.count===1},{headers});}catch(error){return workerHttpError(error);}
}
