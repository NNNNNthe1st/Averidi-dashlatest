import {enforceWorkspacePermission} from '../../../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getAuthenticatedDashboardActor} from '../../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../../server/request-origin';
import {analysisJson,analysisHeaders as headers,analysisHttpError} from '../../../../../../../features/analysis/http';
import {listFilterPresets,saveFilterPreset,removeFilterPreset} from '../../../../../../../features/views/exploration';
type Context={params:Promise<{workspaceId:string;viewId:string}>};
export async function GET(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;
const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId,viewId}=await context.params;return NextResponse.json({presets:await listFilterPresets(actor,workspaceId,viewId)},{headers});}catch(error){return analysisHttpError(error);}}
export async function POST(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;
if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const {workspaceId,viewId}=await context.params;return NextResponse.json({preset:await saveFilterPreset(actor,workspaceId,viewId,await analysisJson(request))},{status:201,headers});}catch(error){if(error instanceof Error&&error.message==='PRESET_LIMIT')return NextResponse.json({error:'PRESET_LIMIT'},{status:409,headers});return analysisHttpError(error);}}
export async function DELETE(request:Request,context:Context){
 const permissionDenied=await enforceWorkspacePermission(request,context,'views.read');if(permissionDenied)return permissionDenied;
if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const p=z.object({id:z.string().min(1).max(128)}).strict().safeParse(await analysisJson(request));if(!p.success)throw Error('INVALID_QUERY');const {workspaceId,viewId}=await context.params;return NextResponse.json(await removeFilterPreset(actor,workspaceId,viewId,p.data.id),{headers});}catch(error){return analysisHttpError(error);}}
