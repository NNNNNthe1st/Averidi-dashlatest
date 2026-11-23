import {REPORT_TYPES,reportFormatSchema} from '../../../../../../../features/reports/settings';
import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {authorizedView,assertReportView} from '../../../../../../../features/sharing/access';
import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardDb} from '../../../../../../../server/db';
import {readDashboardObject,dashboardWorkspaceArtifactKey} from '../../../../../../../server/storage';
import {requireAnalysisAccess} from '../../../../../../../features/analysis/service';
import {workerHeaders as headers,workerHttpError} from '../../../../../../../worker/http';
type Context={params:Promise<{workspaceId:string;exportId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'reports.export');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});const {workspaceId,exportId}=await context.params;
 try{await requireAnalysisAccess(actor,workspaceId,'VIEWER');const artifact=await dashboardDb.dashboardReportExport.findFirst({where:{id:exportId,workspaceId,status:'READY',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});if(!artifact?.storageKey)throw Error('REPORT_UNAVAILABLE');
 const report=await dashboardDb.dashboardReportDefinition.findFirst({where:{id:artifact.reportId,workspaceId}});if(!report)throw Error('REPORT_UNAVAILABLE');await assertReportView(actor,workspaceId,report.viewId);await assertReportView(actor,workspaceId,artifact.sourceViewId);
 if(artifact.storageKey!==dashboardWorkspaceArtifactKey('reports',workspaceId,exportId))throw Error('REPORT_UNAVAILABLE');const bytes=await readDashboardObject(artifact.storageKey);if(BigInt(bytes.length)!==artifact.fileSize||createHash('sha256').update(bytes).digest('hex')!==artifact.checksum)throw Error('REPORT_UNAVAILABLE');
 await assertReportView(actor,workspaceId,report.viewId);await assertReportView(actor,workspaceId,artifact.sourceViewId);
 const parsed=reportFormatSchema.safeParse(artifact.format);if(!parsed.success)throw Error('REPORT_UNAVAILABLE');const descriptor=REPORT_TYPES[parsed.data];
 return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':descriptor.mime,'Content-Disposition':'attachment; filename="dashboard-report.'+descriptor.extension+'"','Content-Length':String(bytes.length),'X-Content-Type-Options':'nosniff'}});
 }catch(error){return workerHttpError(error);}
}
