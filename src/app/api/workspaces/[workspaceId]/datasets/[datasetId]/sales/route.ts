import {NextResponse} from 'next/server';
import {z} from 'zod';
import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {analysisJson,analysisHttpError} from '../../../../../../../features/analysis/http';
import {prepareSales} from '../../../../../../../features/sales/preparation';
import {salesAnswersSchema} from '../../../../../../../engines/sales/contracts';
const schema=z.object({versionId:z.string().min(1).max(128),answers:salesAnswersSchema.optional(),clearAnswers:z.array(z.string().refine(key=>Object.hasOwn(salesAnswersSchema.shape,key))).max(50).optional(),previousAnalysisId:z.string().max(128).optional()}).strict();
export async function POST(request:Request,context:{params:Promise<{workspaceId:string;datasetId:string}>}){
 const denied=await enforceWorkspacePermission(request,context,'analysis.manage');if(denied)return denied;
 if(!dashboardSameOrigin(request))return NextResponse.json({error:'CROSS_ORIGIN_REQUEST'},{status:403});
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 try{const input=schema.safeParse(await analysisJson(request));if(!input.success)throw Error('INVALID_QUERY');const {workspaceId,datasetId}=await context.params;
  return NextResponse.json(await prepareSales(actor,workspaceId,datasetId,input.data),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){if(error instanceof Error&&error.message==='INVALID_SALES_ANSWERS')return NextResponse.json({error:'INVALID_SALES_ANSWERS'},{status:422});return analysisHttpError(error);}
}
