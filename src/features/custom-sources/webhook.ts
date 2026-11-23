import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {dashboardStorageKey} from '../../server/storage';
import {dashboardMaxFileBytes,prepareDashboardFile} from '../../engines/ingestion/ingest';
import {isDashboardWorkspaceReleased,dashboardReleaseConfig} from '../../server/release-gate';
import {evaluateDashboardSubscription} from '../subscriptions/entitlements';
import {openDashboardCredential} from '../data-sources/credentials';
import {writeWorkerArtifact,workerArtifactId} from '../../worker/effects';
import {assertCustomSourcesEnabled,webhookConfigSchema} from './contracts';
import {sourceRows} from './reader';
const payload=z.object({schemaVersion:z.literal(1),eventId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),sequence:z.string().regex(/^[1-9]\d{0,18}$/).refine(s=>BigInt(s)<=BigInt('9223372036854775807')),records:z.array(z.record(z.string(),z.unknown())).min(1).max(50000)}).strict();
async function subscription(workspaceId:string,tx:Prisma.TransactionClient=db){const value=await tx.dashboardSubscription.findUnique({where:{workspaceId},select:{planCode:true,status:true,currentPeriodEnd:true,accessSuspended:true,billingPlan:{select:{active:true,entitlements:true}}}});if(!evaluateDashboardSubscription(value).active)throw Error('SUBSCRIPTION_REQUIRED');}
async function rawBody(request:Request){
 const limit=dashboardMaxFileBytes(),length=request.headers.get('content-length');if(length&&(!/^\d{1,12}$/.test(length)||Number(length)>limit))throw Error('WEBHOOK_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw Error('INVALID_SOURCE_WEBHOOK');const chunks:Uint8Array[]=[],timeout=AbortSignal.timeout(15000);let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};timeout.addEventListener('abort',abort,{once:true});
 try{for(;;){const part=await reader.read();if(timeout.aborted)throw Error('INVALID_SOURCE_WEBHOOK');if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();throw Error('WEBHOOK_TOO_LARGE');}chunks.push(part.value);}}finally{timeout.removeEventListener('abort',abort);reader.releaseLock();}
 if(!size)throw Error('INVALID_SOURCE_WEBHOOK');return Buffer.concat(chunks);
}
function receiptResult(record:{id:string;status:string;jobId:string|null;versionId:string|null}){return {receiptId:record.id,status:record.status,jobId:record.jobId,versionId:record.versionId};}
export async function acceptSourceWebhook(workspaceId:string,connectorId:string,request:Request){
 assertCustomSourcesEnabled();if(!isDashboardWorkspaceReleased(workspaceId,dashboardReleaseConfig()))throw Error('DASHBOARD_NOT_RELEASED');
 const timestamp=request.headers.get('x-averidi-timestamp')??'',signature=request.headers.get('x-averidi-signature')??'';
 if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^v1=[a-f0-9]{64}$/.test(signature))throw Error('SOURCE_WEBHOOK_UNAUTHORIZED');
 const initial=await db.dashboardConnectorConfiguration.findFirst({where:{id:connectorId,workspaceId,provider:'DATA_WEBHOOK',enabled:true},include:{source:{include:{datasets:{where:{status:{not:'ARCHIVED'}},take:1}}}}});
 const reference=initial?await db.dashboardCredentialReference.findFirst({where:{workspaceId,connectorId,purpose:'CUSTOM_WEBHOOK',revokedAt:null}}):null;
 if(!initial||!reference?.encryptedValue||!initial.source.datasets[0])throw Error('SOURCE_WEBHOOK_UNAUTHORIZED');
 let secret:string;try{const value=JSON.parse(openDashboardCredential(reference.encryptedValue,workspaceId,initial.sourceId));if(typeof value.secret!=='string'||!/^[a-f0-9]{64}$/.test(value.secret))throw Error();secret=value.secret;}catch{throw Error('SOURCE_WEBHOOK_UNAUTHORIZED');}
 const raw=await rawBody(request),expected=createHmac('sha256',Buffer.from(secret,'hex')).update(timestamp+'.'+workspaceId+'.'+connectorId+'.').update(raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex')))throw Error('SOURCE_WEBHOOK_UNAUTHORIZED');await subscription(workspaceId);
 let input:unknown;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw Error('INVALID_SOURCE_WEBHOOK');}const parsed=payload.safeParse(input);if(!parsed.success)throw Error('INVALID_SOURCE_WEBHOOK');const p=parsed.data,digest=createHash('sha256').update(raw).digest('hex');
 const previous=await db.dashboardWebhookRecord.findUnique({where:{connectorId_externalEventId:{connectorId,externalEventId:p.eventId}}});if(previous){if(previous.payloadDigest!==digest||!previous.versionId||!previous.jobId)throw Error('SOURCE_WEBHOOK_CONFLICT');return receiptResult(previous);}
 const config=webhookConfigSchema.parse(initial.configuration),rows=sourceRows(p.records,config),bytes=Buffer.from(JSON.stringify(rows));if(bytes.length>dashboardMaxFileBytes())throw Error('WEBHOOK_TOO_LARGE');await prepareDashboardFile({bytes,fileName:'webhook.json',preserveAllText:true});
 const datasetId=initial.source.datasets[0].id,versionId=workerArtifactId(connectorId,p.eventId),key=dashboardStorageKey(workspaceId,datasetId,versionId);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${connectorId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const current=await tx.dashboardConnectorConfiguration.findFirst({where:{id:connectorId,workspaceId,provider:'DATA_WEBHOOK',enabled:true,updatedAt:initial.updatedAt}}),credential=await tx.dashboardCredentialReference.findFirst({where:{id:reference.id,workspaceId,revokedAt:null,encryptedValue:reference.encryptedValue}});
  if(!current||!credential)throw Error('SOURCE_WEBHOOK_UNAUTHORIZED');await subscription(workspaceId,tx);
  const existing=await tx.dashboardWebhookRecord.findUnique({where:{connectorId_externalEventId:{connectorId,externalEventId:p.eventId}}});if(existing){if(existing.payloadDigest!==digest||!existing.jobId||!existing.versionId)throw Error('SOURCE_WEBHOOK_CONFLICT');return receiptResult(existing);}
  const prior=current.cursor&&typeof current.cursor==='object'&&!Array.isArray(current.cursor)?current.cursor.sequence:'0';if(typeof prior!=='string'||!/^\d{1,19}$/.test(prior))throw Error('CUSTOM_SOURCE_CONFLICT');if(BigInt(p.sequence)<=BigInt(prior))throw Error('SOURCE_WEBHOOK_SEQUENCE');
  await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${datasetId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  if(!await tx.dashboardDataset.count({where:{id:datasetId,workspaceId,status:{not:'ARCHIVED'},sourceId:initial.sourceId}}))throw Error('DATASET_UNAVAILABLE');
  if(await tx.dashboardDatasetVersion.count({where:{datasetId,status:'PENDING'}}))throw Error('IMPORT_IN_PROGRESS');const latest=await tx.dashboardDatasetVersion.findFirst({where:{datasetId},orderBy:{version:'desc'},select:{version:true}}),jobId=randomUUID();
  await writeWorkerArtifact(key,bytes,tx);
  await tx.dashboardDatasetVersion.create({data:{id:versionId,datasetId,version:(latest?.version??0)+1,status:'PENDING',sourceFormat:'JSON',importMode:'WEBHOOK_SNAPSHOT',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex'),importSummary:{connectorId,connectorRevision:initial.updatedAt.toISOString(),eventId:p.eventId,sequence:p.sequence,jobId,snapshot:true}}});
  await tx.dashboardJob.create({data:{id:jobId,workspaceId,kind:'DATASET_PROFILE',idempotencyKey:'source-webhook_'+versionId,payload:{datasetId,versionId,format:'json'}}});
  const record=await tx.dashboardWebhookRecord.create({data:{workspaceId,connectorId,externalEventId:p.eventId,payloadDigest:digest,datasetId,versionId,jobId,sequence:BigInt(p.sequence),connectorRevision:initial.updatedAt}});
  await tx.$executeRaw`UPDATE "DashboardConnectorConfiguration" SET cursor=${JSON.stringify({sequence:p.sequence})}::jsonb WHERE id=${connectorId}`;
  await tx.dashboardDataSource.update({where:{id:initial.sourceId},data:{status:'SYNCING',lastCheckedAt:new Date(),lastErrorCode:null}});
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:'dashboard-source-webhook',actorSubject:connectorId,action:'SOURCE_WEBHOOK_ACCEPTED',resourceType:'CONNECTOR',resourceId:connectorId,details:{eventId:p.eventId,sequence:p.sequence,versionId,jobId,bytes:bytes.length}}});return receiptResult(record);
 },{timeout:30000});
}
