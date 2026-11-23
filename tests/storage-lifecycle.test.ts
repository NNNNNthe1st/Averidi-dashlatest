import {test} from 'node:test';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,utimes,writeFile,readFile,readdir,stat,unlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {dashboardDb as db} from '../src/server/db';
import {dashboardStorageKey,dashboardStoragePath,dashboardWorkspaceArtifactKey,writeDashboardObject,readDashboardObject} from '../src/server/storage';
import {writeWorkspaceObject} from '../src/server/workspace-storage';
import {saveStoragePolicy,archiveDatasetForRetention} from '../src/features/storage/lifecycle';
import {dashboardStorageBackend} from '../src/features/storage/inventory';
import {createStorageBackup,restoreStorageBackup} from '../src/features/storage/backup';
import {enqueueDashboardJob,enqueueActorDashboardJob} from '../src/worker/queue';
import {claimDashboardJob,finishDashboardJob} from '../src/worker/job-claim';
import {processDataCleanup} from '../src/worker/handlers/cleanup';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const policy={inactiveVersionDays:1,archivedDatasetDays:1,orphanGraceHours:24,quarantineHours:24,legalHold:false};
const old=new Date(Date.now()-7*86400000);
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-storage-life-')),previous={...process.env};Object.assign(process.env,{DASHBOARD_STORAGE_ROOT:path.join(root,'source'),DASHBOARD_STORAGE_BACKEND:'local'});
 const user=await db.dashboardUser.create({data:{externalSubject:'storage-lifecycle|'+randomUUID()}}),editor=await db.dashboardUser.create({data:{externalSubject:'storage-editor|'+randomUUID()}}),workspace=await db.dashboardWorkspace.create({data:{name:'Storage lifecycle fixture'}});
 await db.dashboardMembership.createMany({data:[{userId:user.id,workspaceId:workspace.id,role:'OWNER'},{userId:editor.id,workspaceId:workspace.id,role:'EDITOR'}]});
 const actor={userId:user.id,issuer:'fixture',subject:'owner'},editorActor={userId:editor.id,issuer:'fixture',subject:'editor'};
 const dataset=await db.dashboardDataset.create({data:{workspaceId:workspace.id,name:'Retained dataset',status:'READY'}});
 async function version(number:number){const id=randomUUID(),key=dashboardStorageKey(workspace.id,dataset.id,id),bytes=Buffer.from('id,amount\n001,'+number+'\n');await writeDashboardObject(key,bytes);await utimes(dashboardStoragePath(key),old,old);return db.dashboardDatasetVersion.create({data:{id,datasetId:dataset.id,version:number,status:'READY',sourceFormat:'CSV',storageKey:key,fileSize:BigInt(bytes.length),checksum:digest(bytes),createdAt:old}});}
 const active=await version(1);await db.dashboardDataset.update({where:{id:dataset.id},data:{activeVersionId:active.id}});
 async function artifact(area:'processed'|'snapshots'|'reports'|'exports'|'temporary',aged=true){const key=dashboardWorkspaceArtifactKey(area,workspace.id,randomUUID());await writeDashboardObject(key,Buffer.from('private-fixture:'+key));if(aged)await utimes(dashboardStoragePath(key),old,old);return key;}
 async function run(lifecycle:'PLAN'|'APPLY'){
  const queued=await enqueueDashboardJob(workspace.id,'DATA_CLEANUP',{lifecycle,expiredReports:false},randomUUID());const job=await claimDashboardJob();assert.equal(job?.id,queued.id);const result=await processDataCleanup(job!);await finishDashboardJob(job!.id,job!.leaseToken!,true,undefined,result);return result;
 }
 async function release(){await db.dashboardWorkspace.delete({where:{id:workspace.id}});await db.dashboardUser.deleteMany({where:{id:{in:[user.id,editor.id]}}});for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await rm(root,{recursive:true,force:true});}
 return {root,workspace,actor,editorActor,dataset,active,version,artifact,run,release};
}

