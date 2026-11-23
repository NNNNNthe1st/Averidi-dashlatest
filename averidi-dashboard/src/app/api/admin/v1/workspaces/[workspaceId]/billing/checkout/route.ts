import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../../../../features/billing/http';
import {recoverCustomerCheckout} from '../../../../../../../../features/billing/self-service';
export async function POST(request:Request,c:{params:Promise<{workspaceId:string}>}){try{
 const actor=await billingAdmin(request,true),{workspaceId}=await c.params;
 return billingJson(await recoverCustomerCheckout(workspaceId,await billingBody(request),actor));
}catch(error){return billingError(error);}}
