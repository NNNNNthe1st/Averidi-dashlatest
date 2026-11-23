import {setAuditActor} from '../audit/context';
import {assertCustomPermission} from '../permissions/policy';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {requireWorkspaceRole,type VerifiedDashboardActor} from '../../server/workspace-access';
import {requireDashboardEntitlement} from '../subscriptions/entitlements';
import {sealDashboardCredential,openDashboardCredential} from '../data-sources/credentials';
import {connectorProviders,assertProviderConfigured,connectorCreateSchema,connectorConfiguration,apiCredentialSchema,credentialSchema,type ConnectorCredential,type ConnectorProvider} from './contracts';
import {connectorScopes,connectorAuthorizationURL,verifyConnectorCallback,exchangeConnectorToken,revokeConnectorToken} from './oauth';
import {connectorTransport,type ConnectorTransport,assertConnectorURL,connectorRequest,records} from './http';
import {enqueueActorDashboardJob} from '../../worker/queue';
async function editor(actor:VerifiedDashboardActor,workspaceId:string){
 if(!await requireWorkspaceRole(actor,workspaceId,'EDITOR'))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,'connectors.manage');
 if(!await requireDashboardEntitlement(actor,workspaceId))throw Error('SUBSCRIPTION_REQUIRED');
}
async function connection(workspaceId:string,id:string){const found=await dashboardDb.dashboardConnectorConfiguration.findFirst({where:{id,workspaceId},include:{source:true}});if(!found)throw Error('CONNECTOR_NOT_FOUND');return found;}
export function connectorRedirectURL(){
 const origin=new URL(process.env.DASHBOARD_PUBLIC_ORIGIN??'');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('CONNECTOR_NOT_CONFIGURED');
 return `${origin.origin}/dashboard/app/api/connectors/callback`;
}
export async function createConnector(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){
 await editor(actor,workspaceId);const parsed=connectorCreateSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_CONNECTOR_CONFIGURATION');
 const {provider,name}=parsed.data;assertProviderConfigured(provider);const config=connectorConfiguration(provider,parsed.data.configuration);
 if(provider==='WOOCOMMERCE')assertConnectorURL(config.origin!+'/');
 const result=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  const source=await tx.dashboardDataSource.create({data:{workspaceId,kind:provider,name,status:'DISCONNECTED'}});
  const connector=await tx.dashboardConnectorConfiguration.create({data:{workspaceId,sourceId:source.id,provider,configuration:config as Prisma.InputJsonValue,scopes:connectorScopes[provider],enabled:false}});
  const dataset=await tx.dashboardDataset.create({data:{workspaceId,sourceId:source.id,name,status:'INGESTING'}});
  return {connectorId:connector.id,sourceId:source.id,datasetId:dataset.id,provider,status:'DISCONNECTED'};
 });return result;
}
export async function listConnectors(actor:VerifiedDashboardActor,workspaceId:string){
 if(!await requireWorkspaceRole(actor,workspaceId,'VIEWER'))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,'connectors.read');
 if(!await requireDashboardEntitlement(actor,workspaceId))throw Error('SUBSCRIPTION_REQUIRED');
 return dashboardDb.dashboardConnectorConfiguration.findMany({where:{workspaceId,provider:{in:[...connectorProviders]}},take:100,orderBy:{createdAt:'desc'},select:{id:true,provider:true,sourceId:true,configuration:true,scopes:true,enabled:true,updatedAt:true,source:{select:{name:true,status:true,lastCheckedAt:true,lastSyncedAt:true,lastErrorCode:true,datasets:{select:{id:true,name:true,activeVersionId:true}}}}}});
}
async function lock(tx:Prisma.TransactionClient,id:string,workspaceId:string){await tx.$queryRaw`SELECT id FROM "DashboardConnectorConfiguration" WHERE id=${id} AND "workspaceId"=${workspaceId} FOR UPDATE`;}
export async function saveConnectorCredential(tx:Prisma.TransactionClient,workspaceId:string,sourceId:string,connectorId:string,credential:ConnectorCredential){
 const encryptedValue=sealDashboardCredential(JSON.stringify(credentialSchema.parse(credential)),workspaceId,sourceId);
 await tx.dashboardCredentialReference.upsert({where:{connectorId_purpose:{connectorId,purpose:'ACCESS'}},create:{workspaceId,connectorId,purpose:'ACCESS',secretReference:'dashboard-secret:'+randomUUID(),encryptedValue,keyVersion:'v1',expiresAt:credential.expiresAt?new Date(credential.expiresAt):null},update:{encryptedValue,keyVersion:'v1',expiresAt:credential.expiresAt?new Date(credential.expiresAt):null,revokedAt:null}});
}
export async function beginConnectorAuthorization(actor:VerifiedDashboardActor,workspaceId:string,id:string){
 await editor(actor,workspaceId);const found=await connection(workspaceId,id),provider=found.provider as ConnectorProvider;assertProviderConfigured(provider);
 const config=connectorConfiguration(provider,found.configuration),state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
 const url=connectorAuthorizationURL(provider,config,state,connectorRedirectURL(),verifier);
 await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await lock(tx,id,workspaceId);
  await tx.dashboardConnectorOAuthAttempt.updateMany({where:{connectorId:id,consumedAt:null},data:{consumedAt:new Date()}});
  const attemptId=createHash('sha256').update(state).digest('hex');
  await tx.$executeRaw`UPDATE "DashboardConnectorConfiguration" SET "oauthAttemptId"=${attemptId} WHERE id=${id}`;
  await tx.dashboardConnectorOAuthAttempt.create({data:{id:attemptId,workspaceId,userId:actor.userId,connectorId:id,encryptedVerifier:sealDashboardCredential(verifier,workspaceId,found.sourceId),expiresAt:new Date(Date.now()+300000)}});
 });return {authorizationUrl:url};
}
export async function completeConnectorAuthorization(actor:VerifiedDashboardActor,workspaceId:string,id:string,params:URLSearchParams,transport:ConnectorTransport=connectorTransport){
 await editor(actor,workspaceId);const found=await connection(workspaceId,id),provider=found.provider as ConnectorProvider;assertProviderConfigured(provider);
 const config=connectorConfiguration(provider,found.configuration);verifyConnectorCallback(provider,config,params);
 const state=params.get('state')??'';if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw Error('CONNECTOR_OAUTH_REJECTED');
 // Consume before the remote exchange. A failed exchange requires a new user-authorized attempt.
 const attempt=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await lock(tx,id,workspaceId);
  const attemptId=createHash('sha256').update(state).digest('hex');
  const row=await tx.dashboardConnectorOAuthAttempt.findFirst({where:{id:attemptId,connectorId:id,workspaceId,userId:actor.userId,consumedAt:null,expiresAt:{gt:new Date()}}});
  if(!row)throw Error('CONNECTOR_OAUTH_REJECTED');
  await tx.dashboardConnectorOAuthAttempt.update({where:{id:row.id},data:{consumedAt:new Date()}});return row;
 });
 const credential=await exchangeConnectorToken(provider,config,{code:params.get('code')!,redirect:connectorRedirectURL(),verifier:openDashboardCredential(attempt.encryptedVerifier,workspaceId,found.sourceId)},transport);
 await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await lock(tx,id,workspaceId);
  const current=await tx.dashboardConnectorConfiguration.findFirst({where:{id,workspaceId,updatedAt:found.updatedAt}});
  if(!current||current.oauthAttemptId!==attempt.id||!await tx.dashboardMembership.count({where:{workspaceId,userId:actor.userId,role:{in:['OWNER','EDITOR']}}}))throw Error('CONNECTOR_CHANGED');
  await assertCustomPermission(actor,workspaceId,'connectors.manage',tx);
  // A newer authorization attempt invalidates an older callback still exchanging tokens.
  await saveConnectorCredential(tx,workspaceId,found.sourceId,id,credential);
  await tx.dashboardConnectorConfiguration.update({where:{id},data:{enabled:true,oauthAttemptId:null,refreshNotBefore:null}});
  await tx.dashboardDataSource.update({where:{id:found.sourceId},data:{status:'CONNECTED',lastCheckedAt:new Date(),lastErrorCode:null}});
 });return {connected:true,connectorId:id};
}
export async function setConnectorApiCredential(actor:VerifiedDashboardActor,workspaceId:string,id:string,input:unknown,transport:ConnectorTransport=connectorTransport){
 await editor(actor,workspaceId);const found=await connection(workspaceId,id);if(found.provider!=='WOOCOMMERCE')throw Error('CONNECTOR_API_AUTH_UNSUPPORTED');assertProviderConfigured('WOOCOMMERCE');
 const parsed=apiCredentialSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_CONNECTOR_CREDENTIAL');
 const config=connectorConfiguration('WOOCOMMERCE',found.configuration);
 records((await connectorRequest({url:config.origin+'/wp-json/wc/v3/orders?per_page=1&page=1',headers:{Authorization:'Basic '+Buffer.from(parsed.data.consumerKey+':'+parsed.data.consumerSecret).toString('base64')}},transport)).body);
 await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await lock(tx,id,workspaceId);await saveConnectorCredential(tx,workspaceId,found.sourceId,id,{accessToken:JSON.stringify(parsed.data)});await tx.dashboardConnectorConfiguration.update({where:{id},data:{enabled:true,oauthAttemptId:null,refreshNotBefore:null}});await tx.dashboardDataSource.update({where:{id:found.sourceId},data:{status:'CONNECTED',lastErrorCode:null,lastCheckedAt:new Date()}});});return {connected:true};
}
/** Serialize refresh-token rotation across processes; ciphertext updates commit before data reads. */
export async function usableConnectorCredential(workspaceId:string,id:string,transport:ConnectorTransport=connectorTransport,signal?:AbortSignal){
 return dashboardDb.$transaction(async tx=>{
  await lock(tx,id,workspaceId);signal?.throwIfAborted();
  const found=await tx.dashboardConnectorConfiguration.findFirst({where:{id,workspaceId,enabled:true}});if(!found)throw Error('CONNECTOR_DISCONNECTED');
  const provider=found.provider as ConnectorProvider;assertProviderConfigured(provider);
  const reference=await tx.dashboardCredentialReference.findFirst({where:{connectorId:id,workspaceId,purpose:'ACCESS',revokedAt:null}});
  if(!reference?.encryptedValue)throw Error('CONNECTOR_AUTH_REQUIRED');
  let credential=credentialSchema.parse(JSON.parse(openDashboardCredential(reference.encryptedValue,workspaceId,found.sourceId)));
  if(credential.expiresAt!==undefined&&credential.expiresAt<Date.now()+60000){credential=await exchangeConnectorToken(provider,connectorConfiguration(provider,found.configuration),{credential},transport,signal);await saveConnectorCredential(tx,workspaceId,found.sourceId,id,credential);}
  return {connector:found,credential};
 },{timeout:25000,maxWait:5000});
}
export async function queueConnectorRefresh(actor:VerifiedDashboardActor,workspaceId:string,id:string,key:string){
 await editor(actor,workspaceId);const found=await connection(workspaceId,id);assertProviderConfigured(found.provider as ConnectorProvider);if(!found.enabled)throw Error('CONNECTOR_DISCONNECTED');
 const dataset=await dashboardDb.dashboardDataset.findFirst({where:{workspaceId,sourceId:found.sourceId,status:{not:'ARCHIVED'}}});if(!dataset)throw Error('DATASET_UNAVAILABLE');
 return enqueueActorDashboardJob(actor,workspaceId,'SOURCE_REFRESH',{sourceId:found.sourceId,datasetId:dataset.id},key);
}
export async function disconnectConnector(actor:VerifiedDashboardActor,workspaceId:string,id:string,transport:ConnectorTransport=connectorTransport){
 // A member may always remove a connection even after subscription expiry.
 if(!await requireWorkspaceRole(actor,workspaceId,'EDITOR'))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,'connectors.manage');
 const found=await connection(workspaceId,id);
 const reference=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await lock(tx,id,workspaceId);
  await tx.dashboardConnectorConfiguration.update({where:{id},data:{enabled:false,oauthAttemptId:null,activeRefreshJobId:null,activeRefreshLeaseToken:null,refreshNotBefore:null}});
  await tx.dashboardConnectorOAuthAttempt.updateMany({where:{connectorId:id,consumedAt:null},data:{consumedAt:new Date()}});
  const ref=await tx.dashboardCredentialReference.findFirst({where:{connectorId:id,purpose:'ACCESS'}});
  if(ref)await tx.dashboardCredentialReference.update({where:{id:ref.id},data:{revokedAt:new Date()}});
  await tx.dashboardDataSource.update({where:{id:found.sourceId},data:{status:'DISCONNECTED',lastCheckedAt:new Date(),lastErrorCode:null}});return ref;
 });
 if(!reference?.encryptedValue)return {disconnected:true,remoteRevoked:false};
 try{
  const credential=credentialSchema.parse(JSON.parse(openDashboardCredential(reference.encryptedValue,workspaceId,found.sourceId)));
  if(process.env.DASHBOARD_DATA_CONNECTORS_ENABLED!=='true')return {disconnected:true,remoteRevoked:false,revocationPending:true};
  const result=await revokeConnectorToken(found.provider as ConnectorProvider,connectorConfiguration(found.provider as ConnectorProvider,found.configuration),credential,transport);
  await dashboardDb.dashboardCredentialReference.updateMany({where:{id:reference.id,revokedAt:{not:null},encryptedValue:reference.encryptedValue},data:{encryptedValue:null}});
  return {disconnected:true,...result};
 }catch{
  await dashboardDb.dashboardDataSource.updateMany({where:{id:found.sourceId,status:'DISCONNECTED'},data:{lastErrorCode:'CONNECTOR_REVOCATION_PENDING'}});
  return {disconnected:true,remoteRevoked:false,revocationPending:true};
 }
}
