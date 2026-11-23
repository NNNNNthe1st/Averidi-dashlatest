import {reportSettingsSchema,reportFormatSchema} from '../../features/reports/settings';
import {renderVisualReport} from '../../engines/reporting/visual-report';
import {normalizeLayout,pagesSchema} from '../../features/views/layout';
import {workspacePresentationSchema} from '../../features/workspaces/presentation-contracts';
import {authorizeReportRecipients} from '../../features/sharing/report-access';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dashboardDb} from '../../server/db';
import {dashboardWorkspaceArtifactKey,readDashboardObject} from '../../server/storage';
import {currentAnalysis,prepareAnalysisInput,assertCurrentAnalysis} from '../../features/analysis/service';
import {validateGovernedDefinition} from '../../features/analysis/views';
import {analysisQuerySchema} from '../../engines/analysis/pipeline';
import {buildGovernedDashboardWidgets,canUseUnfilteredKpiFrame} from '../../features/analysis/governed-widgets';
import {exportDashboardMetricReport} from '../../engines/reporting/metric-report';
import {normalizeWorkerPayload,deliveryRecipientsSchema} from '../contracts';
import {publishWorkerEffect,workerArtifactId,writeWorkerArtifact,assertWorkerLease} from '../effects';
import type {DashboardProcessorJob} from '../processors';
const reportSettings=reportSettingsSchema;
export async function processReportGeneration(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('REPORT_GENERATE',job.payload);
 const report=await dashboardDb.dashboardReportDefinition.findFirst({where:{id:p.reportId,workspaceId:job.workspaceId},include:{view:true}});
 if(!report?.view?.analysisId)throw Error('REPORT_UNAVAILABLE');const format=reportFormatSchema.parse(report.format);
 const settings=reportSettings.safeParse(report.definition);if(!settings.success)throw Error('INVALID_REPORT_DEFINITION');
 if(settings.data.expiresAt&&Date.parse(settings.data.expiresAt)<=Date.now())throw Error('REPORT_EXPIRED');
 const view=report.view,input=await currentAnalysis(job.workspaceId,view.datasetId,view.analysisId!);
 const definition=validateGovernedDefinition(view.definition,input.result);
 const query=settings.data.query??{filters:[],compare:false};
 const prepared=canUseUnfilteredKpiFrame(definition,input,query)?undefined:await prepareAnalysisInput(input);
 const widgets=await buildGovernedDashboardWidgets(definition,prepared,input,query,{
  refreshedAt:input.version.profiledAt!.toISOString(),calculatedAt:input.run.createdAt.toISOString()
 },signal);
 const records=await dashboardDb.dashboardPage.findMany({where:{viewId:view.id,workspaceId:job.workspaceId},orderBy:{position:'asc'}});
 const stored=pagesSchema.safeParse(records.map(r=>{const value=r.layout as {key?:string;widgets?:unknown};return {id:value?.key??r.id,name:r.name,widgets:value?.widgets??[]};}));
 const pages=normalizeLayout(stored.success?stored.data:[],definition.widgets).map(p=>({name:p.name,widgetIds:p.widgets.map(w=>w.widgetId)}));
 const workspace=await dashboardDb.dashboardWorkspace.findUniqueOrThrow({where:{id:job.workspaceId},select:{presentation:true,presentationRevision:true}}),presentation=workspacePresentationSchema.safeParse(workspace.presentation);
 const created=await dashboardDb.dashboardJob.findUniqueOrThrow({where:{id:job.id},select:{createdAt:true}});
 const rendered=format==='CSV'?{bytes:Buffer.from(exportDashboardMetricReport({...widgets,analysisId:input.run.id,versionId:input.version.id,sourceChecksum:input.version.checksum})),pages:0}:await renderVisualReport({name:report.name,dashboardName:view.name,data:widgets,analysisId:input.run.id,versionId:input.version.id,sourceChecksum:input.version.checksum,generatedAt:created.createdAt,branding:settings.data.branding,presentation:presentation.success?presentation.data:null,pages},format,signal);
 const bytes=rendered.bytes;
 const exportId=workerArtifactId(job.id,'export'),key=dashboardWorkspaceArtifactKey('reports',job.workspaceId,exportId);
 signal?.throwIfAborted();await dashboardDb.$transaction(tx=>assertWorkerLease(tx,job,signal));await writeWorkerArtifact(key,bytes);
 return publishWorkerEffect(job,async tx=>{
  await assertCurrentAnalysis(tx,job.workspaceId,view.datasetId,input.version.id,input.version.semanticRevision);
  if(!await tx.dashboardWorkspace.count({where:{id:job.workspaceId,presentationRevision:workspace.presentationRevision}}))throw Error('VERSION_CONFLICT');
  const current=await tx.dashboardReportDefinition.findFirst({where:{id:report.id,workspaceId:job.workspaceId,updatedAt:report.updatedAt},include:{view:true}});
  if(!current?.view||current.view.updatedAt.getTime()!==view.updatedAt.getTime()||current.view.analysisId!==input.run.id)throw Error('VERSION_CONFLICT');
  await tx.dashboardReportExport.create({data:{id:exportId,workspaceId:job.workspaceId,reportId:report.id,sourceViewId:view.id,format,status:'READY',storageKey:key,checksum:createHash('sha256').update(bytes).digest('hex'),fileSize:BigInt(bytes.length),completedAt:new Date(),expiresAt:settings.data.expiresAt?new Date(settings.data.expiresAt):null}});
  if(p.scheduleId){
   const schedule=await tx.dashboardReportSchedule.findFirst({where:{id:p.scheduleId,workspaceId:job.workspaceId,reportId:report.id,enabled:true}});if(!schedule)throw Error('SCHEDULE_UNAVAILABLE');
   const recipients=deliveryRecipientsSchema.safeParse(schedule.recipients);if(!recipients.success)throw Error('INVALID_RECIPIENTS');
   await authorizeReportRecipients(tx,job.workspaceId,view.id,recipients.data);
   for(const recipient of recipients.data){
    const member=await tx.dashboardMembership.findFirst({where:{workspaceId:job.workspaceId,userId:recipient.userId,role:{in:['OWNER','EDITOR','VIEWER']}}});if(!member)throw Error('RECIPIENT_UNAVAILABLE');
    const deliveryId=workerArtifactId(job.id,recipient.userId);
    await tx.dashboardReportDelivery.create({data:{id:deliveryId,workspaceId:job.workspaceId,exportId,scheduleId:schedule.id,destination:'user:'+recipient.userId,idempotencyKey:deliveryId}});
    await tx.dashboardJob.create({data:{workspaceId:job.workspaceId,kind:'REPORT_DELIVER',payload:{deliveryId},idempotencyKey:'deliver_'+deliveryId}});
   }
  }
  return {exportId,fileSize:bytes.length,format,pages:rendered.pages};
 },signal);
}
export async function processReportDelivery(job:DashboardProcessorJob,signal?:AbortSignal){
 const p=normalizeWorkerPayload('REPORT_DELIVER',job.payload);
 const delivery=await dashboardDb.dashboardReportDelivery.findFirst({where:{id:p.deliveryId,workspaceId:job.workspaceId},include:{export:true}});
 if(!delivery||delivery.export.status!=='READY'||!delivery.export.storageKey||delivery.export.expiresAt&&delivery.export.expiresAt<=new Date())throw Error('REPORT_UNAVAILABLE');
 const match=/^user:([A-Za-z0-9_-]{1,128})$/.exec(delivery.destination);if(!match)throw Error('UNSUPPORTED_DELIVERY_TRANSPORT');
 if(delivery.export.storageKey!==dashboardWorkspaceArtifactKey('reports',job.workspaceId,delivery.export.id))throw Error('INVALID_STORAGE_SCOPE');
 const bytes=await readDashboardObject(delivery.export.storageKey);
 if(BigInt(bytes.length)!==delivery.export.fileSize||createHash('sha256').update(bytes).digest('hex')!==delivery.export.checksum)throw Error('SOURCE_INTEGRITY_FAILURE');
 return publishWorkerEffect(job,async tx=>{
  const member=await tx.dashboardMembership.findFirst({where:{workspaceId:job.workspaceId,userId:match[1],role:{in:['OWNER','EDITOR','VIEWER']}}});if(!member)throw Error('RECIPIENT_UNAVAILABLE');
  const valid=await tx.dashboardReportExport.findFirst({where:{id:delivery.exportId,workspaceId:job.workspaceId,status:'READY',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});if(!valid)throw Error('REPORT_EXPIRED');
  const report=await tx.dashboardReportDefinition.findFirst({where:{id:valid.reportId,workspaceId:job.workspaceId}});if(!report)throw Error('REPORT_UNAVAILABLE');await authorizeReportRecipients(tx,job.workspaceId,report.viewId,[{userId:match[1]}]);await authorizeReportRecipients(tx,job.workspaceId,valid.sourceViewId,[{userId:match[1]}]);
  const changed=await tx.dashboardReportDelivery.updateMany({where:{id:delivery.id,workspaceId:job.workspaceId,status:{in:['PENDING','DELIVERED']},destination:delivery.destination},data:{status:'DELIVERED',deliveredAt:delivery.deliveredAt??new Date(),attempts:{increment:1},lastErrorCode:null}});
  if(changed.count!==1)throw Error('DELIVERY_UNAVAILABLE');
  return {deliveryId:delivery.id,transport:'IN_APP',delivered:true};
 },signal);
}
