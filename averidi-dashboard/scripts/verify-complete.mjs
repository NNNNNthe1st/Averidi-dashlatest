import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {verificationDatabases,discoverTestInventory,parsePassingTap,sourceFingerprint} from './verification/contracts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const reports=path.join(root,'.local','verification',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
await mkdir(reports,{recursive:true,mode:0o700});
const report={version:1,status:'RUNNING',startedAt:new Date().toISOString(),node:process.version,source:null,testFiles:[],stages:[]};
const summary=path.join(reports,'summary.json');
const save=()=>writeFile(summary,JSON.stringify(report,null,2)+'\n');
let child=null,interrupted=false;
function stop(signal){interrupted=true;if(child){try{process.kill(-child.pid,signal);}catch{child.kill(signal);}}}
process.once('SIGTERM',()=>stop('SIGTERM'));process.once('SIGINT',()=>stop('SIGTERM'));
function execute(args,env,log,timeout){
 return new Promise((resolve,reject)=>{
  let output='';const started=Date.now();
  child=spawn(process.execPath,args,{cwd:root,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  const running=child;let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;try{process.kill(-running.pid,'SIGTERM');}catch{running.kill('SIGTERM');}setTimeout(()=>{try{process.kill(-running.pid,'SIGKILL');}catch{}},5000).unref();},timeout);timer.unref();
  running.stdout.on('data',chunk=>{output+=chunk;});running.stderr.on('data',chunk=>{output+=chunk;});
  running.on('error',error=>{clearTimeout(timer);child=null;reject(error);});
  running.on('close',async(code,signal)=>{clearTimeout(timer);child=null;try{output=output.replaceAll(env.DASHBOARD_DATABASE_URL??'never-match-runtime-url','[verification database]').replaceAll(env.DASHBOARD_MIGRATION_DATABASE_URL??'never-match-migration-url','[migration database]');await writeFile(log,output);resolve({code,signal,timedOut,elapsedMs:Date.now()-started,output});}catch(error){reject(error);}});
 });
}
try{
 if(process.versions.node.split('.')[0]!=='22')throw Error('VERIFICATION_REQUIRES_NODE_22');
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('VERIFICATION_REQUIRES_TLS_VALIDATION');
 const urls=verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DASHBOARD_')));
 Object.assign(env,{CHECKPOINT_DISABLE:'1',NEXT_TELEMETRY_DISABLED:'1',DASHBOARD_DATABASE_URL:urls.runtime.toString(),DASHBOARD_MIGRATION_DATABASE_URL:urls.owner.toString(),DASHBOARD_STORAGE_ROOT:path.join(reports,'storage'),DASHBOARD_STORAGE_BACKEND:'local',DASHBOARD_STORAGE_WRITE_CHECK:'true',DASHBOARD_VERIFICATION_NO_BUILD_CACHE:'true',DASHBOARD_RELEASE_MODE:'OFF',DASHBOARD_WORKER_ENABLED:'false',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_DATA_CONNECTORS_ENABLED:'false',DASHBOARD_BILLING_ENABLED:'false',DASHBOARD_ADMIN_BRIDGE_ENABLED:'false'});
 for(const key of ['DASHBOARD_BROWSER_EXECUTABLE','DASHBOARD_PG_BIN'])if(process.env[key])env[key]=process.env[key];
 const ownerEnv={...env,DASHBOARD_DATABASE_URL:urls.owner.toString()};
 report.source=await sourceFingerprint(root);
 report.revision=process.env.GITHUB_SHA??execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const inventory=await discoverTestInventory(root);report.testFiles=inventory.regression;report.browserFiles=inventory.browser;
 const plan=[
  {id:'history',args:['scripts/verify-repository-history.mjs','--archive']},
  {id:'isolation',args:['scripts/check-isolation.mjs']},
  {id:'requirements-traceability',args:['scripts/check-requirements-traceability.mjs']},
  {id:'contracts',args:['--import','tsx','scripts/dashboard-contracts.mjs','--check']},
  {id:'dependency-security',args:['scripts/security/audit.mjs',path.join(reports,'dependency-audit.json')]},
  {id:'schema',args:['node_modules/prisma/build/index.js','validate','--schema','prisma/schema.prisma']},
  {id:'generate',args:['node_modules/prisma/build/index.js','generate','--schema','prisma/schema.prisma']},
  {id:'migrations',args:['--import','tsx','scripts/migrate-database.mjs'],env:ownerEnv},
  {id:'owner-database',args:['--import','tsx','scripts/check-database.mjs'],env:ownerEnv},
  {id:'upgrade',args:['--import','tsx','scripts/verify-database-upgrade.mjs'],env:ownerEnv},
  {id:'runtime-role',args:['--import','tsx','scripts/create-verification-role.mjs']},
  {id:'runtime-grants',args:['--import','tsx','scripts/grant-database-access.mjs']},
  {id:'runtime-database',args:['--import','tsx','scripts/check-database.mjs']},
  {id:'regression',args:['scripts/test-auth-worker.mjs',...report.testFiles],env:{...env,DASHBOARD_TEST_REPORT_DIRECTORY:path.join(reports,'regression')},tap:true},
  {id:'drift',args:['node_modules/prisma/build/index.js','migrate','diff','--from-schema-datasource','prisma/schema.prisma','--to-schema-datamodel','prisma/schema.prisma','--exit-code']},
  {id:'storage-probe',args:['--import','tsx','scripts/check-storage.mjs']},
  {id:'database-recovery',args:['--import','tsx','scripts/verify-database-recovery.mjs'],env:{...env,DASHBOARD_DATABASE_RECOVERY_REPORT:path.join(reports,'database-recovery.json')}},
  {id:'clean-build-output',args:['scripts/clean-verification-build.mjs']},
  {id:'route-types',args:['node_modules/next/dist/bin/next','typegen']},
  {id:'typescript',args:['node_modules/typescript/bin/tsc','--noEmit']},
  {id:'build',args:['node_modules/next/dist/bin/next','build']},
  {id:'account-erasure-browser',args:['--import','tsx','scripts/test-account-erasure-browser.mjs'],env:{...env,DASHBOARD_ERASURE_A11Y_REPORT:path.join(reports,'account-erasure-accessibility.json')}},
  {id:'authentication-browser',args:['scripts/test-auth-worker.mjs',...inventory.browser],env:{...env,DASHBOARD_TEST_REPORT_DIRECTORY:path.join(reports,'authentication-browser')},tap:true},
  {id:'bi-browser',args:['--import','tsx','scripts/test-bi-browser.mjs'],env:{...env,DASHBOARD_BROWSER_A11Y_REPORT:path.join(reports,'accessibility.json')}},
 ];
 report.stages=plan.map(({id})=>({id,status:'NOT_RUN'}));await save();
 for(const stage of plan){
  if(interrupted)throw Error('VERIFICATION_INTERRUPTED');
  const record=report.stages.find(row=>row.id===stage.id);record.status='RUNNING';record.startedAt=new Date().toISOString();record.log=stage.id+'.log';await save();console.log('VERIFY '+stage.id);
  const result=await execute(stage.args,stage.env??env,path.join(reports,record.log),600000);
  record.elapsedMs=result.elapsedMs;record.exitCode=result.code;record.status='FAILED';
  if(result.code!==0||result.timedOut||interrupted){await save();console.error(result.output.slice(-6000).replaceAll(urls.owner.toString(),'[migration database]').replaceAll(urls.runtime.toString(),'[runtime database]'));throw Error('VERIFICATION_STAGE_FAILED:'+stage.id);}
  try{
   if(stage.tap){record.tests=parsePassingTap(result.output);const xml=await readFile(path.join(reports,stage.id==='regression'?'regression':'authentication-browser','junit.xml'),'utf8');if(!xml.includes('<testsuites')||!xml.includes('<testcase'))throw Error('VERIFICATION_JUNIT_MISSING');}
   if(stage.id==='bi-browser'){if(!result.output.includes('PASS: live production web')||!result.output.includes('PASS: readiness returns 503')||!result.output.includes('PASS: browser upload')||!result.output.includes('PASS: keyboard and WCAG'))throw Error('VERIFICATION_BROWSER_EVIDENCE_MISSING');const accessibility=JSON.parse(await readFile(path.join(reports,'accessibility.json'),'utf8'));if(accessibility.scans.length<3||accessibility.scans.some(scan=>scan.violations.length))throw Error('VERIFICATION_ACCESSIBILITY_FAILED');record.accessibilityScans=accessibility.scans.length;}
   if(stage.id==='account-erasure-browser'){if(!result.output.includes('PASS: HTTPS reviewed erasure'))throw Error('VERIFICATION_ERASURE_EVIDENCE_MISSING');const accessibility=JSON.parse(await readFile(path.join(reports,'account-erasure-accessibility.json'),'utf8'));if(accessibility.scans.length!==6||accessibility.scans.some(scan=>scan.violations.length))throw Error('VERIFICATION_ERASURE_ACCESSIBILITY_FAILED');record.accessibilityScans=accessibility.scans.length;}
   record.status='PASSED';await save();console.log('PASS '+stage.id+(record.tests?' '+record.tests.tests+' tests':''));
  }catch(error){await save();throw error;}
 }
 const final=await sourceFingerprint(root);if(final.sha256!==report.source.sha256)throw Error('VERIFICATION_SOURCE_CHANGED_DURING_RUN');
 report.status='PASSED';report.finishedAt=new Date().toISOString();await save();console.log('Complete Dashboard verification PASSED. Evidence: '+path.relative(root,summary));
}catch(error){report.status='FAILED';report.finishedAt=new Date().toISOString();report.error=error instanceof Error?error.message:'VERIFICATION_FAILED';await save();console.error(report.error);console.error('Evidence: '+path.relative(root,summary));process.exitCode=1;}
