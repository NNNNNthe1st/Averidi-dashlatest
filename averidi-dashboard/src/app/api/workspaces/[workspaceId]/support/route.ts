import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {requireWorkspaceRole} from '../../../../../server/workspace-access';
import {billingJson,billingError,billingBody} from '../../../../../features/billing/http';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {dashboardDb as db} from '../../../../../server/db';
import {readAdminPage,adminPageResult} from '../../../../../server/admin-pagination';
import {createSupportCase} from '../../../../../features/administration/support';
type C={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,c:C){
 const permissionDenied=await enforceWorkspacePermission(request,c,'support.read');if(permissionDenied)return permissionDenied;
try{const actor=await getAuthenticatedDashboardActor(request);const {workspaceId}=await c.params;if(!actor||!await requireWorkspaceRole(actor,workspaceId,'VIEWER'))throw Error('FORBIDDEN');const page=readAdminPage(request);if(!page)return billingJson({error:'INVALID_PAGINATION'},400);return billingJson(adminPageResult(await db.dashboardSupportCase.findMany({where:{workspaceId,requesterId:actor.userId},orderBy:{id:'asc'},take:page.take,cursor:page.cursor,skip:page.skip,select:{id:true,subject:true,status:true,updatedAt:true,createdAt:true}}),page.limit));}catch(e){return billingError(e);}}
export async function POST(request:Request,c:C){
 const permissionDenied=await enforceWorkspacePermission(request,c,'support.create');if(permissionDenied)return permissionDenied;
try{const actor=await getAuthenticatedDashboardActor(request);if(!actor||!dashboardSameOrigin(request))throw Error('FORBIDDEN');const {workspaceId}=await c.params;return billingJson({supportCase:await createSupportCase(workspaceId,await billingBody(request),actor)},201);}catch(e){return billingError(e);}}
