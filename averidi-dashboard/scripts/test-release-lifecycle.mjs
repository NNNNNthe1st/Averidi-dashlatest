import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {verificationDatabases} from './verification/contracts.mjs';
import {initializeHost,installRelease,sealRelease} from './releases/artifact.mjs';
import {hostRequest} from './releases/host.mjs';
import {buildRelease} from './releases/build.mjs';
const {owner}=verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
const db=new PrismaClient({datasources:{db:{url:process.env.DASHBOARD_DATABASE_URL}}}),admin=new PrismaClient({datasources:{db:{url:owner.toString()}}});
const root=await mkdtemp(path.join(tmpdir(),'dashboard-release-lifecycle-')),tag=randomUUID().replaceAll('-',''),migrationName='20261025000000_release_fixture_'+tag;
let supervisor,workspace,logs='';
const artifacts=[];
async function variant(source,version,change){const target=path.join(root,version);await cp(source,target,{recursive:true,dereference:false,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});await rm(path.join(target,'release.json'));await rm(path.join(target,'.next/cache'),{recursive:true,force:true});await change(target);const metadata=JSON.parse(await readFile(path.join(source,'release.json'),'utf8'));const release=await sealRelease(target,{version,revision:metadata.revision});artifacts.push({target,...release});return {target,...release};}
async function waitHost(host){const deadline=Date.now()+180000;while(Date.now()<deadline){try{return await hostRequest(host,{action:'status'});}catch{}if(supervisor?.exitCode!==null&&supervisor?.exitCode!==undefined)throw Error(logs);await delay(100);}throw Error('Release supervisor did not start: '+logs);}
async function stopHost(){if(supervisor?.exitCode===null){supervisor.kill('SIGTERM');await Promise.race([new Promise(r=>supervisor.once('exit',r)),delay(20000)]);assert.notEqual(supervisor.exitCode,null,'Supervisor did not stop gracefully');}}
try{
 const aPath=path.join(root,'release-a');const built=await buildRelease(aPath,'acceptance-a');const a={target:aPath,...built};artifacts.push(a);
 const b=await variant(a.target,'acceptance-b',async()=>{}),bad=await variant(a.target,'acceptance-unhealthy',async folder=>writeFile(path.join(folder,'next.config.ts'),"throw Error('intentional release fixture failure');export default {};\n"));
 const schema=await variant(a.target,'acceptance-schema',async folder=>{const dir=path.join(folder,'prisma/migrations',migrationName);await mkdir(dir);await writeFile(path.join(dir,'migration.sql'),'-- Disposable release-fence fixture: intentionally no schema/data mutation.\nSELECT 1;\n');});
 const badSchema=await variant(schema.target,'acceptance-schema-unhealthy',async folder=>writeFile(path.join(folder,'next.config.ts'),"throw Error('intentional post-migration fixture failure');export default {};\n"));
 const host=await initializeHost(path.join(root,'host')),storage=path.join(root,'storage');await mkdir(storage,{mode:0o700});await writeFile(path.join(storage,'retained.txt'),'retained customer fixture');
 for(const artifact of artifacts)await installRelease(host,artifact.target,artifact.digest);
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 await writeFile(path.join(host,'runtime.json'),JSON.stringify({port,readyTimeoutSeconds:15,stopTimeoutSeconds:5,env:{DASHBOARD_DATABASE_URL:process.env.DASHBOARD_DATABASE_URL,DASHBOARD_STORAGE_ROOT:storage,DASHBOARD_RELEASE_MODE:'OFF',DASHBOARD_BILLING_ENABLED:'false',DASHBOARD_DATA_CONNECTORS_ENABLED:'false'}}),{mode:0o600});
 await writeFile(path.join(host,'migration.json'),JSON.stringify({DASHBOARD_MIGRATION_DATABASE_URL:process.env.DASHBOARD_MIGRATION_DATABASE_URL}),{mode:0o600});
 workspace=await db.dashboardWorkspace.create({data:{name:'Retained release fixture '+tag}});
 supervisor=spawn(process.execPath,['scripts/dashboard-release.mjs','serve',host],{stdio:['ignore','pipe','pipe']});supervisor.stdout.on('data',d=>{logs+=d});supervisor.stderr.on('data',d=>{logs+=d});
 await waitHost(host);
 const activate=async(artifact,migrate=false)=>{const current=await hostRequest(host,{action:'status'});return hostRequest(host,{action:'activate',release:artifact.digest,expectedCurrent:current.current,migrate});};
 await assert.rejects(activate(a),/MIGRATION_REQUIRED/);const first=await activate(a,true);assert.equal(first.running,true);assert.equal(first.current,a.digest);
 assert.equal((await fetch('http://127.0.0.1:'+port+'/dashboard/app/api/health/ready')).status,200);assert.equal((await fetch('http://127.0.0.1:'+port+'/dashboard/app/workspaces',{redirect:'manual'})).status,503);
 console.log('PASS: verified artifact installation and initial real web/worker activation.');
 const second=await activate(b);assert.equal(second.previous,a.digest);const rollback=await hostRequest(host,{action:'rollback',expectedCurrent:b.digest});assert.equal(rollback.current,a.digest);assert.equal(rollback.running,true);
 await assert.rejects(hostRequest(host,{action:'activate',release:b.digest,expectedCurrent:b.digest,migrate:false}),/STALE_STATE/);
 await assert.rejects(activate(bad),/RELEASE_/);const recovered=await hostRequest(host,{action:'status'});assert.equal(recovered.current,a.digest);assert.equal(recovered.running,true);assert.equal(recovered.maintenance,false);
 console.log('PASS: real application promotion, rollback and unhealthy-candidate restoration.');
 await assert.rejects(activate(schema),/MIGRATION_REQUIRED/);assert.equal((await hostRequest(host,{action:'status'})).running,true);
 await assert.rejects(activate(badSchema,true),/RELEASE_/);const fenced=await hostRequest(host,{action:'status'});assert.equal(fenced.maintenance,true);assert.equal(fenced.running,false);await assert.rejects(hostRequest(host,{action:'rollback',expectedCurrent:a.digest}),/NO_ROLLBACK|SCHEMA_ROLLBACK_REJECTED/);
 await stopHost();supervisor=spawn(process.execPath,['scripts/dashboard-release.mjs','serve',host],{stdio:['ignore','pipe','pipe']});supervisor.stdout.on('data',d=>{logs+=d});supervisor.stderr.on('data',d=>{logs+=d});const rebootedFence=await waitHost(host);assert.equal(rebootedFence.maintenance,true);assert.equal(rebootedFence.running,false);assert.equal(rebootedFence.degraded,false);
 console.log('PASS: persisted migration-maintenance fence survives supervisor restart without booting the old application.');
 const fixed=await activate(schema,true);assert.equal(fixed.running,true);assert.equal(fixed.previous,null);assert.equal(fixed.maintenance,false);await assert.rejects(hostRequest(host,{action:'rollback',expectedCurrent:schema.digest}),/NO_ROLLBACK/);
 assert.equal((await db.dashboardWorkspace.findUniqueOrThrow({where:{id:workspace.id}})).name,'Retained release fixture '+tag);assert.equal(await readFile(path.join(storage,'retained.txt'),'utf8'),'retained customer fixture');
 await stopHost();supervisor=spawn(process.execPath,['scripts/dashboard-release.mjs','serve',host],{stdio:['ignore','pipe','pipe']});supervisor.stdout.on('data',d=>{logs+=d});supervisor.stderr.on('data',d=>{logs+=d});assert.equal((await waitHost(host)).running,true);
 const events=(await readFile(path.join(host,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(events.some(e=>e.event==='restored'));assert.ok(!JSON.stringify(events).includes(owner.password));
 console.log('PASS: committed clean build; verified relocation; real Next/worker activation; release OFF preserved; promotion and rollback; unhealthy candidate recovery; stale request rejection; forward-only migration fence and repair; supervisor restart; retained database/storage.');
}finally{
 await stopHost();
 // The only additional test migration executes SELECT 1; remove that fixture ledger receipt after all fixture processes stop.
 await admin.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name=${migrationName}`;
 if(workspace)await db.dashboardWorkspace.delete({where:{id:workspace.id}});await db.$disconnect();await admin.$disconnect();await rm(root,{recursive:true,force:true});
}
