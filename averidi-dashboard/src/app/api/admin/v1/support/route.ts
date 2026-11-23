import {billingAdmin,billingBody,billingJson,billingError} from '../../../../../features/billing/http';
import {dashboardDb as db} from '../../../../../server/db';
import {readAdminPage,adminPageResult} from '../../../../../server/admin-pagination';
export async function GET(request:Request){try{await billingAdmin(request);const page=readAdminPage(request);if(!page)return billingJson({error:'INVALID_PAGINATION'},400);return billingJson(adminPageResult(await db.dashboardSupportCase.findMany({orderBy:{id:'asc'},take:page.take,cursor:page.cursor,skip:page.skip,select:{id:true,workspaceId:true,requesterId:true,subject:true,status:true,updatedAt:true,createdAt:true}}),page.limit));}catch(e){return billingError(e);}}
