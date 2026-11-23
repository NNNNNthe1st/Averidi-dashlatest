import {dashboardDb as db} from '../../../../../../../server/db';
import {readAdminPage,adminPageResult} from '../../../../../../../server/admin-pagination';
import {billingAdmin,billingJson,billingError} from '../../../../../../../features/billing/http';
export async function GET(request:Request,c:{params:Promise<{workspaceId:string}>}){
 try{await billingAdmin(request);const {workspaceId}=await c.params;const page=readAdminPage(request);if(!page)return billingJson({error:'INVALID_PAGINATION'},400);
 return billingJson(adminPageResult(await db.dashboardInvoice.findMany({where:{workspaceId},orderBy:{id:'asc'},take:page.take,cursor:page.cursor,skip:page.skip,select:{id:true,currency:true,amount:true,status:true,periodStart:true,periodEnd:true,paidAt:true,externalInvoiceId:true}}),page.limit));
 }catch(error){return billingError(error);}
}
