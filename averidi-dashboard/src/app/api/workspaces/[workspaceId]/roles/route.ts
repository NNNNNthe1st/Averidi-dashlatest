import {quotaHttpError} from '../../../../../features/quotas/http';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {NextResponse} from 'next/server';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {analysisJson} from '../../../../../features/analysis/http';
import {listWorkspaceRoles,mutateWorkspaceRole} from '../../../../../features/permissions/service';
const headers={'Cache-Control':'private, no-store'};
function error(e:unknown){const policy=quotaHttpError(e);if(policy)return policy;const code=e instanceof Error?e.message:'';const status=code==='FORBIDDEN'?403:code==='NOT_FOUND'?404:code==='INVALID_PERMISSIONS'?400:['ROLE_CONFLICT','ROLE_IN_USE','ROLE_LIMIT','OWNER_ROLE_PROTECTED'].includes(code)?409:503;return NextResponse.json({error:status===503?'PERMISSIONS_UNAVAILABLE':code},{status,headers});}
export async function GET(request:Request,c:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,c,'owner');if(permissionDenied)return permissionDenied;
try{const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('FORBIDDEN');return NextResponse.json(await listWorkspaceRoles(actor,(await c.params).workspaceId),{headers});}catch(e){return error(e);}}
export async function POST(request:Request,c:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,c,'owner');if(permissionDenied)return permissionDenied;
try{if(!dashboardSameOrigin(request))throw Error('FORBIDDEN');const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('FORBIDDEN');let body;try{body=await analysisJson(request);}catch{throw Error('INVALID_PERMISSIONS');}return NextResponse.json(await mutateWorkspaceRole(actor,(await c.params).workspaceId,body),{headers});}catch(e){return error(e);}}
