import {enforceWorkspacePermission} from '../../../../../../features/permissions/http';
import {z} from 'zod';
import {getAuthenticatedDashboardActor} from '../../../../../../server/auth-boundary';
import {dashboardSameOrigin} from '../../../../../../server/request-origin';
import {billingJson,billingError,billingBody} from '../../../../../../features/billing/http';
import {refreshCustomerBilling} from '../../../../../../features/billing/self-service';
export async function POST(request:Request,c:{params:Promise<{workspaceId:string}>}){
 const permissionDenied=await enforceWorkspacePermission(request,c,'owner');if(permissionDenied)return permissionDenied;
try{
 if(!dashboardSameOrigin(request))throw Error('FORBIDDEN');
 const actor=await getAuthenticatedDashboardActor(request);if(!actor)throw Error('FORBIDDEN');const {workspaceId}=await c.params;
 const input=await billingBody(request);if(!z.object({}).strict().safeParse(input).success)throw Error('INVALID_BILLING_INPUT');
 return billingJson(await refreshCustomerBilling(actor,workspaceId));
}catch(error){return billingError(error);}}
