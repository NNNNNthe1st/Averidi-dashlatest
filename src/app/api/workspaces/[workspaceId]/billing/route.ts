import {workspaceDashboardTrial,workspaceDashboardEntitlement} from '../../../../../features/subscriptions/entitlements';
import {enforceWorkspacePermission} from '../../../../../features/permissions/http';
import {getAuthenticatedDashboardActor} from '../../../../../server/auth-boundary';
import {requireWorkspaceRole} from '../../../../../server/workspace-access';
import {billingJson,billingError,billingBody} from '../../../../../features/billing/http';
import {dashboardSameOrigin} from '../../../../../server/request-origin';
import {dashboardDb as db} from '../../../../../server/db';
import {readAdminPage,adminPageResult} from '../../../../../server/admin-pagination';
export async function GET(request:Request,c:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,c,'owner');if(permissionDenied)return permissionDenied;
try{const actor=await getAuthenticatedDashboardActor(request);const {workspaceId}=await c.params;if(!actor||!await requireWorkspaceRole(actor,workspaceId,'OWNER'))throw Error('FORBIDDEN');const page=readAdminPage(request);if(!page)return billingJson({error:'INVALID_PAGINATION'},400);const [subscription,binding,invoices,trial,entitlement]=await Promise.all([db.dashboardSubscription.findUnique({where:{workspaceId},select:{planCode:true,status:true,currentPeriodEnd:true,accessSuspended:true,billingPlan:{select:{name:true,entitlements:true,active:true}}}}),db.dashboardBillingBinding.findUnique({where:{workspaceId},select:{cancelAtPeriodEnd:true,reconciledAt:true}}),db.dashboardInvoice.findMany({where:{workspaceId},orderBy:{id:'asc'},take:page.take,cursor:page.cursor,skip:page.skip,select:{id:true,currency:true,amount:true,status:true,periodStart:true,periodEnd:true,paidAt:true}}),workspaceDashboardTrial(actor,workspaceId),workspaceDashboardEntitlement(actor,workspaceId)]);return billingJson({subscription,binding,trial,entitlement,invoices:adminPageResult(invoices,page.limit)});}catch(e){return billingError(e);}}
