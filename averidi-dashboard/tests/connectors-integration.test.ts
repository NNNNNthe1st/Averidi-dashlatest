import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {connectorProviders,type ConnectorProvider,ConnectorError} from '../src/features/connectors/contracts';
import {createConnector,listConnectors,beginConnectorAuthorization,completeConnectorAuthorization,setConnectorApiCredential,saveConnectorCredential,usableConnectorCredential,queueConnectorRefresh,disconnectConnector} from '../src/features/connectors/service';
import {openDashboardCredential} from '../src/features/data-sources/credentials';
import {processConnectorRefresh} from '../src/worker/handlers/connectors';
import {claimDashboardJob,finishDashboardJob} from '../src/worker/job-claim';
import {workerArtifactId} from '../src/worker/effects';
import {scheduleDashboardJob,dispatchDueDashboardSchedules} from '../src/worker/queue';
import {connectorConfigs,connectorFixture,providerSnapshot} from './fixtures/connectors';
import {dashboardStorageKey,readDashboardObject} from '../src/server/storage';
import {markFailedDashboardProfile} from '../src/worker/profile-failure';

test('all eight connectors: scoped credentials, OAuth/renewal/revocation, persisted worker snapshots and failure preservation',async()=>{
 const previous={...process.env};let workspaceId='',otherWorkspaceId='',userId='',peerId='';
 Object.assign(process.env,{DASHBOARD_DATA_CONNECTORS_ENABLED:'true',DASHBOARD_CONNECTOR_ENCRYPTION_KEY:randomBytes(32).toString('hex'),DASHBOARD_PUBLIC_ORIGIN:'https://dashboard.example.test',DASHBOARD_CONNECTOR_WOOCOMMERCE_ORIGINS:connectorConfigs.WOOCOMMERCE.origin});
 for(const provider of connectorProviders){process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_ID`]='client-'+provider;process.env[`DASHBOARD_CONNECTOR_${provider}_CLIENT_SECRET`]='secret-'+provider;}
 const fixtures=new Map<ConnectorProvider,ReturnType<typeof connectorFixture>>();const connections=new Map<ConnectorProvider,Awaited<ReturnType<typeof createConnector>>>();
 try{
  const user=await db.dashboardUser.create({data:{externalSubject:'connectors|'+randomUUID()}});userId=user.id;
  const peer=await db.dashboardUser.create({data:{externalSubject:'connectors-peer|'+randomUUID()}});peerId=peer.id;
  const workspace=await db.dashboardWorkspace.create({data:{name:'Connector acceptance'}});workspaceId=workspace.id;
  otherWorkspaceId=(await db.dashboardWorkspace.create({data:{name:'Foreign connector workspace'}})).id;
  await db.dashboardMembership.createMany({data:[{workspaceId,userId,role:'OWNER'},{workspaceId,userId:peerId,role:'EDITOR'},{workspaceId:otherWorkspaceId,userId,role:'OWNER'}]});
  await db.dashboardSubscription.createMany({data:[workspaceId,otherWorkspaceId].map(id=>({workspaceId:id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}))});
  const actor={userId,issuer:'connector-test',subject:'actor'},peerActor={userId:peerId,issuer:'connector-test',subject:'peer'};
  for(const provider of connectorProviders){
   const fixture=connectorFixture(provider);fixtures.set(provider,fixture);
   const created=await createConnector(actor,workspaceId,{provider,name:provider+' fixture',configuration:connectorConfigs[provider]});connections.set(provider,created);
   await assert.rejects(()=>queueConnectorRefresh(actor,otherWorkspaceId,created.connectorId,'wrong-workspace'),/CONNECTOR_NOT_FOUND/);
   if(provider==='WOOCOMMERCE')await setConnectorApiCredential(actor,workspaceId,created.connectorId,{consumerKey:'ck_'+'a'.repeat(32),consumerSecret:'cs_'+'b'.repeat(32)},fixture.transport);
   else{
    const authorization=await beginConnectorAuthorization(actor,workspaceId,created.connectorId);const url=new URL(authorization.authorizationUrl);assert.equal(url.searchParams.get('response_type'),'code');
    const params=new URLSearchParams({state:url.searchParams.get('state')!,code:'fixture-code'});
    if(provider==='QUICKBOOKS')params.set('realmId',connectorConfigs.QUICKBOOKS.realmId!);
    if(provider==='SHOPIFY'){params.set('shop',connectorConfigs.SHOPIFY.shop!);params.set('timestamp',String(Math.floor(Date.now()/1000)));const message=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');params.set('hmac',createHmac('sha256','secret-SHOPIFY').update(message).digest('hex'));}
    await assert.rejects(()=>completeConnectorAuthorization(peerActor,workspaceId,created.connectorId,params,fixture.transport),/CONNECTOR_OAUTH_REJECTED/);
    await completeConnectorAuthorization(actor,workspaceId,created.connectorId,params,fixture.transport);
    await assert.rejects(()=>completeConnectorAuthorization(actor,workspaceId,created.connectorId,params,fixture.transport),/CONNECTOR_OAUTH_REJECTED/);
    const reference=await db.dashboardCredentialReference.findFirstOrThrow({where:{connectorId:created.connectorId}});
    assert.ok(reference.encryptedValue&&!reference.encryptedValue.includes('access-'));
    const credential=JSON.parse(openDashboardCredential(reference.encryptedValue!,workspaceId,created.sourceId));credential.expiresAt=Date.now()-1000;
    await db.$transaction(tx=>saveConnectorCredential(tx,workspaceId,created.sourceId,created.connectorId,credential));
    const rotated=await Promise.all(Array.from({length:3},()=>usableConnectorCredential(workspaceId,created.connectorId,fixture.transport)));
    assert.equal(fixture.refreshes,1,'concurrent refresh must rotate once');assert.ok(rotated.every(result=>result.credential.accessToken==='access-'+provider+'-1'));
   }
   const queued=await queueConnectorRefresh(actor,workspaceId,created.connectorId,'refresh_'+provider);
   assert.equal((await queueConnectorRefresh(actor,workspaceId,created.connectorId,'refresh_'+provider)).id,queued.id);
   const job=await claimDashboardJob();assert.equal(job?.id,queued.id);
   const result=await processConnectorRefresh(job!,undefined,fixture.transport);await finishDashboardJob(job!.id,job!.leaseToken!,true,undefined,result);
   const dataset=await db.dashboardDataset.findUniqueOrThrow({where:{id:created.datasetId},include:{versions:true}});assert.equal(dataset.status,'READY');assert.equal(dataset.versions.length,1);assert.equal(dataset.activeVersionId,dataset.versions[0].id);
   assert.ok((await db.dashboardJob.findUniqueOrThrow({where:{id:job!.id}})).effectCommittedAt);
   const source=await db.dashboardDataSource.findUniqueOrThrow({where:{id:created.sourceId}});assert.equal(source.status,'CONNECTED');assert.ok(source.lastSyncedAt);
   const bytes=await readDashboardObject(dashboardStorageKey(workspaceId,created.datasetId,dataset.activeVersionId!));if(provider==='GOOGLE_SHEETS')assert.match(bytes.toString(),/"001"/);
   assert.equal(await db.dashboardRefreshExecution.count({where:{jobId:job!.id,status:'COMPLETED'}}),1);
  }
  const safe=JSON.stringify(await listConnectors(actor,workspaceId));assert.ok(!safe.includes('access-')&&!safe.includes('refresh-')&&!safe.includes('consumerSecret')&&!safe.includes('encryptedValue'));
  const google=connections.get('GOOGLE_SHEETS')!,active=(await db.dashboardDataset.findUniqueOrThrow({where:{id:google.datasetId}})).activeVersionId;
  // Native queue retry preserves Retry-After and leaves the last-good version untouched.
  const failed=await queueConnectorRefresh(actor,workspaceId,google.connectorId,'limited-refresh');const failedClaim=await claimDashboardJob();assert.equal(failedClaim?.id,failed.id);
  await assert.rejects(()=>processConnectorRefresh(failedClaim!,undefined,async()=>({status:429,headers:{'retry-after':'180'},body:{error:'customer-secret'}})),e=>e instanceof ConnectorError&&e.message==='CONNECTOR_RATE_LIMITED');
  await finishDashboardJob(failed.id,failedClaim!.leaseToken!,false,'CONNECTOR_RATE_LIMITED',undefined,180);
  const delayed=await db.dashboardJob.findUniqueOrThrow({where:{id:failed.id}});assert.equal(delayed.status,'QUEUED');assert.ok(delayed.availableAt.getTime()>Date.now()+170000);assert.equal(delayed.lastError,'CONNECTOR_RATE_LIMITED');
  assert.equal((await db.dashboardDataSource.findUniqueOrThrow({where:{id:google.sourceId}})).status,'DELAYED');assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id:google.datasetId}})).activeVersionId,active);
  const blocked=await queueConnectorRefresh(actor,workspaceId,google.connectorId,'cooldown-refresh');const blockedClaim=await claimDashboardJob();assert.equal(blockedClaim?.id,blocked.id);let extraRequests=0;
  await assert.rejects(()=>processConnectorRefresh(blockedClaim!,undefined,async()=>{extraRequests++;throw Error('must not call provider during cooldown');}),/CONNECTOR_RATE_LIMITED/);assert.equal(extraRequests,0);
  await finishDashboardJob(blocked.id,blockedClaim!.leaseToken!,false,'CONNECTOR_RATE_LIMITED',undefined,180);
  const superseded=await beginConnectorAuthorization(actor,workspaceId,google.connectorId);await beginConnectorAuthorization(actor,workspaceId,google.connectorId);
  await assert.rejects(()=>completeConnectorAuthorization(actor,workspaceId,google.connectorId,new URLSearchParams({state:new URL(superseded.authorizationUrl).searchParams.get('state')!,code:'fixture-code'}),fixtures.get('GOOGLE_SHEETS')!.transport),/CONNECTOR_OAUTH_REJECTED/);
  const schedule=await scheduleDashboardJob(workspaceId,'SOURCE_REFRESH',{sourceId:google.sourceId,datasetId:google.datasetId},60,new Date(Date.now()-1000));
  await Promise.all([dispatchDueDashboardSchedules(),dispatchDueDashboardSchedules()]);assert.equal(await db.dashboardJob.count({where:{workspaceId,idempotencyKey:{startsWith:'schedule_'}}}),1);
  await db.dashboardJobSchedule.update({where:{id:schedule.id},data:{enabled:false}});
  await db.$executeRaw`UPDATE "DashboardConnectorConfiguration" SET "refreshNotBefore"=NULL WHERE id=${google.connectorId}`;
  // Disconnect during a real in-flight fetch must fence publication, including old credentials.
  const queued=await queueConnectorRefresh(actor,workspaceId,google.connectorId,'disconnect-race');
  await db.dashboardJob.updateMany({where:{workspaceId,status:'QUEUED',id:{not:queued.id}},data:{status:'CANCELLED',finishedAt:new Date()}});
  const claim=await claimDashboardJob();assert.equal(claim?.id,queued.id);let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r}),hold=new Promise<void>(r=>{release=r});
  const processing=processConnectorRefresh(claim!,undefined,async input=>{entered();await hold;return providerSnapshot('GOOGLE_SHEETS',input);});
  const rejected=assert.rejects(processing,/CONNECTOR_CHANGED/);await started;
  const busy=await queueConnectorRefresh(actor,workspaceId,google.connectorId,'busy-refresh');const busyClaim=await claimDashboardJob();assert.equal(busyClaim?.id,busy.id);
  await assert.rejects(()=>processConnectorRefresh(busyClaim!,undefined,async()=>{throw Error('parallel refresh must not reach provider');}),/CONNECTOR_REFRESH_BUSY/);
  await finishDashboardJob(busy.id,busyClaim!.leaseToken!,false,'CONNECTOR_REFRESH_BUSY');
  await disconnectConnector(actor,workspaceId,google.connectorId,fixtures.get('GOOGLE_SHEETS')!.transport);release();await rejected;
  await finishDashboardJob(claim!.id,claim!.leaseToken!,false,'CONNECTOR_CHANGED');await markFailedDashboardProfile(claim!);
  assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id:google.datasetId}})).activeVersionId,active);assert.equal((await db.dashboardDataSource.findUniqueOrThrow({where:{id:google.sourceId}})).status,'DISCONNECTED');
  assert.equal((await db.dashboardConnectorConfiguration.findUniqueOrThrow({where:{id:google.connectorId}})).activeRefreshJobId,null);
  for(const provider of connectorProviders.filter(p=>p!=='GOOGLE_SHEETS')){const created=connections.get(provider)!;const result=await disconnectConnector(actor,workspaceId,created.connectorId,fixtures.get(provider)!.transport);assert.equal(result.disconnected,true);assert.equal(await db.dashboardCredentialReference.count({where:{connectorId:created.connectorId,encryptedValue:{not:null}}}),0);}
  assert.equal(await db.dashboardRefreshExecution.count({where:{id:workerArtifactId(claim!.id,'refresh'),status:'FAILED'}}),1);
 }finally{
  if(workspaceId)await db.dashboardWorkspace.delete({where:{id:workspaceId}});if(otherWorkspaceId)await db.dashboardWorkspace.delete({where:{id:otherWorkspaceId}});if(userId)await db.dashboardUser.delete({where:{id:userId}});if(peerId)await db.dashboardUser.delete({where:{id:peerId}});
  for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);
 }
});
