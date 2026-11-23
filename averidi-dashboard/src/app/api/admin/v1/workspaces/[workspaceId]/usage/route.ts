import {workspaceQuotaUsage} from '../../../../../../../features/quotas/service';
import {dashboardDb as db} from '../../../../../../../server/db';
import {billingAdmin,billingJson,billingError} from '../../../../../../../features/billing/http';
export async function GET(request:Request,c:{params:Promise<{workspaceId:string}>}){try{
 await billingAdmin(request);const {workspaceId}=await c.params;
 if(!await db.dashboardWorkspace.findUnique({where:{id:workspaceId},select:{id:true}}))throw Error('NOT_FOUND');
 const [datasets,views,members,jobs,versions]=await Promise.all([db.dashboardDataset.count({where:{workspaceId}}),db.dashboardView.count({where:{workspaceId}}),db.dashboardMembership.count({where:{workspaceId}}),db.dashboardJob.groupBy({by:['status'],where:{workspaceId},_count:{_all:true}}),db.dashboardDatasetVersion.aggregate({where:{dataset:{workspaceId}},_sum:{fileSize:true}})]);
 return billingJson({quotas:await workspaceQuotaUsage(workspaceId),datasets,views,members,jobs:jobs.map(j=>({status:j.status,count:j._count._all})),sourceVersionBytes:(versions._sum.fileSize??BigInt(0)).toString()});
 }catch(e){return billingError(e);}}
