import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../features/billing/http';
import {dashboardConfiguration,updateDashboardConfiguration} from '../../../../../features/administration/configuration';
export async function GET(request:Request){try{await billingAdmin(request);return billingJson(await dashboardConfiguration());}catch(e){return billingError(e);}}
export async function PUT(request:Request){try{const actor=await billingAdmin(request,true);return billingJson({setting:await updateDashboardConfiguration(await billingBody(request),actor)});}catch(e){return billingError(e);}}
