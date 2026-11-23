import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,chmod,lstat} from 'node:fs/promises';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sealRelease,verifyRelease,initializeHost,installRelease,inventory} from '../scripts/releases/artifact.mjs';
import {runtimeSettings,releaseHost,hostRequest} from '../scripts/releases/host.mjs';
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-release-unit-')),artifact=path.join(root,'artifact');await mkdir(artifact,{mode:0o700});
 const files={'package.json':JSON.stringify({name:'averidi-dashboard'}),'package-lock.json':'{}','next.config.ts':'export default {};','.next/BUILD_ID':'fixture','node_modules/next/dist/bin/next':'fixture','scripts/releases/worker.mjs':'fixture','scripts/check-database.mjs':'fixture','scripts/check-storage.mjs':'fixture','prisma/schema.prisma':'fixture','prisma/migrations/20260101000000_fixture/migration.sql':'SELECT 1;'};
 for(const [p,value] of Object.entries(files)){await mkdir(path.dirname(path.join(artifact,p)),{recursive:true});await writeFile(path.join(artifact,p),value);}
 return {root,artifact,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('release inventory detects content/mode/addition/removal drift and validates the reviewed digest',async()=>{
 const f=await fixture();try{
  const result=await sealRelease(f.artifact,{version:'v1',revision:'a'.repeat(40)});assert.equal((await verifyRelease(f.artifact,result.digest)).migrationDigest,result.migrationDigest);
  await assert.rejects(verifyRelease(f.artifact,'b'.repeat(64)),/DIGEST_MISMATCH/);
  await writeFile(path.join(f.artifact,'package-lock.json'),'changed');await assert.rejects(verifyRelease(f.artifact,result.digest),/INTEGRITY/);await writeFile(path.join(f.artifact,'package-lock.json'),'{}');
  await writeFile(path.join(f.artifact,'unexpected.txt'),'changed');await assert.rejects(verifyRelease(f.artifact,result.digest),/INTEGRITY/);await rm(path.join(f.artifact,'unexpected.txt'));
  const originalMode=(await lstat(path.join(f.artifact,'package-lock.json'))).mode&0o777;await chmod(path.join(f.artifact,'package-lock.json'),0o700);await assert.rejects(verifyRelease(f.artifact,result.digest),/INTEGRITY/);await chmod(path.join(f.artifact,'package-lock.json'),originalMode);
  await mkdir(path.join(f.artifact,'.next/cache'),{recursive:true});await writeFile(path.join(f.artifact,'.next/cache/runtime'),'cache');assert.equal((await verifyRelease(f.artifact,result.digest)).digest,result.digest);
  await rm(path.join(f.artifact,'.next/BUILD_ID'));await assert.rejects(verifyRelease(f.artifact,result.digest),/INTEGRITY/);
 }finally{await f.cleanup();}
});
test('artifacts refuse secret files, external links, manifest links and cache links',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.artifact,'.env.production'),'secret');await assert.rejects(inventory(f.artifact),/SECRET_OR_GIT/);await rm(path.join(f.artifact,'.env.production'));
  await symlink('../outside',path.join(f.artifact,'escape'));await assert.rejects(inventory(f.artifact),/LINK_ESCAPE/);await rm(path.join(f.artifact,'escape'));
  await symlink('/tmp',path.join(f.artifact,'.next/cache'));await assert.rejects(inventory(f.artifact),/CACHE_REJECTED/);await rm(path.join(f.artifact,'.next/cache'));
  await symlink('package-lock.json',path.join(f.artifact,'release.json'));await assert.rejects(verifyRelease(f.artifact),/MANIFEST_REJECTED/);
 }finally{await f.cleanup();}
});
test('installation is private, content addressed, idempotent and cannot select an unrelated host directory',async()=>{
 const f=await fixture();try{
  const host=path.join(f.root,'host');await initializeHost(host);const release=await sealRelease(f.artifact,{version:'v1',revision:'a'.repeat(40)});
  await installRelease(host,f.artifact,release.digest);await installRelease(host,f.artifact,release.digest);assert.equal((await verifyRelease(path.join(host,'releases',release.digest),release.digest)).digest,release.digest);
  const foreign=path.join(f.root,'foreign');await mkdir(foreign,{mode:0o700});await writeFile(path.join(foreign,'existing-app'),'existing');await assert.rejects(initializeHost(foreign),/FOREIGN_RELEASE_HOST/);assert.equal(await readFile(path.join(foreign,'existing-app'),'utf8'),'existing');
  await chmod(host,0o755);await assert.rejects(installRelease(host,f.artifact,release.digest),/PRIVATE_DIRECTORY/);
 }finally{await f.cleanup();}
});
test('runtime credentials remain outside builds; unsafe environment keys, other-product targets and owner leakage are rejected',async()=>{
 const f=await fixture();try{
  const host=path.join(f.root,'host');await initializeHost(host);const file=path.join(host,'runtime.json'),settings={port:39001,env:{DASHBOARD_DATABASE_URL:'postgresql://dashboard_runtime:test@127.0.0.1:5432/dashboard_test',DASHBOARD_STORAGE_ROOT:path.join(f.root,'storage')}};
  await writeFile(file,JSON.stringify(settings),{mode:0o600});const config=await runtimeSettings(host);assert.equal(config.env.DASHBOARD_RELEASE_MODE,'OFF');assert.equal(config.env.DASHBOARD_MIGRATION_DATABASE_URL,'');assert.equal(config.env.DASHBOARD_WORKER_ENABLED,'true');assert.equal(Reflect.get(config.env,'DATABASE_URL'),undefined);assert.equal(Reflect.get(config.env,'NODE_OPTIONS'),undefined);
  for(const extra of [{NODE_OPTIONS:'--require evil'},{DASHBOARD_MIGRATION_DATABASE_URL:'postgresql://owner:secret@db/dashboard'},{DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'true'},{DASHBOARD_DATABASE_URL:'postgresql://website:secret@db/sales_solutions'},{DASHBOARD_STORAGE_ROOT:path.join(host,'releases','uploads')}]){await writeFile(file,JSON.stringify({...settings,env:{...settings.env,...extra}}));await assert.rejects(runtimeSettings(host),/RELEASE_/);}
  await writeFile(file,JSON.stringify(settings));await chmod(file,0o644);await assert.rejects(runtimeSettings(host),/PRIVATE_CONFIG/);
  await assert.rejects(releaseHost(host,new AbortController().signal),/HOST_LOCK_REQUIRED/);
 }finally{await f.cleanup();}
});

