import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
const start=new Date('2026-01-01'),end=new Date('2026-02-01');
// A complete relational fixture exercises persisted values, not schema-text assertions.
export async function databaseDomainFixture(tx:Prisma.TransactionClient){
 const tag=randomUUID();
 const user=await tx.dashboardUser.create({data:{externalSubject:'db-domain|'+tag}});
 const org=await tx.dashboardOrganization.create({data:{name:'Fixture organization'}});
 const workspace=await tx.dashboardWorkspace.create({data:{name:'Domain fixture',organizationId:org.id,presentation:{currency:'KES',timezone:'Africa/Nairobi',locale:'en-GB'},presentationRevision:7}});
 const w=workspace.id;
 const ids:Record<string,string>={dashboardOrganization:org.id};
 async function put(name:string,data:Record<string,unknown>){
  const row=await (tx as any)[name].create({data});ids[name]=row.id;return row;
 }
 await put('dashboardExternalIdentity',{userId:user.id,issuer:'https://fixture.invalid',subject:tag});
 await put('dashboardOrganizationMember',{organizationId:org.id,userId:user.id,role:'OWNER'});
 await put('dashboardOrganizationInvitation',{organizationId:org.id,role:'VIEWER',invitedById:user.id,tokenHash:tag,expiresAt:end});
 const role=await put('dashboardWorkspaceRole',{workspaceId:w,key:'viewer',name:'Viewer',permissions:['view:read']});
 await put('dashboardPermissionGrant',{workspaceId:w,userId:user.id,roleId:role.id});
 const source=await tx.dashboardDataSource.create({data:{workspaceId:w,name:'Source',kind:'FILE'}});
 const dataset=await tx.dashboardDataset.create({data:{workspaceId:w,sourceId:source.id,name:'Dataset'}});
 const version=await tx.dashboardDatasetVersion.create({data:{datasetId:dataset.id,version:1,status:'READY',storageKey:`uploads/${w}/fixture`,checksum:'fixture',fileSize:BigInt(10)}});
 await tx.dashboardDataset.update({where:{id:dataset.id},data:{activeVersionId:version.id}});
 const versionData={workspaceId:w,datasetId:dataset.id,versionId:version.id};
 await put('dashboardDatasetSchema',{...versionData,columns:[{name:'amount',type:'number'}]});
 await put('dashboardDatasetSnapshot',{...versionData,storageKey:`snapshots/${w}/fixture`,checksum:'fixture',fileSize:BigInt(10),rowCount:1});
 const check=await put('dashboardQualityCheck',{...versionData,kind:'NOT_NULL',rule:{field:'amount'},status:'COMPLETE',summary:{issues:1}});
 await put('dashboardQualityIssue',{workspaceId:w,checkId:check.id,code:'MISSING',severity:'ERROR',field:'amount',rowNumber:1,details:{}});
 const entity=await put('dashboardBusinessEntity',{workspaceId:w,datasetId:dataset.id,key:'orders',fields:{id:'order_id'}});
 await put('dashboardDataRelationship',{workspaceId:w,name:'Orders',fromEntityId:entity.id,toEntityId:entity.id,cardinality:'ONE_TO_ONE',fieldMappings:[{from:'id',to:'id'}]});
 const metric=await tx.dashboardMetricDefinition.create({data:{workspaceId:w,key:'revenue',name:'Revenue',definition:{aggregation:'SUM'}}});
 await put('dashboardMetricComponent',{workspaceId:w,metricId:metric.id,key:'amount',kind:'MEASURE',definition:{field:'amount'}});
 await put('dashboardMetricResult',{...versionData,metricId:metric.id,status:'READY',value:'1234.5678901234',lineage:{field:'amount',versionId:version.id},periodStart:start,periodEnd:end});
 const view=await tx.dashboardView.create({data:{workspaceId:w,datasetId:dataset.id,name:'View',definition:{widgets:[]}}});
 await put('dashboardQueryCache',{id:tag.replaceAll('-','').repeat(2),workspaceId:w,viewId:view.id,scopeHash:'a'.repeat(64),payload:'{\"fixture\":true}',signature:'b'.repeat(64),createdAt:start,expiresAt:end});
 const page=await put('dashboardPage',{workspaceId:w,viewId:view.id,name:'Page',position:0,layout:{columns:12}});
 await put('dashboardWidget',{workspaceId:w,pageId:page.id,metricId:metric.id,name:'Revenue',kind:'KPI',position:0,definition:{}});
 await put('dashboardSavedView',{workspaceId:w,viewId:view.id,userId:user.id,name:'My view',filters:{},layout:{}});
 const target=await put('dashboardTarget',{workspaceId:w,metricId:metric.id,name:'Monthly goal',value:1500,periodStart:start,periodEnd:end});
 const rule=await put('dashboardAlertRule',{workspaceId:w,metricId:metric.id,targetId:target.id,name:'Below goal',condition:{operator:'LT'}});
 await put('dashboardAlertEvent',{workspaceId:w,ruleId:rule.id,eventKey:tag,observedValue:1200});
 const job=await tx.dashboardJob.create({data:{workspaceId:w,kind:'FIXTURE',payload:{}}});
 const schedule=await tx.dashboardJobSchedule.create({data:{workspaceId:w,kind:'FIXTURE',payload:{},intervalSeconds:60,nextRunAt:end}});
 await put('dashboardRefreshExecution',{workspaceId:w,sourceId:source.id,jobId:job.id,scheduleId:schedule.id});
 const report=await put('dashboardReportDefinition',{workspaceId:w,viewId:view.id,name:'Monthly report',format:'CSV',definition:{}});
 const reportSchedule=await put('dashboardReportSchedule',{workspaceId:w,reportId:report.id,intervalSeconds:3600,nextRunAt:end,recipients:[]});
 const reportExport=await put('dashboardReportExport',{workspaceId:w,reportId:report.id,status:'READY',storageKey:`reports/${w}/fixture`,checksum:'fixture',fileSize:BigInt(10),completedAt:start});
 await put('dashboardReportDelivery',{workspaceId:w,exportId:reportExport.id,scheduleId:reportSchedule.id,destination:'fixture@example.invalid',idempotencyKey:tag});
 const share=await put('dashboardShare',{workspaceId:w,viewId:view.id,tokenHash:tag,expiresAt:end});
 await put('dashboardAccessGrant',{workspaceId:w,shareId:share.id,userId:user.id,permission:'VIEW'});
 await put('dashboardAuditEvent',{workspaceId:w,actorIssuer:'fixture',actorSubject:tag,action:'CREATE',resourceType:'VIEW',resourceId:view.id,details:{}});
 const plan=await put('dashboardBillingPlan',{code:tag,name:'Fixture plan',entitlements:{}});
 const subscription=await tx.dashboardSubscription.create({data:{workspaceId:w,planCode:tag,billingPlanId:plan.id}});
 const customer=await put('dashboardBillingCustomer',{workspaceId:w,provider:'MOCK',externalCustomerId:tag});
 await put('dashboardInvoice',{workspaceId:w,subscriptionId:subscription.id,customerId:customer.id,provider:'MOCK',externalInvoiceId:tag,currency:'USD',amount:'12.345678',status:'OPEN',periodStart:start,periodEnd:end});
 const connector=await put('dashboardConnectorConfiguration',{workspaceId:w,sourceId:source.id,provider:'FILE',configuration:{},scopes:[]});
 await put('dashboardCredentialReference',{workspaceId:w,connectorId:connector.id,purpose:'ACCESS',secretReference:'secret-store://dashboard/fixture',keyVersion:'1'});
 await put('dashboardWebhookRecord',{workspaceId:w,connectorId:connector.id,externalEventId:tag,payloadDigest:'fixture'});
 await put('dashboardSourceMonitoringPolicy',{workspaceId:w,sourceId:source.id,maxAgeMinutes:60});
 await put('dashboardSourceIncident',{workspaceId:w,sourceId:source.id,kind:'STALE_SOURCE',code:'SOURCE_OVERDUE'});
 const observationBucketKey={window:start,kind:'JOB',name:'RECOVERY_FIXTURE_'+tag,outcome:'COMPLETED'};await tx.dashboardObservationBucket.create({data:{...observationBucketKey,count:2,totalMs:40,maxMs:30}});
 await put('dashboardOperationalEvent',{workspaceId:w,kind:'FIXTURE',severity:'INFO',details:{}});
 await put('dashboardSupportCase',{workspaceId:w,requesterId:user.id,subject:'Fixture',details:{}});
 await put('dashboardConfiguration',{key:tag,value:{enabled:false}});
 return {ids,workspace,user,org,dataset,version,metric,connector,report,observationBucketKey};
}

