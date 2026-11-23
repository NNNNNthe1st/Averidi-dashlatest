import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../../features/billing/http';
import {dashboardDb as db} from '../../../../../../server/db';
import {updateSupportCase} from '../../../../../../features/administration/support';
type C={params:Promise<{caseId:string}>};
export async function GET(request:Request,c:C){try{await billingAdmin(request);const {caseId}=await c.params;const supportCase=await db.dashboardSupportCase.findUnique({where:{id:caseId}});return supportCase?billingJson({supportCase}):billingJson({error:'NOT_FOUND'},404);}catch(e){return billingError(e);}}
export async function PATCH(request:Request,c:C){try{const actor=await billingAdmin(request,true);const {caseId}=await c.params;return billingJson({supportCase:await updateSupportCase(caseId,await billingBody(request),actor)});}catch(e){return billingError(e);}}
