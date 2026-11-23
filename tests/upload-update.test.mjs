import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm,access} from 'node:fs/promises';
import {spawnSync,execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
test('upload update preserves local authentication edits, removed identity files and email secrets; reruns safely',async()=>{
 const installer=path.join(repo,'scripts/repair-upload-system.mjs');
 const source=await readFile(installer,'utf8'),match=/const root=process\.cwd\(\),payload=(.*);\n/.exec(source);assert.ok(match);
 const payload=JSON.parse(match[1]);
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-upload-update-'));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  git(['init','--initial-branch=feature/independent-dashboard']);
  await symlink(path.join(repo,'node_modules'),path.join(root,'node_modules'),'dir');
  for(const [p,f] of Object.entries(payload)){if(f.base!==null){await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),f.base);}}
  const studio='src/app/workspaces/[workspaceId]/studio/page.tsx';
  await writeFile(path.join(root,studio),(await readFile(path.join(root,studio),'utf8')).replace('Dataset could not be created. Check subscription and edit permissions.','LOCAL_AUTH_ERROR_PRESERVED'));
  await mkdir(path.join(root,'.local/development'),{recursive:true});await writeFile(path.join(root,'.local/development/email.json'),'private-fixture-only');
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'averidi-dashboard',scripts:{custom:'preserve-my-command','dev:serve':'node scripts/serve-development.mjs'}}));
  await writeFile(path.join(root,'next-env.d.ts'),'preserve-next-env');
  const onboarding='src/features/onboarding/progress.ts',metrics='src/engines/metrics/sales-period-calculations.ts';
  for(const p of [onboarding,metrics]){await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),'export const localWorkingChange=true;\n');}
  for(let attempt=0;attempt<2;attempt++){
   const result=spawnSync(process.execPath,[installer],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});assert.equal(result.status,0,result.stderr);
   assert.ok((await readFile(path.join(root,studio),'utf8')).includes('LOCAL_AUTH_ERROR_PRESERVED'));
   assert.equal(await readFile(path.join(root,'.local/development/email.json'),'utf8'),'private-fixture-only');
   assert.equal(await readFile(path.join(root,'next-env.d.ts'),'utf8'),'preserve-next-env');
   for(const p of [onboarding,metrics])assert.equal(await readFile(path.join(root,p),'utf8'),'export const localWorkingChange=true;\n');
   assert.equal(JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).scripts.custom,'preserve-my-command');
   await assert.rejects(access(path.join(root,'src/server/oidc-browser.ts')));
  }
  const before=await readFile(path.join(root,'next.config.ts'),'utf8');
  await writeFile(path.join(root,'src/engines/ingestion/ingest.ts'),'local incompatible replacement');
  const rejected=spawnSync(process.execPath,[installer],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
  assert.notEqual(rejected.status,0);assert.equal(await readFile(path.join(root,'next.config.ts'),'utf8'),before);
  assert.equal(await readFile(path.join(root,'src/engines/ingestion/ingest.ts'),'utf8'),'local incompatible replacement');
 }finally{await rm(root,{recursive:true,force:true});}
});

