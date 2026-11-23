import {auditedWrite} from '../../../../../../../features/audit/service';
import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {POST as uploadVersion} from '../versions/route';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardDb} from '../../../../../../../server/db';
import {requireWorkspaceRole} from '../../../../../../../server/workspace-access';
import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;datasetId:string}>}){
 const denied=await enforceWorkspacePermission(request,context,'datasets.write');if(denied)return denied;
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 const {workspaceId,datasetId}=await context.params;
 if(!await requireWorkspaceRole(actor,workspaceId,'EDITOR'))return NextResponse.json({error:'FORBIDDEN'},{status:403});
 const views=await dashboardDb.dashboardView.findMany({where:{workspaceId,datasetId},select:{definition:true}});
 if(views.some(v=>(v.definition as {template?:string})?.template!=='SALES'))return NextResponse.json({error:'SALES_SOURCE_SHARED'},{status:409});
 const uploadHeaders=new Headers(request.headers);uploadHeaders.set('X-Averidi-Sales-Upload','1');
 const guardedRequest=new Request(request,{headers:uploadHeaders});
 const response=await uploadVersion(guardedRequest,context);
 if(response.status===202){
  try{const versionId=(await response.clone().json()).version.id;const name=decodeURIComponent(request.headers.get('X-Sales-File-Name')??'');
   if(name&&name.length<=255&&!/[\\/\x00-\x1f]/.test(name))await auditedWrite(actor,async tx=>{const version=await tx.dashboardDatasetVersion.findFirst({where:{id:versionId,datasetId},select:{importSummary:true}});if(version)await tx.dashboardDatasetVersion.update({where:{id:versionId},data:{importSummary:{...(version.importSummary as Prisma.JsonObject??{}),salesFileName:name}}});});
  }catch{/* An optional display filename must never turn a successful upload into a retry. */}
 }
 return response;
}
