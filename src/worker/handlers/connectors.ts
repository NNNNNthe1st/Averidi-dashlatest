import {readMarketingSnapshot} from '../../features/custom-sources/marketing-reader';
import {usableCustomRemoteCredential} from '../../features/custom-sources/service';
import {readCustomApiSnapshot} from '../../features/custom-sources/reader';
import {assertCustomSourcesEnabled,customConfiguration,marketingProvider,type ApiConfig} from '../../features/custom-sources/contracts';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {dashboardStorageKey,readDashboardObject} from '../../server/storage';
import {prepareDashboardFile,dashboardMaxFileBytes} from '../../engines/ingestion/ingest';
import {usableConnectorCredential} from '../../features/connectors/service';
import {connectorConfiguration,type ConnectorProvider,ConnectorError,assertProviderConfigured} from '../../features/connectors/contracts';
import {readConnectorSnapshot} from '../../features/connectors/readers';
import {connectorTransport,type ConnectorTransport} from '../../features/connectors/http';
import {normalizeWorkerPayload} from '../contracts';
import {assertWorkerLease,workerArtifactId,writeWorkerArtifact} from '../effects';
import {processDatasetProfileJob} from '../dataset-profile';
import type {DashboardProcessorJob} from '../processors';

export async function processConnectorRefresh(job:DashboardProcessorJob,signal?:AbortSignal,transport:ConnectorTransport=connectorTransport){
 const p=normalizeWorkerPayload('SOURCE_REFRESH',job.payload);
 const sourceId=p.sourceId,datasetId=p.datasetId,versionId=workerArtifactId(job.id,'connector-version'),key=dashboardStorageKey(job.workspaceId,datasetId,versionId);
 const initial=await dashboardDb.dashboardConnectorConfiguration.findFirst({where:{sourceId,workspaceId:job.workspaceId,enabled:true,source:{datasets:{some:{id:datasetId,status:{not:'ARCHIVED'}}}}}});
 if(!initial)throw Error('CONNECTOR_DISCONNECTED');const custom=initial.provider==='CUSTOM_API'||marketingProvider(initial.provider);if(custom)assertCustomSourcesEnabled();else assertProviderConfigured(initial.provider as ConnectorProvider);
 await dashboardDb.$transaction(async tx=>{
  await assertWorkerLease(tx,job,signal);
  await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${initial.id} FOR UPDATE`;
  const current=await tx.dashboardConnectorConfiguration.findUniqueOrThrow({where:{id:initial.id}});
  if(!current.enabled||current.updatedAt.getTime()!==initial.updatedAt.getTime())throw Error('CONNECTOR_CHANGED');
  if(current.refreshNotBefore&&current.refreshNotBefore.getTime()>Date.now())throw new ConnectorError('CONNECTOR_RATE_LIMITED',Math.ceil((current.refreshNotBefore.getTime()-Date.now())/1000));
  if(current.activeRefreshJobId&&current.activeRefreshLeaseToken!==job.leaseToken&&await tx.dashboardJob.count({where:{id:current.activeRefreshJobId,status:'RUNNING',leaseToken:current.activeRefreshLeaseToken,leaseExpiresAt:{gt:new Date()}}}))throw Error('CONNECTOR_REFRESH_BUSY');
  // SQL avoids changing the user configuration revision merely to acquire an execution lease.
  await tx.$executeRaw`UPDATE "DashboardConnectorConfiguration" SET "activeRefreshJobId"=${job.id},"activeRefreshLeaseToken"=${job.leaseToken} WHERE id=${initial.id}`;
 });
 try{
  let version=await dashboardDb.dashboardDatasetVersion.findFirst({where:{id:versionId,datasetId,status:'PENDING'}});
  if(!version){
   await dashboardDb.$transaction(tx=>assertWorkerLease(tx,job,signal));
   let bytes:Buffer;
   try{bytes=await readDashboardObject(key);}catch(error){
    const missing=error instanceof Error&&('code' in error&&error.code==='ENOENT'||'code' in error&&error.code==='DASHBOARD_OBJECT_NOT_FOUND');
    if(!missing)throw error;
    const {connector,credential}=await (custom?usableCustomRemoteCredential(job.workspaceId,initial.id,initial.provider,transport,signal):usableConnectorCredential(job.workspaceId,initial.id,transport,signal));
    const rows=custom?(marketingProvider(connector.provider)?await readMarketingSnapshot(connector.provider,connector.configuration,credential,transport,signal):await readCustomApiSnapshot(customConfiguration('CUSTOM_API',connector.configuration) as ApiConfig,credential,transport,signal)):await readConnectorSnapshot(connector.provider as ConnectorProvider,connectorConfiguration(connector.provider as ConnectorProvider,connector.configuration),credential,transport,signal);
    bytes=Buffer.from(JSON.stringify(rows));
   }
   if(bytes.length>dashboardMaxFileBytes())throw Error('CONNECTOR_LIMIT_EXCEEDED');
   await prepareDashboardFile({bytes,fileName:'connector.json',preserveAllText:true});
   await dashboardDb.$transaction(tx=>assertWorkerLease(tx,job,signal));await writeWorkerArtifact(key,bytes);
   version=await dashboardDb.$transaction(async tx=>{
    await assertWorkerLease(tx,job,signal);
    await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${initial.id} FOR UPDATE`;
    if(!await tx.dashboardConnectorConfiguration.count({where:{id:initial.id,workspaceId:job.workspaceId,enabled:true,updatedAt:initial.updatedAt,activeRefreshJobId:job.id,activeRefreshLeaseToken:job.leaseToken}}))throw Error('CONNECTOR_CHANGED');
    await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${datasetId} AND "workspaceId"=${job.workspaceId} FOR UPDATE`;
    if(await tx.dashboardDatasetVersion.count({where:{datasetId,status:'PENDING'}}))throw Error('IMPORT_IN_PROGRESS');
    const latest=await tx.dashboardDatasetVersion.findFirst({where:{datasetId},orderBy:{version:'desc'},select:{version:true}});
    const staged=await tx.dashboardDatasetVersion.create({data:{id:versionId,datasetId,version:(latest?.version??0)+1,status:'PENDING',sourceFormat:'JSON',importMode:'CONNECTOR_SNAPSHOT',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex'),importSummary:{provider:initial.provider,connectorId:initial.id,connectorRevision:initial.updatedAt.toISOString(),snapshot:true,jobId:job.id,...(custom?{configuration:initial.configuration,readerVersion:'custom-sources-v1'}:{})}}});
    await tx.dashboardDataSource.update({where:{id:sourceId},data:{status:'SYNCING',lastCheckedAt:new Date(),lastErrorCode:null}});return staged;
   });
  }
  const metadata=version.importSummary as Record<string,unknown>|null;
  if(metadata?.connectorId!==initial.id||metadata.connectorRevision!==initial.updatedAt.toISOString())throw Error('CONNECTOR_CHANGED');
  const bytes=await readDashboardObject(key);if(BigInt(bytes.length)!==version.fileSize||createHash('sha256').update(bytes).digest('hex')!==version.checksum)throw Error('SOURCE_INTEGRITY_FAILURE');
  return await processDatasetProfileJob({...job,payload:{datasetId,versionId,format:'json'}},signal,{sourceId,executionId:workerArtifactId(job.id,'refresh'),connectorId:initial.id,connectorRevision:initial.updatedAt});
 }catch(error){
  const code=error instanceof Error&&/^(CONNECTOR_[A-Z_]+|IMPORT_IN_PROGRESS)$/.test(error.message)?error.message:'CONNECTOR_PROCESSING_FAILED';
  await dashboardDb.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${initial.id} FOR UPDATE`;
   if(await tx.dashboardConnectorConfiguration.count({where:{id:initial.id,workspaceId:job.workspaceId,enabled:true,activeRefreshJobId:job.id,activeRefreshLeaseToken:job.leaseToken}})&&await tx.dashboardJob.count({where:{id:job.id,leaseToken:job.leaseToken,status:'RUNNING',leaseExpiresAt:{gt:new Date()}}})){
    if(error instanceof ConnectorError&&error.retryAfterSeconds){const next=new Date(Date.now()+error.retryAfterSeconds*1000);await tx.$executeRaw`UPDATE "DashboardConnectorConfiguration" SET "refreshNotBefore"=${next.toISOString()}::timestamp WHERE id=${initial.id}`;}
    await tx.dashboardDataSource.update({where:{id:sourceId},data:{status:['CONNECTOR_AUTH_REQUIRED','CONNECTOR_PERMISSION_REQUIRED'].includes(code)?'EXPIRED':error instanceof ConnectorError&&error.retryAfterSeconds?'DELAYED':'FAILED',lastCheckedAt:new Date(),lastErrorCode:code}});
   }
  });throw error;
 }finally{
  await dashboardDb.$executeRaw`UPDATE "DashboardConnectorConfiguration" SET "activeRefreshJobId"=NULL,"activeRefreshLeaseToken"=NULL WHERE id=${initial.id} AND "activeRefreshJobId"=${job.id} AND "activeRefreshLeaseToken"=${job.leaseToken}`;
 }
}

