import {dashboardDb as db} from '../../../../../server/db';
import {billingAdmin,billingJson,billingError} from '../../../../../features/billing/http';
import {readAdminPage,adminPageResult} from '../../../../../server/admin-pagination';
export async function GET(request:Request){try{await billingAdmin(request);const page=readAdminPage(request);if(!page)return billingJson({error:'INVALID_QUERY'},400);const rows=await db.dashboardAccountErasure.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],take:page.take,cursor:page.cursor,skip:page.skip,select:{id:true,userId:true,status:true,createdAt:true,updatedAt:true,completedAt:true,errorCode:true,deletedObjects:true}});return billingJson(adminPageResult(rows,page.limit));}catch(e){return billingError(e);}}
