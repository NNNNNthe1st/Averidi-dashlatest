import {saveSourceMonitoringPolicy,acknowledgeSourceIncident} from '../../../../../features/monitoring/sources';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {analysisJson,analysisHeaders as headers,analysisHttpError} from '../../../../../features/analysis/http';
import {listMonitoring,saveTarget,removeTarget,saveAlert,evaluateAlert,acknowledgeAlert} from '../../../../../features/monitoring/service';
type Context={params:Promise<{workspaceId:string}>};
const commandSchema=z.object({action:z.enum(['SAVE_SOURCE_POLICY','ACK_SOURCE_INCIDENT','SAVE_TARGET','REMOVE_TARGET','SAVE_ALERT','EVALUATE_ALERT','ACKNOWLEDGE_ALERT']),input:z.unknown(),expected:z.unknown().optional()}).strict();
function errorResponse(error:unknown){if(error instanceof Error&&error.message==='TARGET_IN_USE')return NextResponse.json({error:'TARGET_IN_USE'},{status:409,headers});if(error instanceof Error&&error.message==='ALERT_UNAVAILABLE')return NextResponse.json({error:'ALERT_UNAVAILABLE'},{status:404,headers});return analysisHttpError(error);}
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'monitoring.read');if(permissionDenied)return permissionDenied;
const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId}=await context.params;return NextResponse.json(await listMonitoring(actor,workspaceId),{headers});}catch(error){return errorResponse(error);}}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'monitoring.manage');if(permissionDenied)return permissionDenied;

 if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});
 try{const parsed=commandSchema.safeParse(await analysisJson(request));if(!parsed.success)throw Error('INVALID_QUERY');const {workspaceId}=await context.params,{action,input,expected}=parsed.data;
  if(action==='SAVE_SOURCE_POLICY')return NextResponse.json({policy:await saveSourceMonitoringPolicy(actor,workspaceId,input)},{headers});
  if(action==='ACK_SOURCE_INCIDENT')return NextResponse.json(await acknowledgeSourceIncident(actor,workspaceId,input),{headers});
  if(action==='SAVE_TARGET')return NextResponse.json({target:await saveTarget(actor,workspaceId,input,expected)},{headers});
  if(action==='REMOVE_TARGET')return NextResponse.json(await removeTarget(actor,workspaceId,input),{headers});
  if(action==='SAVE_ALERT')return NextResponse.json({rule:await saveAlert(actor,workspaceId,input,expected)},{headers});
  const id=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)}).strict().safeParse(input);if(!id.success)throw Error('INVALID_QUERY');
  if(action==='ACKNOWLEDGE_ALERT')return NextResponse.json(await acknowledgeAlert(actor,workspaceId,id.data.id),{headers});
  const job=await evaluateAlert(actor,workspaceId,id.data.id,request.headers.get('Idempotency-Key')??'');return NextResponse.json({jobId:job.id},{status:202,headers});
 }catch(error){return errorResponse(error);}
}
