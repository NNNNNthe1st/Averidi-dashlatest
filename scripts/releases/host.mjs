import {readFile,lstat,chmod,unlink,appendFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {hostRoot,verifyRelease,atomicJson,digestPattern,within} from './artifact.mjs';
const settings=z.object({port:z.number().int().min(1024).max(65535),readyTimeoutSeconds:z.number().int().min(5).max(180).default(60),stopTimeoutSeconds:z.number().int().min(1).max(600).default(45),env:z.record(z.string(),z.string())}).strict();
const stateSchema=z.object({format:z.literal(1),current:z.string().regex(digestPattern).nullable(),previous:z.string().regex(digestPattern).nullable(),migrationDigest:z.string().regex(digestPattern).nullable(),maintenance:z.boolean()}).strict();
const requestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('status')}).strict(),
 z.object({action:z.literal('activate'),release:z.string().regex(digestPattern),expectedCurrent:z.string().regex(digestPattern).nullable(),migrate:z.boolean().default(false)}).strict(),
 z.object({action:z.literal('rollback'),expectedCurrent:z.string().regex(digestPattern)}).strict(),
]);
const safe=error=>error instanceof Error&&/^RELEASE_[A-Z_]+$/.test(error.message)?error.message:'RELEASE_OPERATION_FAILED';
async function privateJson(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)||s.size>32768)throw Error('RELEASE_PRIVATE_CONFIG_REQUIRED');return JSON.parse(await readFile(file,'utf8'));}
export async function runtimeSettings(root){
 const config=settings.parse(await privateJson(path.join(root,'runtime.json')));
 for(const key of Object.keys(config.env))if(!/^DASHBOARD_[A-Z0-9_]+$/.test(key)||/DASHBOARD_(?:MIGRATION|DEV_|TEST_|BROWSER|PG_BIN)/.test(key))throw Error('RELEASE_RUNTIME_KEY_REJECTED');
 if(config.env.DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED==='true'||config.env.DASHBOARD_ADMIN_BRIDGE_ENABLED==='true')throw Error('RELEASE_EXTERNAL_INTEGRATION_REJECTED');
 const database=new URL(config.env.DASHBOARD_DATABASE_URL??'');
 if(!['postgres:','postgresql:'].includes(database.protocol)||!database.hostname||!database.username||!database.password||/^(averidi|averidi_dev|sales_solutions|analyst|postgres|template0|template1)$/i.test(decodeURIComponent(database.pathname.slice(1))))throw Error('RELEASE_DATABASE_REJECTED');
 if((config.env.DASHBOARD_STORAGE_BACKEND??'local')==='local'){
  const storage=config.env.DASHBOARD_STORAGE_ROOT;if(!storage||!path.isAbsolute(storage)||within(path.resolve(storage),root)||path.resolve(storage)===path.parse(storage).root)throw Error('RELEASE_STORAGE_REJECTED');
 }
 const env={PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',CHECKPOINT_DISABLE:'1',...config.env,DASHBOARD_MIGRATION_DATABASE_URL:'',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_ADMIN_BRIDGE_ENABLED:'false',DASHBOARD_WORKER_ENABLED:'true',DASHBOARD_RELEASE_MODE:config.env.DASHBOARD_RELEASE_MODE??'OFF'};
 return {...config,env};
}
async function state(root){try{return stateSchema.parse(await privateJson(path.join(root,'state.json')));}catch(e){if(e.code!=='ENOENT')throw e;return {format:1,current:null,previous:null,migrationDigest:null,maintenance:false};}}
function start(command,args,cwd,env,ipc=false){
 const child=spawn(command,args,{cwd,env,stdio:['ignore','ignore','ignore',...(ipc?['ipc']:[])]});child.on('error',()=>{});return child;
}
const alive=child=>!!child&&child.exitCode===null&&child.signalCode===null&&child.pid!==undefined;
async function stop(child,seconds){if(!alive(child))return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(seconds*1000)]);if(alive(child)){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));}}
async function run(args,cwd,env){const child=start(process.execPath,args,cwd,env);await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('RELEASE_PREFLIGHT_FAILED')));});}
async function freePort(port){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',()=>reject(Error('RELEASE_PORT_IN_USE')));server.listen(port,'127.0.0.1',resolve);});await new Promise(r=>server.close(r));}
export async function releaseHost(folder,signal){
 const root=await hostRoot(folder);
 // The internal entry point must actually own the kernel flock, not merely claim an environment flag.
 let locked=false;for(const fd of await readdir('/proc/self/fd')){try{const detail=await readFile('/proc/self/fdinfo/'+fd,'utf8');const stat=await import('node:fs/promises').then(fs=>fs.stat('/proc/self/fd/'+fd));const lock=await lstat(path.join(root,'host.lock'));if(stat.ino===lock.ino&&stat.dev===lock.dev&&/FLOCK\s+ADVISORY\s+WRITE\s+/.test(detail))locked=true;}catch{}}
 if(!locked)throw Error('RELEASE_HOST_LOCK_REQUIRED');await chmod(path.join(root,'host.lock'),0o600);
 const config=await runtimeSettings(root);let current=await state(root),web=null,worker=null,transitioning=false,closing=false,failed=false,queue=Promise.resolve();
 const configHash=createHash('sha256').update(await readFile(path.join(root,'runtime.json'))).digest('hex');
 const save=async value=>{await atomicJson(path.join(root,'state.json'),value);current=value;};
 const audit=async(event,details={})=>appendFile(path.join(root,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,...details})+'\n',{mode:0o600});
 async function halt(){await stop(worker,config.stopTimeoutSeconds);await stop(web,config.stopTimeoutSeconds);worker=null;web=null;}
 async function launch(id){
  const release=path.join(root,'releases',id);await verifyRelease(release,id);
  await run(['--import','tsx','scripts/releases/preflight.mjs'],release,config.env);
  await run(['--import','tsx','scripts/check-database.mjs'],release,config.env);
  await run(['--import','tsx','scripts/check-storage.mjs'],release,{...config.env,DASHBOARD_STORAGE_WRITE_CHECK:'true'});
  if(signal.aborted)throw Error('RELEASE_STOPPING');await freePort(config.port);
  worker=start(process.execPath,['--import','tsx','scripts/releases/worker.mjs'],release,config.env,true);
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('RELEASE_WORKER_NOT_READY')),config.readyTimeoutSeconds*1000);
   const done=fn=>value=>{clearTimeout(timer);fn(value);};worker.once('error',done(reject));worker.once('exit',done(()=>reject(Error('RELEASE_WORKER_NOT_READY'))));worker.once('message',done(value=>value?.product==='averidi-dashboard'&&value?.ready===true?resolve():reject(Error('RELEASE_WORKER_NOT_READY'))));
  });
  web=start(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(config.port)],release,config.env);
  const deadline=Date.now()+config.readyTimeoutSeconds*1000;let successes=0;
  while(Date.now()<deadline&&!signal.aborted){
   if(!alive(web)||!alive(worker))throw Error('RELEASE_PROCESS_FAILED');
   try{const r=await fetch('http://127.0.0.1:'+config.port+'/dashboard/app/api/health/ready',{signal:AbortSignal.timeout(2000),redirect:'error',cache:'no-store'}),body=await r.json();if(r.ok&&body.product==='averidi-dashboard'&&body.ready===true&&body.checks?.database===true&&body.checks?.worker===true&&body.checks?.storage===true){if(++successes===2)return;}else successes=0;}catch{successes=0;}await delay(300);
  }
  throw Error('RELEASE_NOT_READY');
 }
 async function apply(request){
  if(closing||signal.aborted)throw Error('RELEASE_STOPPING');
  if(request.action==='status')return {...current,running:alive(web)&&alive(worker),transitioning,degraded:failed};
  if(request.expectedCurrent!==current.current)throw Error('RELEASE_STALE_STATE');
  if(configHash!==createHash('sha256').update(await readFile(path.join(root,'runtime.json'))).digest('hex'))throw Error('RELEASE_CONFIG_CHANGED_RESTART_REQUIRED');
  const next=request.action==='rollback'?current.previous:request.release;if(!next)throw Error('RELEASE_NO_ROLLBACK');
  const candidate=await verifyRelease(path.join(root,'releases',next),next);
  if(!current.maintenance&&next===current.current&&alive(web)&&alive(worker))return {...current,running:true,unchanged:true};
  const schemaChange=current.migrationDigest!==candidate.migrationDigest;
  if(request.action==='rollback'&&(schemaChange||current.maintenance))throw Error('RELEASE_SCHEMA_ROLLBACK_REJECTED');
  if((schemaChange||current.maintenance)&&!request.migrate)throw Error('RELEASE_MIGRATION_REQUIRED');
  if(schemaChange&&current.current){const previous=await verifyRelease(path.join(root,'releases',current.current),current.current);if(previous.manifest.migrations.some((m,i)=>JSON.stringify(m)!==JSON.stringify(candidate.manifest.migrations[i])))throw Error('RELEASE_MIGRATION_HISTORY_REJECTED');}
  let migrationEnv=null;
  if(schemaChange||current.maintenance){const owner=await privateJson(path.join(root,'migration.json'));if(Object.keys(owner).length!==1||typeof owner.DASHBOARD_MIGRATION_DATABASE_URL!=='string')throw Error('RELEASE_MIGRATION_CONFIG_REJECTED');migrationEnv={...config.env,DASHBOARD_MIGRATION_DATABASE_URL:owner.DASHBOARD_MIGRATION_DATABASE_URL};await run(['--import','tsx','scripts/releases/migration-preflight.mjs'],path.join(root,'releases',next),migrationEnv);}
  const old={...current};await audit('transition_requested',{from:old.current,to:next,migrate:!!request.migrate});transitioning=true;
  try{
   if(schemaChange||current.maintenance){
    // Persist the fence BEFORE stopping services or running forward-only migrations. A crash cannot boot an old incompatible release.
    await save({...old,previous:null,maintenance:true});await halt();
    const env=migrationEnv,release=path.join(root,'releases',next);
    await run(['--import','tsx','scripts/migrate-database.mjs'],release,env);
    await run(['--import','tsx','scripts/grant-database-access.mjs'],release,env);
   }else await halt();
   await launch(next);await save({format:1,current:next,previous:schemaChange||old.maintenance?null:old.current,migrationDigest:candidate.migrationDigest,maintenance:false});failed=false;await audit('activated',{release:next});return {...current,running:true};
  }catch(error){
   await halt();await audit('activation_failed',{release:next,error:safe(error)});
   if(!schemaChange&&!old.maintenance&&old.current&&!signal.aborted){try{await launch(old.current);await save(old);failed=false;await audit('restored',{release:old.current});}catch{await halt();await save(old);failed=true;await audit('restore_failed',{release:old.current});}}
   else if(schemaChange||old.maintenance){if(!current.maintenance)await save({...old,previous:null,maintenance:true});}else{await save(old);failed=true;}
   throw Error(safe(error));
  }finally{transitioning=false;}
 }
 const controlFile=path.join(root,'control.json'),token=randomBytes(32).toString('hex');
 const server=net.createServer(connection=>{
  let bytes=0,input='',handled=false;connection.setTimeout(15_000,()=>{if(!handled)connection.destroy();});connection.on('error',()=>{});
  connection.on('data',chunk=>{if(handled)return;bytes+=chunk.length;if(bytes>4096){connection.destroy();return;}input+=chunk.toString();if(!input.includes('\n'))return;handled=true;connection.setTimeout(0);
   let request;try{const envelope=JSON.parse(input);if(typeof envelope.token!=='string'||!/^[a-f0-9]{64}$/.test(envelope.token)||!timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(envelope.token,'hex')))throw Error('RELEASE_CONTROL_FORBIDDEN');request=requestSchema.parse(envelope.body);}catch{connection.end(JSON.stringify({ok:false,error:'RELEASE_INVALID_REQUEST'})+'\n');return;}
   queue=queue.then(async()=>{try{connection.end(JSON.stringify({ok:true,result:await apply(request)})+'\n');}catch(e){connection.end(JSON.stringify({ok:false,error:safe(e)})+'\n');}});
  });
 });
 server.maxConnections=32;
 const abort=()=>{closing=true;if(server.listening)server.close();};signal.addEventListener('abort',abort,{once:true});
 try{
  if(current.current&&!current.maintenance){try{await launch(current.current);}catch{await halt();failed=true;await audit('startup_failed');}}
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});await atomicJson(controlFile,{port:server.address().port,token});await audit('host_ready');
  const monitor=setInterval(()=>{if(current.current&&!current.maintenance&&!failed&&!transitioning&&(!alive(web)||!alive(worker))){transitioning=true;queue=queue.then(async()=>{try{await halt();failed=true;await audit('process_lost');}finally{transitioning=false;}});}},500);
  try{if(!signal.aborted)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}finally{clearInterval(monitor);}
 }finally{closing=true;signal.removeEventListener('abort',abort);if(server.listening)server.close();await queue;await halt();await unlink(controlFile).catch(()=>{});}
}
export async function hostRequest(folder,request){const root=await hostRoot(folder),control=z.object({port:z.number().int().min(1).max(65535),token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await privateJson(path.join(root,'control.json')));return new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:control.port});let data='';socket.setTimeout(900_000,()=>socket.destroy(Error('RELEASE_CONTROL_TIMEOUT')));socket.once('error',reject);socket.once('connect',()=>socket.write(JSON.stringify({token:control.token,body:requestSchema.parse(request)})+'\n'));socket.on('data',chunk=>{data+=chunk;if(data.length>32768)socket.destroy(Error('RELEASE_INVALID_RESPONSE'));});socket.once('end',()=>{try{const r=JSON.parse(data);if(!r.ok)throw Error(r.error);resolve(r.result);}catch(e){reject(e);}});});}
