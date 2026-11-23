import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {dashboardStorageKey,writeDashboardObject,readDashboardObject} from '../src/server/storage';
import {governedWorkspace} from './fixtures/governed-workspace';
import {joinDatasets,suggestRelationships} from '../src/features/data-model/engine';
import {prepareDashboardRows} from '../src/engines/ingestion/ingest';
import {readDataModel,mutateDataModel} from '../src/features/data-model/service';
import {relationshipSource} from '../src/features/data-model/source';
import {readQuality,reviewQuality} from '../src/features/data-model/quality';
import {enqueueActorDashboardJob} from '../src/worker/queue';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {POST as modelPost} from '../src/app/api/workspaces/[workspaceId]/data-model/route';
import {POST as qualityPost} from '../src/app/api/workspaces/[workspaceId]/datasets/[datasetId]/quality/route';
after(()=>db.$disconnect());
const prepared=(rows:unknown)=>prepareDashboardRows(rows,'ALL');
test('joins preserve exact typed/composite keys, missing keys, unmatched rows and explicit fanout',()=>{
 const left=prepared([{id:'001',region:'US',value:5},{id:'002',region:'US',value:8},{id:null,region:'US',value:2}]),right=prepared([{id:'001',region:'US',label:'A'},{id:'003',region:'US',label:'B'},{id:null,region:'US',label:'C'}]);
 const mappings=[{left:'id',right:'id'},{left:'region',right:'region'}];
 assert.equal(joinDatasets(left,right,mappings,'ONE_TO_ONE','INNER').summary.outputRows,1);
 const full=joinDatasets(left,right,mappings,'ONE_TO_ONE','FULL');assert.equal(full.summary.outputRows,5);assert.equal(full.summary.leftMissingKeys,1);assert.equal(full.rows[0].left_id,'001');assert.equal(full.rows[0].right_label,'A');assert.equal(full.summary.unmatchedRightRows,2);
 assert.equal(joinDatasets(left,right,mappings,'ONE_TO_ONE','LEFT').summary.outputRows,3);assert.equal(joinDatasets(left,right,mappings,'ONE_TO_ONE','RIGHT').summary.outputRows,3);
 assert.equal(joinDatasets(prepared([{id:1}]),prepared([{id:'1'}]),[{left:'id',right:'id'}],'ONE_TO_ONE','INNER').summary.outputRows,0);
 const repeated=prepared([{id:'x',v:1},{id:'x',v:2}]);assert.throws(()=>joinDatasets(repeated,repeated,[{left:'id',right:'id'}],'MANY_TO_ONE','INNER'),/RELATIONSHIP_CARDINALITY/);assert.equal(joinDatasets(repeated,repeated,[{left:'id',right:'id'}],'MANY_TO_MANY','INNER').summary.outputRows,4);
 const many=prepared(Array.from({length:224},(_,i)=>({id:'x',v:i})));assert.throws(()=>joinDatasets(many,many,[{left:'id',right:'id'}],'MANY_TO_MANY','INNER'),/JOIN_LIMIT_EXCEEDED/);
 assert.throws(()=>joinDatasets(left,right,[{left:'unknown',right:'id'}],'ONE_TO_ONE','LEFT'),/INVALID_RELATIONSHIP/);
 const controller=new AbortController();controller.abort();assert.throws(()=>joinDatasets(left,right,mappings,'ONE_TO_ONE','LEFT',true,controller.signal));
});
test('suggestions show measured evidence without converting IDs or activating relationships',()=>{
 const a=prepared([{id:'001'},{id:'001'},{id:'002'}]),b=prepared([{id:'001'},{id:'003'}]),suggestions=suggestRelationships(a,b);
 assert.equal(suggestions.length,1);assert.equal(suggestions[0].cardinality,'MANY_TO_ONE');assert.equal(suggestions[0].matchingDistinctKeys,1);
 assert.equal(suggestRelationships(prepared([{amount:100}]),prepared([{total:100}])).length,0);
 assert.equal(suggestRelationships(prepared([{id:'001'}]),prepared([{id:'1'}])).length,0);
});
async function stage(f:Awaited<ReturnType<typeof governedWorkspace>>,name='Customers',bytes=Buffer.from('id,label\n001,Alice\n002,Bob\n'),datasetId?:string){
 const dataset=datasetId?await db.dashboardDataset.findUniqueOrThrow({where:{id:datasetId}}):await db.dashboardDataset.create({data:{workspaceId:f.workspace.id,name}});
 const id=randomUUID(),key=dashboardStorageKey(f.workspace.id,dataset.id,id);await writeDashboardObject(key,bytes);const number=await db.dashboardDatasetVersion.count({where:{datasetId:dataset.id}});
 await db.dashboardDatasetVersion.create({data:{id,datasetId:dataset.id,version:number+1,status:'PENDING',sourceFormat:'CSV',storageKey:key,fileSize:BigInt(bytes.length),checksum:createHash('sha256').update(bytes).digest('hex')}});await f.run('DATASET_INGEST',{datasetId:dataset.id,versionId:id,format:'csv'});return {datasetId:dataset.id,versionId:id};
}
function definition(f:Awaited<ReturnType<typeof governedWorkspace>>,other:{datasetId:string;versionId:string}){return {name:'Orders and customers',leftDatasetId:f.dataset.id,rightDatasetId:other.datasetId,leftVersionId:f.versionId,rightVersionId:other.versionId,mappings:[{left:'id',right:'id'}],cardinality:'ONE_TO_ONE',joinType:'LEFT',confirmed:true};}
async function created(f:Awaited<ReturnType<typeof governedWorkspace>>,other:{datasetId:string;versionId:string}){const result=await mutateDataModel(f.actor,f.workspace.id,{action:'CREATE',definition:definition(f,other)});return db.dashboardDataRelationship.findUniqueOrThrow({where:{id:(result as {id:string}).id}});}
test('relationship authoring validates current sources, permissions, strict input and concurrent revisions',async()=>{
 const f=await governedWorkspace();try{
  const other=await stage(f),d=definition(f,other);
  const candidates=await readDataModel(f.reader,f.workspace.id,f.dataset.id,other.datasetId);assert.ok('suggestions' in candidates&&candidates.suggestions?.length);
  assert.equal(await db.dashboardDataRelationship.count({where:{workspaceId:f.workspace.id}}),0);
  await assert.rejects(mutateDataModel(f.reader,f.workspace.id,{action:'CREATE',definition:d}),/FORBIDDEN/);
  await assert.rejects(mutateDataModel(f.actor,f.foreign.id,{action:'CREATE',definition:d}),/DATASET_UNAVAILABLE/);
  await assert.rejects(mutateDataModel(f.actor,f.workspace.id,{action:'CREATE',definition:{...d,confirmed:false}}),/INVALID_RELATIONSHIP/);
  await assert.rejects(mutateDataModel(f.actor,f.workspace.id,{action:'PREVIEW',definition:{...d,mappings:[{left:'made-up',right:'id'}]}}),/INVALID_RELATIONSHIP/);
  const row=await created(f,other),command={action:'UPDATE',id:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),definition:{...d,name:'Revised mapping'}};
  const race=await Promise.allSettled([mutateDataModel(f.actor,f.workspace.id,command),mutateDataModel(f.actor,f.workspace.id,command)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(mutateDataModel(f.actor,f.workspace.id,{action:'DELETE',id:row.id,expectedUpdatedAt:row.updatedAt.toISOString()}),/RELATIONSHIP_CONFLICT/);
  const current=await db.dashboardDataRelationship.findUniqueOrThrow({where:{id:row.id}});await mutateDataModel(f.actor,f.workspace.id,{action:'DELETE',id:row.id,expectedUpdatedAt:current.updatedAt.toISOString()});assert.equal(await db.dashboardDataRelationship.count({where:{workspaceId:f.workspace.id}}),0);
  assert.ok(await db.dashboardAuditEvent.count({where:{workspaceId:f.workspace.id,action:{startsWith:'DATA_RELATIONSHIP_'}}})>=3);
 }finally{await f.cleanup();}
});
test('real join worker publishes a separately profiled version with lineage and safe replay',async()=>{
 const f=await governedWorkspace();try{
  const other=await stage(f),row=await created(f,other),before=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}});
  const request={action:'EXECUTE',id:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),name:'Joined orders',requestId:randomUUID()};
  const queued=await mutateDataModel(f.actor,f.workspace.id,request);assert.ok('id' in queued);assert.equal((await mutateDataModel(f.actor,f.workspace.id,request) as {id:string}).id,queued.id);
  assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');const job=await db.dashboardJob.findUniqueOrThrow({where:{id:queued.id}}),result=job.result as {datasetId:string;versionId:string};assert.ok(job.effectCommittedAt);
  assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');const joined=await relationshipSource(f.workspace.id,result.datasetId,result.versionId);assert.equal(joined.prepared.rows[0].left_id,'001');assert.equal(joined.prepared.rows[0].right_label,'Alice');assert.equal(joined.version.importMode,'JOIN');assert.ok((joined.version.semantics as {confirmationRequired:boolean}).confirmationRequired);assert.equal((joined.version.importSummary as {relationshipId:string}).relationshipId,row.id);
  assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id:f.dataset.id}})).activeVersionId,f.versionId);assert.equal(createHash('sha256').update(await readDashboardObject(before.storageKey)).digest('hex'),before.checksum);
  await mutateDataModel(f.actor,f.workspace.id,request);assert.equal(await db.dashboardDataset.count({where:{workspaceId:f.workspace.id,name:'Joined orders'}}),1);
 }finally{await f.cleanup();}
});
test('stale relationship versions, tenant references and revoked custom permissions cannot publish joins',async()=>{
 const f=await governedWorkspace();try{
  const other=await stage(f),row=await created(f,other),payload={relationshipId:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),name:'Must not publish'};
  await assert.rejects(enqueueActorDashboardJob(f.actor,f.foreign.id,'DATASET_JOIN',payload,randomUUID()),/RELATIONSHIP_CONFLICT/);
  const user=f.reader.userId;await db.dashboardMembership.update({where:{userId_workspaceId:{userId:user,workspaceId:f.workspace.id}},data:{role:'EDITOR'}});const membership=await db.dashboardMembership.findUniqueOrThrow({where:{userId_workspaceId:{userId:user,workspaceId:f.workspace.id}}});const profile=await db.dashboardWorkspaceRole.create({data:{workspaceId:f.workspace.id,key:'limited',name:'Jobs only',permissions:['workspace.read','jobs.read','jobs.manage']}});await db.dashboardPermissionGrant.create({data:{workspaceId:f.workspace.id,userId:user,membershipId:membership.id,roleId:profile.id}});await assert.rejects(enqueueActorDashboardJob(f.reader,f.workspace.id,'DATASET_JOIN',payload,randomUUID()),/FORBIDDEN/);
  await stage(f,'Customers',Buffer.from('id,label\n001,Updated\n'),other.datasetId);const model=await readDataModel(f.actor,f.workspace.id);assert.ok('relationships' in model&&!model.relationships?.find(r=>r.id===row.id)?.current);
  await assert.rejects(enqueueActorDashboardJob(f.actor,f.workspace.id,'DATASET_JOIN',payload,randomUUID()),/RELATIONSHIP_CONFLICT/);const job=await db.dashboardJob.create({data:{workspaceId:f.workspace.id,kind:'DATASET_JOIN',payload,idempotencyKey:randomUUID()}});await assert.rejects(runDashboardWorkerOnce(),/VERSION_CONFLICT/);assert.equal((await db.dashboardJob.findUniqueOrThrow({where:{id:job.id}})).lastError,'VERSION_CONFLICT');assert.equal(await db.dashboardDataset.count({where:{workspaceId:f.workspace.id,name:'Must not publish'}}),0);
 }finally{await f.cleanup();}
});
test('quality review retains evidence, rejects stale edits and requires a corrected passing version',async()=>{
 const f=await governedWorkspace();try{
  const source=await stage(f,'Quality source',Buffer.from('id,label\n001,Alpha\n001,Alpha\n002,\n'));await f.run('DATASET_VALIDATE',{datasetId:source.datasetId,versionId:source.versionId});
  let review=await readQuality(f.actor,f.workspace.id,source.datasetId),issue=review.checks[0].issues[0];assert.equal(review.checks[0].status,'FAIL');assert.ok(issue);
  const command={issueId:issue.id,expectedRevision:issue.revision,action:'ACKNOWLEDGE',note:'Duplicates reviewed before correction.'};await assert.rejects(reviewQuality(f.reader,f.workspace.id,source.datasetId,command),/FORBIDDEN/);await reviewQuality(f.actor,f.workspace.id,source.datasetId,command);
  await assert.rejects(reviewQuality(f.actor,f.workspace.id,source.datasetId,command),/QUALITY_CONFLICT/);review=await readQuality(f.actor,f.workspace.id,source.datasetId);issue=review.checks[0].issues[0];assert.equal(issue.resolvedAt,null);assert.equal(review.checks[0].status,'FAIL');
  await assert.rejects(reviewQuality(f.actor,f.workspace.id,source.datasetId,{...command,expectedRevision:issue.revision,action:'RESOLVE_FIXED',verificationCheckId:review.checks[0].id}),/QUALITY_VERIFICATION_REQUIRED/);
  const transformed=await f.run('DATASET_TRANSFORM',{datasetId:source.datasetId,versionId:source.versionId,operations:[{type:'DROP_DUPLICATES'},{type:'REPLACE_VALUE',field:'label',from:'Alpha',value:'Reviewed'},{type:'FILL_EMPTY',field:'label',value:'Unknown'}]});assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');
  const output=await relationshipSource(f.workspace.id,source.datasetId);assert.equal(output.prepared.rows.length,2);assert.deepEqual(output.prepared.rows.map(r=>r.label),['Reviewed','Unknown']);let check=await f.run('DATASET_VALIDATE',{datasetId:source.datasetId,versionId:transformed.versionId});assert.equal(check.status,'PASS');
  const semanticIssue=await db.dashboardQualityIssue.create({data:{workspaceId:f.workspace.id,checkId:issue.checkId,code:'ROW_GRAIN',severity:'ERROR',details:{message:'Prior business grain requires governed verification.'}}});const semanticReview=(await readQuality(f.actor,f.workspace.id,source.datasetId)).checks.flatMap(c=>c.issues).find(i=>i.id===semanticIssue.id)!;
  await assert.rejects(reviewQuality(f.actor,f.workspace.id,source.datasetId,{...command,issueId:semanticIssue.id,expectedRevision:semanticReview.revision,action:'RESOLVE_FIXED',verificationCheckId:check.checkId}),/QUALITY_VERIFICATION_REQUIRED/);
  await db.dashboardDatasetVersion.update({where:{id:transformed.versionId},data:{semanticRevision:{increment:1}}});await assert.rejects(reviewQuality(f.actor,f.workspace.id,source.datasetId,{...command,expectedRevision:issue.revision,action:'RESOLVE_FIXED',verificationCheckId:check.checkId}),/QUALITY_VERIFICATION_REQUIRED/);check=await f.run('DATASET_VALIDATE',{datasetId:source.datasetId,versionId:transformed.versionId});
  await reviewQuality(f.actor,f.workspace.id,source.datasetId,{...command,expectedRevision:issue.revision,action:'RESOLVE_FIXED',verificationCheckId:check.checkId});assert.ok((await db.dashboardQualityIssue.findUniqueOrThrow({where:{id:issue.id}})).resolvedAt);assert.equal((await db.dashboardQualityCheck.findUniqueOrThrow({where:{id:issue.checkId}})).status,'FAIL');
  const latest=(await readQuality(f.actor,f.workspace.id,source.datasetId)).checks.flatMap(c=>c.issues).find(i=>i.id===issue.id)!;await reviewQuality(f.actor,f.workspace.id,source.datasetId,{...command,expectedRevision:latest.revision,action:'REOPEN'});assert.equal((await db.dashboardQualityIssue.findUniqueOrThrow({where:{id:issue.id}})).resolvedAt,null);
 }finally{await f.cleanup();}
});
test('data workflow HTTP boundaries reject cross-origin, forged input and oversized requests',async()=>{
 const f=await governedWorkspace(),oldOrigin=process.env.DASHBOARD_PUBLIC_ORIGIN;process.env.DASHBOARD_PUBLIC_ORIGIN='https://dashboard.test';try{
  const other=await stage(f),body={action:'CREATE',definition:definition(f,other)},token=await issueDashboardBrowserSession(f.actor),context={params:Promise.resolve({workspaceId:f.workspace.id,datasetId:f.dataset.id})};
  const request=(b:unknown,origin='https://dashboard.test',sessionToken=token)=>new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/data-model',{method:'POST',headers:{cookie:'__Secure-averidi-dashboard='+sessionToken,origin,'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await modelPost(request(body,'https://evil.test'),context)).status,403);assert.equal((await modelPost(request({...body,actor:f.actor}),context)).status,422);assert.equal((await modelPost(request({...body,extra:'x'.repeat(17000)}),context)).status,422);assert.equal((await qualityPost(request({action:'VALIDATE',versionId:f.versionId,requestId:randomUUID()},'https://evil.test'),context)).status,403);assert.equal((await modelPost(request(body),context)).status,200);
  const member=await db.dashboardMembership.findUniqueOrThrow({where:{userId_workspaceId:{userId:f.reader.userId,workspaceId:f.workspace.id}}}),profile=await db.dashboardWorkspaceRole.create({data:{workspaceId:f.workspace.id,key:'read-only-data',name:'Read only data',permissions:['workspace.read','datasets.read','analysis.read','views.read']}});await db.dashboardPermissionGrant.create({data:{workspaceId:f.workspace.id,userId:f.reader.userId,membershipId:member.id,roleId:profile.id}});const readerToken=await issueDashboardBrowserSession(f.reader);assert.equal((await modelPost(request({...body,action:'PREVIEW'},'https://dashboard.test',readerToken),context)).status,200);assert.equal((await modelPost(request(body,'https://dashboard.test',readerToken),context)).status,403);
 }finally{if(oldOrigin===undefined)delete process.env.DASHBOARD_PUBLIC_ORIGIN;else process.env.DASHBOARD_PUBLIC_ORIGIN=oldOrigin;await f.cleanup();}
});
