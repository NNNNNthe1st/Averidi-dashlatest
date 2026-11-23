import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {analysisJson} from '../../../../../features/analysis/http';
import {headers,accountError} from '../../../../../features/organizations/http';
import {listTeams,mutateTeam} from '../../../../../features/teams/service';
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'teams.read');if(permissionDenied)return permissionDenied;
const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{return NextResponse.json(await listTeams(actor,(await context.params).workspaceId),{headers});}catch(error){return accountError(error);}}
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,context,'owner');if(permissionDenied)return permissionDenied;
if(!dashboardSameOrigin(request))return NextResponse.json({error:'FORBIDDEN'},{status:403,headers});const actor=await getAuthenticatedDashboardActor(request);if(!actor)return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers});try{const input=await analysisJson(request);return NextResponse.json(await mutateTeam(actor,(await context.params).workspaceId,input),{headers});}catch(error){return accountError(error);}}
