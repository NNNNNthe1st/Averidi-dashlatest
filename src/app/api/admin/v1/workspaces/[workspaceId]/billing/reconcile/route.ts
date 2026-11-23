import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../../../../features/billing/http';
import {reconcileBilling} from '../../../../../../../../features/billing/service';
export async function POST(request:Request,c:{params:Promise<{workspaceId:string}>}){try{const actor=await billingAdmin(request,true);const {workspaceId}=await c.params;return billingJson(await reconcileBilling(workspaceId,actor));}catch(e){return billingError(e);}}
