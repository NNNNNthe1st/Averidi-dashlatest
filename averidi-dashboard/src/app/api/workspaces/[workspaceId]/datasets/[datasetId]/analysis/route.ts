import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {requestDatasetAnalysis,readDatasetAnalysis} from '../../../../../../../features/analysis/service';
import {analysisHeaders as headers,analysisHttpError,analysisJson} from '../../../../../../../features/analysis/http';
type Context={params:Promise<{workspaceId:string;datasetId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'analysis.read');if(permissionDenied)return permissionDenied;

 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId,datasetId}=await context.params;
 try{return NextResponse.json(await readDatasetAnalysis(actor,workspaceId,datasetId),{headers});}catch(error){return analysisHttpError(error);}
}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'analysis.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403,headers});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 const {workspaceId,datasetId}=await context.params;
 try{const p=z.object({versionId:z.string().min(1).max(128),template:z.enum(['SALES','EXECUTIVE','CUSTOMER','FINANCIAL','PRODUCT','MARKETING','OPERATIONS','INVENTORY','CUSTOM']).optional()}).strict().safeParse(await analysisJson(request));if(!p.success)throw Error('INVALID_QUERY');return NextResponse.json(await requestDatasetAnalysis(actor,workspaceId,datasetId,p.data.versionId,p.data.template),{status:202,headers});}catch(error){return analysisHttpError(error);}
}
