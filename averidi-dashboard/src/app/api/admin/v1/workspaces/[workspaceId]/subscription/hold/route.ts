import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../../../../features/billing/http';
import {setBillingHold} from '../../../../../../../../features/billing/service';
export async function PUT(request:Request,c:{params:Promise<{workspaceId:string}>}){try{const actor=await billingAdmin(request,true);const {workspaceId}=await c.params;return billingJson(await setBillingHold(workspaceId,await billingBody(request),actor));}catch(e){return billingError(e);}}
