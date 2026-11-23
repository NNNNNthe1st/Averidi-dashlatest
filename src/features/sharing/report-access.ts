import {assertCustomPermission} from '../permissions/policy';
import {jobPermission} from '../permissions/catalog';
import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {authorizedView,assertReportView} from './access';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {normalizeWorkerPayload} from '../../worker/contracts';
export async function authorizeReportWork(actor:Actor,workspaceId:string,kind:string,payload:unknown,tx:Prisma.TransactionClient=db){
 await assertCustomPermission(actor,workspaceId,jobPermission(kind),tx);
 if(!['REPORT_GENERATE','REPORT_DELIVER'].includes(kind))return;
 const p=normalizeWorkerPayload(kind,payload);let reportId=p.reportId;
 if(kind==='REPORT_DELIVER'){const delivery=await tx.dashboardReportDelivery.findFirst({where:{id:String(p.deliveryId),workspaceId},include:{export:true}});if(!delivery)throw Error('DELIVERY_UNAVAILABLE');await assertReportView(actor,workspaceId,delivery.export.sourceViewId,'VIEW',tx);reportId=delivery.export.reportId;}
 const report=await tx.dashboardReportDefinition.findFirst({where:{id:String(reportId),workspaceId}});if(!report)throw Error('REPORT_UNAVAILABLE');await assertReportView(actor,workspaceId,report.viewId,'EDIT',tx);
}
export async function authorizeReportRecipients(tx:Prisma.TransactionClient,workspaceId:string,viewId:string|null,recipients:{userId:string}[]){for(const recipient of recipients)try{await assertReportView(recipient,workspaceId,viewId,'VIEW',tx);}catch{throw Error('RECIPIENT_UNAVAILABLE');}}
