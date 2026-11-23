import {setAuditActor} from '../audit/context';
import {assertDashboardAdmission} from '../administration/configuration';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {requireWorkspaceRole,type VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {requireDashboardEntitlement} from '../subscriptions/entitlements';
import {assertCustomPermission} from '../permissions/policy';
import {sealDashboardCredential,openDashboardCredential} from '../data-sources/credentials';
import {enqueueActorDashboardJob} from '../../worker/queue';
import {customProviders,customConfiguration,assertCustomSourcesEnabled,apiConfigSchema,tokenSchema,type ApiConfig} from './contracts';
import {customSourceAccess} from './access';
import {beginMarketingAuthorization,assertMarketingConfigured,usableMarketingCredential} from './marketing-oauth';
import {marketingProvider} from './contracts';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),stamp=z.iso.datetime();
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('AUTHORIZE'),id}).strict(),
 z.object({action:z.literal('CREATE'),provider:z.enum(customProviders),name:z.string().trim().min(1).max(120),configuration:z.unknown()}).strict(),
 z.object({action:z.literal('UPDATE'),id,expectedUpdatedAt:stamp,name:z.string().trim().min(1).max(120),configuration:z.unknown()}).strict(),
 z.object({action:z.literal('CREDENTIAL'),id,expectedUpdatedAt:stamp,credential:tokenSchema}).strict(),
 z.object({action:z.literal('ROTATE'),id,expectedUpdatedAt:stamp}).strict(),
 z.object({action:z.literal('SUSPEND'),id,expectedUpdatedAt:stamp}).strict(),
 z.object({action:z.literal('REFRESH'),id,requestId:z.uuid()}).strict(),
 z.object({action:z.literal('SCHEDULE'),id,intervalSeconds:z.number().int().min(60).max(2592000),nextRunAt:stamp}).strict(),
 z.object({action:z.literal('DISABLE_SCHEDULE'),id,scheduleId:id,expectedNextRunAt:stamp}).strict(),
 z.object({action:z.literal('RETRY_WEBHOOK'),id,receiptId:id,expectedStatus:z.enum(['FAILED','CANCELLED'])}).strict(),
]);
export async function readCustomSources(actor:Actor,workspaceId:string){
 await customSourceAccess(actor,workspaceId,false,true);
 const connectors=await db.dashboardConnectorConfiguration.findMany({where:{workspaceId,provider:{in:[...customProviders]}},take:100,orderBy:{createdAt:'asc'},include:{source:{select:{name:true,status:true,lastSyncedAt:true,lastErrorCode:true,datasets:{where:{status:{not:'ARCHIVED'}},select:{id:true,name:true}}}},webhookRecordRecords:{orderBy:{createdAt:'desc'},take:20,select:{id:true,externalEventId:true,sequence:true,status:true,processedAt:true,lastErrorCode:true,createdAt:true,versionId:true}}}});
 const schedules=await db.dashboardJobSchedule.findMany({where:{workspaceId,kind:'SOURCE_REFRESH'},orderBy:{id:'asc'},take:200});
 return {sources:connectors.map(c=>({id:c.id,provider:c.provider,configuration:c.configuration,enabled:c.enabled,updatedAt:c.updatedAt,source:c.source,receipts:c.webhookRecordRecords.map(r=>({...r,sequence:r.sequence?.toString()??null})),schedules:schedules.filter(s=>s.payload&&typeof s.payload==='object'&&!Array.isArray(s.payload)&&s.payload.sourceId===c.sourceId).map(s=>({id:s.id,intervalSeconds:s.intervalSeconds,nextRunAt:s.nextRunAt,enabled:s.enabled,lastErrorCode:s.lastErrorCode}))}))};
}
async function credential(tx:Prisma.TransactionClient,workspaceId:string,sourceId:string,connectorId:string,purpose:string,value:object,expiresAt?:Date){const encryptedValue=sealDashboardCredential(JSON.stringify(value),workspaceId,sourceId);await tx.dashboardCredentialReference.upsert({where:{connectorId_purpose:{connectorId,purpose}},create:{workspaceId,connectorId,purpose,secretReference:'dashboard-secret:'+randomUUID(),encryptedValue,keyVersion:'v1',expiresAt},update:{encryptedValue,expiresAt:expiresAt??null,revokedAt:null}});}
export async function mutateCustomSource(actor:Actor,workspaceId:string,input:unknown):Promise<Record<string,unknown>>{
 const parsed=command.safeParse(input);if(!parsed.success)throw Error('INVALID_CUSTOM_SOURCE');const c=parsed.data;
 await customSourceAccess(actor,workspaceId,true,c.action==='SUSPEND'||c.action==='DISABLE_SCHEDULE');if(c.action!=='SUSPEND'&&c.action!=='DISABLE_SCHEDULE')assertCustomSourcesEnabled();
 if(c.action==='AUTHORIZE')return beginMarketingAuthorization(actor,workspaceId,c.id);
 if(c.action==='REFRESH'){const row=await db.dashboardConnectorConfiguration.findFirst({where:{id:c.id,workspaceId,provider:{in:['CUSTOM_API','GOOGLE_ANALYTICS','GOOGLE_ADS']},enabled:true},include:{source:{include:{datasets:{where:{status:{not:'ARCHIVED'}},take:1}}}}});if(!row||!row.source.datasets[0])throw Error('CONNECTOR_DISCONNECTED');return enqueueActorDashboardJob(actor,workspaceId,'SOURCE_REFRESH',{sourceId:row.sourceId,datasetId:row.source.datasets[0].id},'custom-api_'+c.requestId);}
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${workspaceId} FOR UPDATE`;await customSourceAccess(actor,workspaceId,true,c.action==='SUSPEND'||c.action==='DISABLE_SCHEDULE',tx);
  let row=c.action==='CREATE'?null:await tx.dashboardConnectorConfiguration.findFirst({where:{id:c.id,workspaceId,provider:{in:[...customProviders]}},include:{source:{include:{datasets:{where:{status:{not:'ARCHIVED'}},take:1}}}}});
  if(c.action!=='CREATE'){await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${c.id} AND "workspaceId"=${workspaceId} FOR UPDATE`;row=await tx.dashboardConnectorConfiguration.findFirst({where:{id:c.id,workspaceId,provider:{in:[...customProviders]}},include:{source:{include:{datasets:{where:{status:{not:'ARCHIVED'}},take:1}}}}});if(!row)throw Error('NOT_FOUND');if('expectedUpdatedAt' in c&&row.updatedAt.toISOString()!==c.expectedUpdatedAt)throw Error('CUSTOM_SOURCE_CONFLICT');}
  const nextRevision=row?new Date(Math.max(Date.now(),row.updatedAt.getTime()+1)):new Date();let result:Record<string,unknown>={updated:true};let details:Prisma.InputJsonValue={action:c.action};
  if(c.action==='CREATE'){
   if(await tx.dashboardConnectorConfiguration.count({where:{workspaceId,provider:{in:[...customProviders]}}})>=100)throw Error('CUSTOM_SOURCE_LIMIT');
   if(marketingProvider(c.provider))assertMarketingConfigured(c.provider);
   const config=customConfiguration(c.provider,c.configuration),enabled=c.provider==='DATA_WEBHOOK'||(config as ApiConfig).auth==='NONE';const source=await tx.dashboardDataSource.create({data:{workspaceId,kind:c.provider,name:c.name,status:enabled?'CONFIGURED':'DISCONNECTED'}});
   const created=await tx.dashboardConnectorConfiguration.create({data:{workspaceId,sourceId:source.id,provider:c.provider,configuration:config as Prisma.InputJsonValue,scopes:['snapshot.read'],enabled}});
   const dataset=await tx.dashboardDataset.create({data:{workspaceId,sourceId:source.id,name:c.name}});result={id:created.id,datasetId:dataset.id};
   if(c.provider==='DATA_WEBHOOK'){const secret=randomBytes(32).toString('hex');await credential(tx,workspaceId,source.id,created.id,'CUSTOM_WEBHOOK',{secret});result.secret=secret;}
   details={provider:c.provider,revision:created.updatedAt.toISOString(),connectorId:created.id,datasetId:dataset.id,configuration:config as Prisma.InputJsonValue};
  }else{
   const existing=row!,dataset=existing.source.datasets[0];
   if(c.action==='UPDATE'||c.action==='CREDENTIAL'){if(!dataset)throw Error('DATASET_UNAVAILABLE');if(await tx.dashboardDatasetVersion.count({where:{datasetId:dataset.id,status:'PENDING'}}))throw Error('IMPORT_IN_PROGRESS');}
   if(c.action==='UPDATE'){
    const config=customConfiguration(existing.provider as typeof customProviders[number],c.configuration),changed=!isDeepStrictEqual(config,existing.configuration);
    if(changed)await tx.dashboardCredentialReference.updateMany({where:{connectorId:existing.id,workspaceId},data:{revokedAt:new Date(),encryptedValue:null}});
    const enabled=changed?existing.provider==='CUSTOM_API'&&(config as ApiConfig).auth==='NONE':existing.enabled;
    await tx.dashboardConnectorConfiguration.update({where:{id:existing.id},data:{configuration:config as Prisma.InputJsonValue,enabled,updatedAt:nextRevision,oauthAttemptId:null}});await tx.dashboardDataSource.update({where:{id:existing.sourceId},data:{name:c.name,status:enabled?'CONFIGURED':'DISCONNECTED'}});details={connectorId:existing.id,previous:{configuration:existing.configuration,revision:existing.updatedAt.toISOString()},configuration:config as Prisma.InputJsonValue,revision:nextRevision.toISOString(),credentialsRevoked:changed};
   }else if(c.action==='CREDENTIAL'){
    if(existing.provider!=='CUSTOM_API')throw Error('INVALID_CUSTOM_SOURCE');const config=apiConfigSchema.parse(existing.configuration);if(config.auth==='NONE')throw Error('INVALID_CUSTOM_SOURCE');if(c.credential.expiresAt&&new Date(c.credential.expiresAt)<=new Date())throw Error('INVALID_CUSTOM_SOURCE');
    await credential(tx,workspaceId,existing.sourceId,existing.id,'CUSTOM_ACCESS',c.credential,c.credential.expiresAt?new Date(c.credential.expiresAt):undefined);await tx.dashboardConnectorConfiguration.update({where:{id:existing.id},data:{enabled:true,updatedAt:nextRevision}});await tx.dashboardDataSource.update({where:{id:existing.sourceId},data:{status:'CONFIGURED',lastErrorCode:null}});
   }else if(c.action==='ROTATE'){
    if(existing.provider!=='DATA_WEBHOOK')throw Error('INVALID_CUSTOM_SOURCE');const secret=randomBytes(32).toString('hex');await credential(tx,workspaceId,existing.sourceId,existing.id,'CUSTOM_WEBHOOK',{secret});await tx.dashboardConnectorConfiguration.update({where:{id:existing.id},data:{enabled:true,updatedAt:nextRevision}});await tx.dashboardDataSource.update({where:{id:existing.sourceId},data:{status:'CONFIGURED',lastErrorCode:null}});result.secret=secret;
   }else if(c.action==='SUSPEND'){
    await tx.dashboardJobSchedule.updateMany({where:{workspaceId,kind:'SOURCE_REFRESH',payload:{path:['sourceId'],equals:existing.sourceId}},data:{enabled:false}});
    await tx.dashboardConnectorConfiguration.update({where:{id:existing.id},data:{enabled:false,updatedAt:nextRevision,oauthAttemptId:null,activeRefreshJobId:null,activeRefreshLeaseToken:null}});await tx.dashboardCredentialReference.updateMany({where:{connectorId:existing.id,workspaceId},data:{revokedAt:new Date(),encryptedValue:null}});await tx.dashboardDataSource.update({where:{id:existing.sourceId},data:{status:'DISCONNECTED'}});
   }else if(c.action==='SCHEDULE'){
    await assertCustomPermission(actor,workspaceId,'jobs.manage',tx);if(existing.provider==='DATA_WEBHOOK'||!existing.enabled||!dataset)throw Error('CONNECTOR_DISCONNECTED');if(new Date(c.nextRunAt)<new Date(Date.now()-1000))throw Error('INVALID_CUSTOM_SOURCE');
    await assertDashboardAdmission(tx,'SCHEDULE_CREATION_ENABLED');const count=await tx.dashboardJobSchedule.count({where:{workspaceId,kind:'SOURCE_REFRESH',enabled:true,payload:{path:['sourceId'],equals:existing.sourceId}}});if(count>=1)throw Error('CUSTOM_SOURCE_SCHEDULE_EXISTS');const schedule=await tx.dashboardJobSchedule.create({data:{workspaceId,kind:'SOURCE_REFRESH',payload:{sourceId:existing.sourceId,datasetId:dataset.id},intervalSeconds:c.intervalSeconds,nextRunAt:new Date(c.nextRunAt)}});result.scheduleId=schedule.id;
   }else if(c.action==='DISABLE_SCHEDULE'){
    await assertCustomPermission(actor,workspaceId,'jobs.manage',tx);const changed=await tx.dashboardJobSchedule.updateMany({where:{id:c.scheduleId,workspaceId,kind:'SOURCE_REFRESH',enabled:true,nextRunAt:new Date(c.expectedNextRunAt),payload:{path:['sourceId'],equals:existing.sourceId}},data:{enabled:false}});if(!changed.count)throw Error('CUSTOM_SOURCE_CONFLICT');
   }else if(c.action==='RETRY_WEBHOOK'){
    if(existing.provider!=='DATA_WEBHOOK'||!existing.enabled||!dataset)throw Error('CONNECTOR_DISCONNECTED');await tx.$queryRaw`SELECT id FROM "DashboardWebhookRecord" WHERE id=${c.receiptId} AND "workspaceId"=${workspaceId} FOR UPDATE`;const receipt=await tx.dashboardWebhookRecord.findFirst({where:{id:c.receiptId,workspaceId,connectorId:existing.id,status:c.expectedStatus}});const sequence=existing.cursor&&typeof existing.cursor==='object'&&!Array.isArray(existing.cursor)?existing.cursor.sequence:null;
    if(!receipt||!receipt.jobId||!receipt.versionId||receipt.sequence?.toString()!==sequence||receipt.connectorRevision?.getTime()!==existing.updatedAt.getTime())throw Error('CUSTOM_SOURCE_CONFLICT');
    await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${dataset.id} FOR UPDATE`;
    if(await tx.dashboardDatasetVersion.count({where:{datasetId:dataset.id,status:'PENDING'}}))throw Error('IMPORT_IN_PROGRESS');
    if(!(await tx.dashboardDatasetVersion.updateMany({where:{id:receipt.versionId,datasetId:dataset.id,status:{in:['FAILED','CANCELLED']}},data:{status:'PENDING'}})).count)throw Error('CUSTOM_SOURCE_CONFLICT');
    if(!(await tx.dashboardJob.updateMany({where:{id:receipt.jobId,workspaceId,status:c.expectedStatus},data:{status:'QUEUED',attempts:0,availableAt:new Date(),lastError:null,cancelRequestedAt:null,finishedAt:null,reconciledAt:null}})).count)throw Error('CUSTOM_SOURCE_CONFLICT');await tx.dashboardWebhookRecord.update({where:{id:receipt.id},data:{status:'RECEIVED',lastErrorCode:null,processedAt:null}});
   }
   details={...details as object,connectorId:existing.id};
  }
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'CUSTOM_SOURCE_'+c.action,resourceType:'CONNECTOR',resourceId:String(result.id??row?.id),details}});return result;
 },{timeout:30000});
}
export async function usableCustomApiCredential(workspaceId:string,id:string){
 assertCustomSourcesEnabled();return db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${id} AND "workspaceId"=${workspaceId} FOR UPDATE`;const connector=await tx.dashboardConnectorConfiguration.findFirst({where:{id,workspaceId,provider:'CUSTOM_API',enabled:true}});if(!connector)throw Error('CONNECTOR_DISCONNECTED');const config=customConfiguration('CUSTOM_API',connector.configuration) as ApiConfig;if(config.auth==='NONE')return {connector,credential:{accessToken:'public'}};
 const reference=await tx.dashboardCredentialReference.findFirst({where:{connectorId:id,workspaceId,purpose:'CUSTOM_ACCESS',revokedAt:null}});if(!reference?.encryptedValue||reference.expiresAt&&reference.expiresAt<=new Date())throw Error('CONNECTOR_AUTH_REQUIRED');const saved=tokenSchema.safeParse(JSON.parse(openDashboardCredential(reference.encryptedValue,workspaceId,connector.sourceId)));if(!saved.success)throw Error('CONNECTOR_AUTH_REQUIRED');return {connector,credential:{accessToken:saved.data.token}};});
}

export async function usableCustomRemoteCredential(workspaceId:string,id:string,provider:string,transport:import('../connectors/http').ConnectorTransport,signal?:AbortSignal){return marketingProvider(provider)?usableMarketingCredential(workspaceId,id,transport,signal):usableCustomApiCredential(workspaceId,id);}
