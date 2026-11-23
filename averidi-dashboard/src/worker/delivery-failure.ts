import {dashboardDb} from '../server/db';
import {workerErrorCode} from './job-claim';
import {normalizeWorkerPayload} from './contracts';
export async function reconcileTerminalReportDeliveries(){
 const jobs=await dashboardDb.dashboardJob.findMany({where:{kind:'REPORT_DELIVER',status:{in:['FAILED','CANCELLED']},reconciledAt:null},orderBy:{updatedAt:'asc'},take:100});
 for(const job of jobs)await dashboardDb.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "DashboardJob" WHERE id=${job.id} FOR UPDATE`;
  const current=await tx.dashboardJob.findFirst({where:{id:job.id,workspaceId:job.workspaceId,status:job.status,reconciledAt:null}});if(!current)return;
  let deliveryId:string|null=null;try{deliveryId=normalizeWorkerPayload('REPORT_DELIVER',job.payload).deliveryId;}catch{/* Invalid manually inserted payloads cannot change a delivery. */}
  if(deliveryId)await tx.dashboardReportDelivery.updateMany({where:{id:deliveryId,workspaceId:job.workspaceId,status:'PENDING',deliveredAt:null},data:{status:job.status,attempts:job.attempts,lastErrorCode:workerErrorCode(job.lastError)}});
  await tx.dashboardJob.update({where:{id:job.id},data:{reconciledAt:new Date()}});
 });
 return jobs.length;
}