test('native supervisor owns an exclusive kernel lock and authenticates its loopback control endpoint',async()=>{
 const f=await fixture();let child:ReturnType<typeof spawn>|undefined;try{
  const host=path.join(f.root,'host');await initializeHost(host);await writeFile(path.join(host,'runtime.json'),JSON.stringify({port:39002,env:{DASHBOARD_DATABASE_URL:'postgresql://dashboard_runtime:test@127.0.0.1:5432/dashboard_test',DASHBOARD_STORAGE_ROOT:path.join(f.root,'storage')}}),{mode:0o600});
  child=spawn(process.execPath,['scripts/dashboard-release.mjs','serve',host],{stdio:['ignore','pipe','pipe']});let output='';child.stdout?.on('data',d=>{output+=d});child.stderr?.on('data',d=>{output+=d});
  let ready=false;for(let i=0;i<50;i++){try{const result=await hostRequest(host,{action:'status'});assert.equal(result.current,null);assert.equal(result.running,false);ready=true;break;}catch{}if(child.exitCode!==null)throw Error(output);await delay(100);}assert.equal(ready,true,output);
  const control=JSON.parse(await readFile(path.join(host,'control.json'),'utf8'));
  const forbidden=await new Promise<string>((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:control.port});let body='';socket.once('error',reject);socket.once('connect',()=>socket.write(JSON.stringify({token:'0'.repeat(64),body:{action:'status'}})+'\n'));socket.on('data',data=>{body+=data});socket.once('end',()=>resolve(body));});assert.equal(JSON.parse(forbidden).ok,false);assert.equal(JSON.parse(forbidden).result,undefined);
  const duplicate=spawn(process.execPath,['scripts/dashboard-release.mjs','serve',host],{stdio:'ignore'});assert.notEqual(await new Promise(r=>duplicate.once('exit',r)),0);
  assert.equal((await hostRequest(host,{action:'status'})).maintenance,false);
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child!.once('exit',r));}await f.cleanup();}
});