test('owner retention, quarantine, last-good protection, orphan/reference races, legal hold and archive purge',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>saveStoragePolicy(f.editorActor,f.workspace.id,policy),/FORBIDDEN/);
  await assert.rejects(()=>saveStoragePolicy(f.actor,f.workspace.id,{...policy,orphanGraceHours:0}),/INVALID_STORAGE_POLICY/);
  await saveStoragePolicy(f.actor,f.workspace.id,policy);
  await assert.rejects(()=>enqueueActorDashboardJob(f.editorActor,f.workspace.id,'DATA_CLEANUP',{lifecycle:'PLAN'},randomUUID()),/FORBIDDEN/);
  const inactive=await f.version(2),protectedVersion=await f.version(3),protectedKey=await f.artifact('snapshots');
  const protectedBytes=await readDashboardObject(protectedKey);
  await db.dashboardDatasetSnapshot.create({data:{workspaceId:f.workspace.id,datasetId:f.dataset.id,versionId:protectedVersion.id,storageKey:protectedKey,checksum:digest(protectedBytes),fileSize:BigInt(protectedBytes.length),rowCount:1}});
  const newlyReferenced=await f.artifact('processed'),orphan=await f.artifact('processed'),conflict=await f.artifact('exports'),recent=await f.artifact('temporary',false);
  const partial=dashboardStoragePath(dashboardStorageKey(f.workspace.id,f.dataset.id,randomUUID()))+'.tmp-'+randomUUID();await mkdir(path.dirname(partial),{recursive:true,mode:0o700});await writeFile(partial,'abandoned',{mode:0o600});await utimes(partial,old,old);
  const foreign=dashboardWorkspaceArtifactKey('processed','foreign_workspace',randomUUID());await writeDashboardObject(foreign,Buffer.from('foreign'));await utimes(dashboardStoragePath(foreign),old,old);
  const planned=await f.run('PLAN');assert.equal(planned.planned,5);
  assert.equal((await f.run('APPLY')).deleted,0,'quarantine cannot be skipped');
  const referenceBytes=await readDashboardObject(newlyReferenced);await db.dashboardDatasetSnapshot.create({data:{workspaceId:f.workspace.id,datasetId:f.dataset.id,versionId:f.active.id,storageKey:newlyReferenced,checksum:digest(referenceBytes),fileSize:BigInt(referenceBytes.length),rowCount:1}});
  await writeFile(dashboardStoragePath(conflict),'changed after observation');
  await db.dashboardStorageDeletion.updateMany({where:{workspaceId:f.workspace.id,status:'PLANNED'},data:{eligibleAfter:new Date(Date.now()-1000)}});
  await saveStoragePolicy(f.actor,f.workspace.id,{...policy,legalHold:true});await assert.rejects(()=>f.run('APPLY'),/STORAGE_LEGAL_HOLD/);
  // A rejected attempt is terminally acknowledged so it cannot block unrelated cleanup.
  await db.dashboardJob.updateMany({where:{workspaceId:f.workspace.id,status:'RUNNING'},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,finishedAt:new Date()}});
  await saveStoragePolicy(f.actor,f.workspace.id,policy);
  const result=await f.run('APPLY');assert.equal(result.deleted,3);assert.equal(result.cancelled,1);
  await assert.rejects(()=>readDashboardObject(inactive.storageKey));await assert.rejects(()=>readDashboardObject(orphan));await assert.rejects(()=>readFile(partial));
  for(const key of [f.active.storageKey,protectedVersion.storageKey,protectedKey,newlyReferenced,recent,foreign,conflict])assert.ok((await readDashboardObject(key)).length);
  assert.equal((await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:inactive.id}})).status,'PURGED');
  assert.equal((await db.dashboardStorageDeletion.findUniqueOrThrow({where:{workspaceId_storageKey:{workspaceId:f.workspace.id,storageKey:conflict}}})).status,'CONFLICT');
  await assert.rejects(()=>writeWorkspaceObject(f.actor,f.workspace.id,inactive.storageKey,Buffer.from('resurrection')),/STORAGE_OBJECT_RETIRED/);
  await assert.rejects(()=>db.dashboardDataset.update({where:{id:f.dataset.id},data:{activeVersionId:inactive.id}}),/STORAGE_OBJECT_RETIRED/);
  await assert.rejects(()=>db.dashboardDatasetVersion.create({data:{datasetId:f.dataset.id,version:99,status:'READY',storageKey:inactive.storageKey,fileSize:BigInt(1),checksum:'x'}}),/STORAGE_OBJECT_RETIRED/);
  await archiveDatasetForRetention(f.actor,f.workspace.id,f.dataset.id);assert.equal((await db.dashboardDataset.findUniqueOrThrow({where:{id:f.dataset.id}})).activeVersionId,null);
  assert.equal((await f.run('PLAN')).planned,0,'archive retention starts at archive time');
  await db.dashboardDataset.update({where:{id:f.dataset.id},data:{updatedAt:old}});
  assert.equal((await f.run('PLAN')).planned,4);
  await db.dashboardStorageDeletion.updateMany({where:{workspaceId:f.workspace.id,status:'PLANNED'},data:{eligibleAfter:new Date(Date.now()-1000)}});
  assert.equal((await f.run('APPLY')).deleted,4);
  assert.equal(await db.dashboardDatasetSnapshot.count({where:{workspaceId:f.workspace.id,purgedAt:null}}),0);
  assert.equal((await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.active.id}})).status,'PURGED');
 }finally{await f.release();}
});

