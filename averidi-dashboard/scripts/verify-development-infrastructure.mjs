import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {cleanDevelopmentEnvironment} from './development/environment.mjs';
import {verificationDatabases} from './verification/contracts.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const id=new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
const folder=path.join(root,'.local/development-acceptance',id);
await mkdir(folder,{recursive:true,mode:0o700});
const summary=path.join(folder,'summary.json');
const report={version:1,status:'RUNNING',startedAt:new Date().toISOString(),provisioning:null,completeVerification:null,cleanup:'NOT_REQUIRED'};
const save=()=>writeFile(summary,JSON.stringify(report,null,2)+'\n',{mode:0o600});
const project='dashboard-check-'+randomUUID().slice(0,8);
const compose=['compose','--project-name',project,'-f','infrastructure/development/compose.test.yaml'];
let provisioned=false,child=null,interrupted=false;
function kill(running,signal){try{process.kill(-running.pid,signal);}catch{running.kill(signal);}}
function stop(){interrupted=true;if(child){const running=child;kill(running,'SIGTERM');setTimeout(()=>kill(running,'SIGKILL'),5000).unref();}}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
function run(command,args,env,timeout=1800000){
 return new Promise((resolve,reject)=>{
  let output='',timedOut=false;
  child=spawn(command,args,{cwd:root,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});const running=child;
  const timer=setTimeout(()=>{timedOut=true;kill(running,'SIGTERM');setTimeout(()=>kill(running,'SIGKILL'),5000).unref();},timeout);
  running.stdout.on('data',chunk=>{output+=chunk;if(command===process.execPath&&args[0]==='scripts/verify-complete.mjs')process.stdout.write(chunk);});running.stderr.on('data',chunk=>{output+=chunk;});
  running.once('error',error=>{clearTimeout(timer);child=null;reject(error);});
  running.once('close',async(code)=>{clearTimeout(timer);child=null;try{if(command===process.execPath&&args[0]==='scripts/verify-complete.mjs'){const safe=output.replaceAll(env.DASHBOARD_DATABASE_URL,'[runtime database]').replaceAll(env.DASHBOARD_MIGRATION_DATABASE_URL,'[migration database]');await writeFile(path.join(folder,'complete.log'),safe,{mode:0o600});const match=/Evidence: (.+summary\.json)/.exec(output);if(match)report.completeVerification=match[1];}}catch(error){reject(error);return;}if(code!==0||timedOut)reject(Error('Development acceptance command failed: '+command+' '+args[0]));else resolve(output);});
 });
}
try{
 if(process.versions.node.split('.')[0]!=='22')throw Error('Development acceptance requires Node 22.');
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>arg!=='--existing-test-database'))throw Error('Usage: npm run verify:development-infrastructure [-- --existing-test-database]');
 const env=cleanDevelopmentEnvironment();
 for(const key of ['DASHBOARD_BROWSER_EXECUTABLE','DASHBOARD_PG_BIN'])if(process.env[key])env[key]=process.env[key];
 if(args.includes('--existing-test-database')){
  const urls=verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
  Object.assign(env,{DASHBOARD_DATABASE_URL:urls.runtime.toString(),DASHBOARD_MIGRATION_DATABASE_URL:urls.owner.toString()});
  report.provisioning='existing-isolated-native-test-database';
 }else{
  await run('docker',['compose','version'],env,30000);
  provisioned=true;report.cleanup='PENDING';report.provisioning='disposable-compose-postgresql-17';await save();
  await run('docker',[...compose,'up','-d','--wait'],env,180000);
  const address=(await run('docker',[...compose,'port','postgres','5432'],env,30000)).trim();
  const match=/^127\.0\.0\.1:(\d+)$/.exec(address);if(!match)throw Error('Acceptance requires a loopback-only database port.');
  Object.assign(env,{DASHBOARD_DATABASE_URL:`postgresql://dashboard_acceptance_runtime:dashboard-runtime-test-only@127.0.0.1:${match[1]}/dashboard_test?schema=public`,DASHBOARD_MIGRATION_DATABASE_URL:`postgresql://dashboard:dashboard-test-only@127.0.0.1:${match[1]}/dashboard_test?schema=public`});
 }
 if(interrupted)throw Error('Development acceptance interrupted.');
 console.log('Running complete combined development acceptance; results are retained under .local.');await save();
 const output=await run(process.execPath,['scripts/verify-complete.mjs'],env);
 const match=/Complete Dashboard verification PASSED\. Evidence: (.+summary\.json)/.exec(output);
 if(!match)throw Error('Complete verification evidence missing.');
 const evidence=path.resolve(root,match[1]);if(!evidence.startsWith(path.join(root,'.local/verification')+path.sep))throw Error('Unexpected complete verification evidence path.');
 const combined=JSON.parse(await readFile(evidence,'utf8'));
 if(combined.status!=='PASSED'||combined.stages.length!==21||combined.stages.some(stage=>stage.status!=='PASSED')||interrupted)throw Error('Combined verification is incomplete.');
 report.completeVerification=path.relative(root,evidence);report.source=combined.source;report.stages=combined.stages.map(({id,status})=>({id,status}));report.status='PASSED';
}catch(error){report.status='FAILED';report.error=error.message;process.exitCode=1;}
finally{
 if(provisioned){try{await run('docker',[...compose,'down','--volumes','--remove-orphans'],cleanDevelopmentEnvironment(),120000);report.cleanup='PASSED';}catch{report.cleanup='FAILED';report.status='FAILED';report.error='Disposable Compose cleanup failed.';process.exitCode=1;}}
 report.finishedAt=new Date().toISOString();await save();
 console.log('Development acceptance '+report.status+'. Evidence: '+path.relative(root,summary));
 if(report.error)console.error(report.error);
}
