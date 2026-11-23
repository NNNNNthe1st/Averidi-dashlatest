import {dashboardDb as db} from '../../../../../server/db';
import {billingAdmin,billingJson,billingError} from '../../../../../features/billing/http';
import {readAdminPage,adminPageResult} from '../../../../../server/admin-pagination';
export async function GET(request:Request){try{
 await billingAdmin(request);const page=readAdminPage(request);if(!page)return billingJson({error:'INVALID_PAGINATION'},400);
 const rows=await db.dashboardConnectorConfiguration.findMany({orderBy:{id:'asc'},take:page.take,cursor:page.cursor,skip:page.skip,select:{id:true,workspaceId:true,provider:true,enabled:true,activeRefreshJobId:true,refreshNotBefore:true,updatedAt:true,source:{select:{status:true,lastCheckedAt:true,lastSyncedAt:true,lastErrorCode:true}},credentialReferenceRecords:{select:{expiresAt:true,revokedAt:true}}}});
 const items=rows.map(({credentialReferenceRecords,...row})=>({...row,credentialState:credentialReferenceRecords.some(c=>!c.revokedAt&&(!c.expiresAt||c.expiresAt>new Date()))?'AVAILABLE':'UNAVAILABLE'}));
 return billingJson(adminPageResult(items,page.limit));
 }catch(e){return billingError(e);}}