test('encrypted storage backup restores every namespace, validates references, rejects corruption and resumes safely',async()=>{
 const f=await fixture();try{
  const snapshot=await f.artifact('snapshots');const bytes=await readDashboardObject(snapshot);
  await db.dashboardDatasetSnapshot.create({data:{workspaceId:f.workspace.id,datasetId:f.dataset.id,versionId:f.active.id,storageKey:snapshot,checksum:digest(bytes),fileSize:BigInt(bytes.length),rowCount:1}});
  for(const area of ['processed','reports','exports','temporary'] as const)await f.artifact(area);
  const backend=dashboardStorageBackend(),objects=await backend.list(f.workspace.id),secret=randomBytes(32).toString('hex'),folder=path.join(f.root,'backup');let checkedFence=false;
  const wrapped={...backend,read:async(key:string)=>{if(!checkedFence){checkedFence=true;await assert.rejects(()=>writeWorkspaceObject(f.actor,f.workspace.id,dashboardWorkspaceArtifactKey('temporary',f.workspace.id,randomUUID()),Buffer.from('must not publish')),/STORAGE_MAINTENANCE/);await assert.rejects(()=>db.dashboardDatasetVersion.update({where:{id:f.active.id},data:{profile:{unsafe:true}}}),/STORAGE_MAINTENANCE/);}return backend.read(key);}};
  assert.deepEqual(await createStorageBackup(folder,secret,f.workspace.id,wrapped),{objects:6,references:2,bytes:String(objects.reduce((n,o)=>n+o.size,BigInt(0)))});
  const manifest=await readFile(path.join(folder,'manifest.enc'));assert.ok(!manifest.includes(Buffer.from(f.workspace.id)));assert.ok(!manifest.includes(Buffer.from('private-fixture')));assert.equal((await stat(folder)).mode&0o077,0);
  const source=process.env.DASHBOARD_STORAGE_ROOT!;process.env.DASHBOARD_STORAGE_ROOT=path.join(f.root,'restore');
  await assert.rejects(()=>restoreStorageBackup(folder,randomBytes(32).toString('hex')),/STORAGE_BACKUP_CORRUPT/);
  const names=await readdir(folder),objectName=names.find(n=>n!=='manifest.enc')!,original=await readFile(path.join(folder,objectName)),damaged=Buffer.from(original);damaged[damaged.length-1]^=1;await writeFile(path.join(folder,objectName),damaged);
  await assert.rejects(()=>restoreStorageBackup(folder,secret),/STORAGE_BACKUP_CORRUPT/);assert.equal((await dashboardStorageBackend().list(f.workspace.id)).length,0);
  await writeFile(path.join(folder,objectName),original);
  assert.deepEqual(await restoreStorageBackup(folder,secret),{restored:6,references:2});
  for(const object of objects){const restored=await readDashboardObject(object.key);process.env.DASHBOARD_STORAGE_ROOT=source;const before=await readDashboardObject(object.key);process.env.DASHBOARD_STORAGE_ROOT=path.join(f.root,'restore');assert.deepEqual(restored,before);}
  await unlink(dashboardStoragePath(f.active.storageKey));assert.equal((await restoreStorageBackup(folder,secret)).restored,6);
  await writeFile(dashboardStoragePath(snapshot),'different existing destination');await assert.rejects(()=>restoreStorageBackup(folder,secret),/STORAGE_RESTORE_CONFLICT/);assert.equal((await readDashboardObject(snapshot)).toString(),'different existing destination');
  await db.dashboardDatasetVersion.update({where:{id:f.active.id},data:{checksum:'f'.repeat(64)}});await assert.rejects(()=>restoreStorageBackup(folder,secret),/STORAGE_REFERENCE_CHANGED/);
  assert.equal(await db.dashboardStorageMaintenance.count(),0);
 }finally{await f.release();}
});

