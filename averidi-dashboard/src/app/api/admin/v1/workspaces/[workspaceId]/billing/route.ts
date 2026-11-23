import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../../../features/billing/http';
import {dashboardDb as db} from '../../../../../../../server/db';
import {bindBilling} from '../../../../../../../features/billing/service';
type C={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,c:C){try{await billingAdmin(request);const {workspaceId}=await c.params;const binding=await db.dashboardBillingBinding.findUnique({where:{workspaceId},select:{id:true,externalSubscriptionId:true,cancelAtPeriodEnd:true,reconciledAt:true,customer:{select:{externalCustomerId:true}}}});return billingJson({binding});}catch(e){return billingError(e);}}
export async function PUT(request:Request,c:C){try{const actor=await billingAdmin(request,true);const {workspaceId}=await c.params;return billingJson({binding:await bindBilling(workspaceId,await billingBody(request),actor)});}catch(e){return billingError(e);}}
