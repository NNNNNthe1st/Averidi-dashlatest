import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verificationDatabases,parsePassingTap,discoverTestInventory,sourceFingerprint} from '../scripts/verification/contracts.mjs';
const exec=promisify(execFile);
const owner='postgresql://dashboard:fixture-owner@127.0.0.1:5434/dashboard_test?schema=public',runtime='postgresql://dashboard_runtime:fixture-runtime@127.0.0.1:5434/dashboard_test?schema=public';
test('complete verification refuses production-like targets, shared roles and foreign schemas before execution',()=>{
 assert.equal(verificationDatabases(runtime,owner).runtime.pathname,'/dashboard_test');
 for(const value of [runtime.replace('127.0.0.1','database.example.com'),runtime.replace('dashboard_test?','dashboard_dev?'),runtime.replace('schema=public','schema=private'),runtime+'&schema=public',runtime+'&connection_limit=1',runtime.replace('dashboard_runtime:','dashboard:')])assert.throws(()=>verificationDatabases(value,owner));
 assert.throws(()=>verificationDatabases(runtime,owner.replace('5434','5435')));
});
test('actual Node test results reject skips, todos, failures and incomplete summaries even with successful exit',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-verification-reporter-'));
 const fixtureEnv={...process.env};delete fixtureEnv.NODE_TEST_CONTEXT;
 try{
  for(const mode of ['pass','skip','todo','fail']){
   const file=path.join(root,mode+'.test.mjs');
   await writeFile(file,`import {test} from 'node:test';import assert from 'node:assert/strict';test('verification fixture',{skip:${mode==='skip'},todo:${mode==='todo'}},()=>assert.equal(1,${mode==='fail'?2:1}));`);
   let output:string;try{output=(await exec(process.execPath,['--test','--test-reporter=tap',file],{env:fixtureEnv})).stdout;}catch(error){output=(error as {stdout:string}).stdout;}
   if(mode==='pass')assert.equal(parsePassingTap(output).tests,1);else assert.throws(()=>parsePassingTap(output),/VERIFICATION_TEST_COUNTS_REJECTED/);
  }
  assert.throws(()=>parsePassingTap('PASS everything'),/VERIFICATION_TEST_COUNTS_REJECTED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('test discovery includes nested additions and separates browser suites without omitting runtime restrictions',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-verification-inventory-'));
 try{
  await mkdir(path.join(root,'tests/nested'),{recursive:true});await mkdir(path.join(root,'tests/browser'),{recursive:true});
  for(const file of ['database-runtime-role.test.ts','new.test.ts','nested/extra.test.ts','browser/authentication.test.ts','browser/extra.test.ts'])await writeFile(path.join(root,'tests',file),'');
  const result=await discoverTestInventory(root);assert.equal(result.regression.length,3);assert.equal(result.browser.length,2);assert.ok(result.regression.includes('tests/nested/extra.test.ts'));
  await rm(path.join(root,'tests/database-runtime-role.test.ts'));await assert.rejects(discoverTestInventory(root),/VERIFICATION_TEST_INVENTORY_INCOMPLETE/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('preflight failure produces failed evidence and a nonzero exit without invoking a database',async()=>{
 let evidence='';
 try{
  await assert.rejects(exec(process.execPath,['scripts/verify-complete.mjs'],{env:{...process.env,DASHBOARD_DATABASE_URL:runtime.replace('127.0.0.1','production.invalid'),DASHBOARD_MIGRATION_DATABASE_URL:owner}}),(error:any)=>{assert.equal(error.code,1);const match=/Evidence: (.+summary\.json)/.exec(error.stderr);assert.ok(match);evidence=match![1];return true;});
  const full=path.resolve(evidence),base=path.resolve('.local/verification')+path.sep;assert.ok(full.startsWith(base));
  const report=JSON.parse(await readFile(full,'utf8'));assert.equal(report.status,'FAILED');assert.equal(report.error,'VERIFICATION_REQUIRES_ISOLATED_LOOPBACK_DATABASE');assert.equal(report.stages.length,0);
 }finally{if(evidence)await rm(path.dirname(path.resolve(evidence)),{recursive:true,force:true});}
});

test('verification fingerprints public assets and untracked runtime additions while excluding narrative docs',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-verification-source-'));
 try{
  await exec('git',['init','--quiet',root]);await mkdir(path.join(root,'public'));await mkdir(path.join(root,'src'));await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'public/sample.csv'),'fictional,1');await writeFile(path.join(root,'src/page.ts'),'export {};');await writeFile(path.join(root,'docs/note.md'),'review');
  const before=await sourceFingerprint(root);assert.equal(before.files,2);
  await writeFile(path.join(root,'public/sample.csv'),'fictional,2');const changed=await sourceFingerprint(root);assert.notEqual(changed.sha256,before.sha256);
  await writeFile(path.join(root,'docs/note.md'),'updated review');assert.deepEqual(await sourceFingerprint(root),changed);
  await writeFile(path.join(root,'public/new.csv'),'new fictional asset');const addition=await sourceFingerprint(root);assert.equal(addition.files,3);assert.notEqual(addition.sha256,changed.sha256);
 }finally{await rm(root,{recursive:true,force:true});}
});