test('HTTPS S3 backup/restore, authenticated pagination and interrupted conditional deletion recover without data loss',async()=>{
 const {startStorageProvider}=await import('./fixtures/storage-provider');
 async function command(args:string[],extra:Record<string,string>={}){const child=spawn(process.execPath,['--import','tsx',...args],{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',d=>{output+=d});child.stderr.on('data',d=>{errors+=d});assert.equal(await new Promise(resolve=>child.once('exit',resolve)),0,errors);return JSON.parse(output.trim());}
 const f=await fixture();const source=await startStorageProvider(),target=await startStorageProvider();try{
  const snapshot=await f.artifact('snapshots'),snapshotBytes=await readDashboardObject(snapshot);
  await db.dashboardDatasetSnapshot.create({data:{workspaceId:f.workspace.id,datasetId:f.dataset.id,versionId:f.active.id,storageKey:snapshot,checksum:digest(snapshotBytes),fileSize:BigInt(snapshotBytes.length),rowCount:1}});
  for(const area of ['processed','reports','exports','temporary'] as const)await f.artifact(area);
  await f.artifact('processed');await f.artifact('processed');
  const local=await dashboardStorageBackend().list(f.workspace.id),expected=new Map<string,Buffer>();for(const object of local)expected.set(object.key,await readDashboardObject(object.key));
  Object.assign(process.env,source.settings);for(const [key,bytes] of expected)await writeDashboardObject(key,bytes);
  await command(['scripts/check-storage-provider.mjs'],{DASHBOARD_STORAGE_WRITE_CHECK:'true'});
  const secret=randomBytes(32).toString('hex'),folder=path.join(f.root,'s3-backup');assert.equal((await command(['scripts/storage-backup.mjs','backup',folder,f.workspace.id],{DASHBOARD_STORAGE_BACKUP_KEY:secret,DASHBOARD_WORKER_ENABLED:'false'})).objects,8);assert.ok(source.signedRequests>=20);
  Object.assign(process.env,target.settings);const foreign=dashboardWorkspaceArtifactKey('processed','another_workspace',randomUUID());await writeDashboardObject(foreign,Buffer.from('another tenant'));
  assert.equal((await command(['scripts/storage-backup.mjs','restore',folder],{DASHBOARD_STORAGE_BACKUP_KEY:secret,DASHBOARD_WORKER_ENABLED:'false'})).restored,8);for(const [key,bytes] of expected)assert.deepEqual(await readDashboardObject(key),bytes);assert.equal((await readDashboardObject(foreign)).toString(),'another tenant');
  Object.assign(process.env,source.settings);await saveStoragePolicy(f.actor,f.workspace.id,policy);
  const orphan=dashboardWorkspaceArtifactKey('processed',f.workspace.id,randomUUID());await writeDashboardObject(orphan,Buffer.from('expired orphan'));source.objects.get(orphan)!.modifiedAt=old;
  assert.equal((await f.run('PLAN')).planned,1);await db.dashboardStorageDeletion.updateMany({where:{workspaceId:f.workspace.id,status:'PLANNED'},data:{eligibleAfter:new Date(Date.now()-1000)}});
  const deletesBefore=source.successfulDeletes;source.failDeleteOnce();await assert.rejects(()=>f.run('APPLY'),/STORAGE_UNAVAILABLE/);assert.ok(source.objects.has(orphan));
  const pending=await db.dashboardStorageDeletion.findUniqueOrThrow({where:{workspaceId_storageKey:{workspaceId:f.workspace.id,storageKey:orphan}}});assert.equal(pending.status,'DELETING');
  await assert.rejects(()=>writeWorkspaceObject(f.actor,f.workspace.id,orphan,Buffer.from('replacement')),/STORAGE_OBJECT_RETIRED/);
  await assert.rejects(()=>createStorageBackup(path.join(f.root,'busy-backup'),secret,f.workspace.id),/STORAGE_BUSY/);
  await db.dashboardJob.updateMany({where:{workspaceId:f.workspace.id,status:'RUNNING'},data:{status:'FAILED',leaseToken:null,leaseExpiresAt:null,finishedAt:new Date()}});
  assert.equal((await f.run('APPLY')).deleted,1);assert.equal(source.successfulDeletes,deletesBefore+1);assert.ok(!source.objects.has(orphan));assert.deepEqual(await readDashboardObject(f.active.storageKey),expected.get(f.active.storageKey));
 }finally{await source.close();await target.close();await f.release();}
});
