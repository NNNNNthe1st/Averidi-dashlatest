import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../features/billing/http';
import {dashboardDb as db} from '../../../../../server/db';
import {readAdminPage,adminPageResult} from '../../../../../server/admin-pagination';
import {savePlan} from '../../../../../features/billing/service';
export async function GET(request:Request){try{await billingAdmin(request);const page=readAdminPage(request);if(!page)return billingJson({error:'INVALID_PAGINATION'},400);return billingJson(adminPageResult(await db.dashboardBillingPlan.findMany({orderBy:{id:'asc'},take:page.take,cursor:page.cursor,skip:page.skip}),page.limit));}catch(e){return billingError(e);}}
export async function PUT(request:Request){try{const actor=await billingAdmin(request,true);return billingJson({plan:await savePlan(await billingBody(request),actor)});}catch(e){return billingError(e);}}
