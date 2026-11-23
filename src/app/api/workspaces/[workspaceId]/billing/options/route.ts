import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {z} from 'zod';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {billingJson,billingError,billingBody} from '../../../../../../features/billing/http';
import {customerBillingOptions} from '../../../../../../features/billing/self-service';
export async function GET(request:Request,c:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,c,'owner');if(permissionDenied)return permissionDenied;
try{
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('FORBIDDEN');const {workspaceId}=await c.params;
 return billingJson(await customerBillingOptions(actor,workspaceId));
}catch(error){return billingError(error);}}
