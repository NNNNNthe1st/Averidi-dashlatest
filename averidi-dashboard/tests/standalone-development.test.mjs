import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {standaloneCodespacesSettings} from '../scripts/development/standalone.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));

test('standalone Codespaces settings enable trial onboarding without identity fixtures',()=>{
 const values=standaloneCodespacesSettings({CODESPACES:'true',CODESPACE_NAME:'onboarding-test-codespace',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'});
 assert.equal(values.DASHBOARD_RELEASE_MODE,'GENERAL');
 assert.equal(values.DASHBOARD_PUBLIC_ORIGIN,'https://onboarding-test-codespace-3000.app.github.dev');
 assert.equal(values.DASHBOARD_PUBLIC_URL,values.DASHBOARD_PUBLIC_ORIGIN);
 assert.equal(values.DASHBOARD_DEVELOPMENT_CODESPACES,'true');
 assert.ok(!Object.keys(values).some(k=>/OIDC|CERT/.test(k)));
 assert.throws(()=>standaloneCodespacesSettings({NODE_ENV:'production'}));
});

test('repair resolves launcher conflict while preserving local deletions, private email and other changes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-standalone-repair-'));
 const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  git(['init','--initial-branch=feature/independent-dashboard']);git(['config','user.name','Repair Test']);git(['config','user.email','repair@example.test']);
  for(const dir of ['scripts/development','src/server','.local/development'])await mkdir(path.join(root,dir),{recursive:true});
  await symlink(path.join(repo,'node_modules'),path.join(root,'node_modules'),'dir');
  await writeFile(path.join(root,'.gitignore'),'node_modules/\n.local/\n');
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'averidi-dashboard',scripts:{custom:'keep-local-command'}}));
  await writeFile(path.join(root,'scripts/serve-development.mjs'),'console.log("base");\n');
  await writeFile(path.join(root,'scripts/development/environment.mjs'),'export const fixture=true;\n');
  await writeFile(path.join(root,'scripts/development/email.mjs'),'export const fixture=true;\n');
  await writeFile(path.join(root,'legacy-fixture.mjs'),'obsolete\n');
  await writeFile(path.join(root,'next-env.d.ts'),'original\n');
  git(['add','.']);git(['commit','-m','base']);
  git(['checkout','-b','incoming']);await writeFile(path.join(root,'scripts/serve-development.mjs'),'console.log("remote");\n');git(['commit','-am','incoming launcher']);
  git(['checkout','feature/independent-dashboard']);await writeFile(path.join(root,'scripts/serve-development.mjs'),'console.log("local");\n');git(['rm','legacy-fixture.mjs']);git(['commit','-am','local removal']);
  assert.notEqual(spawnSync('git',['merge','incoming'],{cwd:root,encoding:'utf8'}).status,0);
  await writeFile(path.join(root,'next-env.d.ts'),'preserve-local-change\n');
  await writeFile(path.join(root,'.local/development/email.json'),'private-email-fixture\n',{mode:0o600});
  const repair=spawnSync(process.execPath,[path.join(repo,'scripts/repair-standalone-development.mjs')],{cwd:root,encoding:'utf8'});
  assert.equal(repair.status,0,repair.stderr+'\n'+repair.stdout);
  assert.equal(git(['diff','--name-only','--diff-filter=U']).trim(),'');
  assert.equal(await readFile(path.join(root,'next-env.d.ts'),'utf8'),'preserve-local-change\n');
  assert.equal(await readFile(path.join(root,'.local/development/email.json'),'utf8'),'private-email-fixture\n');
  await assert.rejects(access(path.join(root,'legacy-fixture.mjs')));
  assert.equal(JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).scripts.custom,'keep-local-command');
  const launcher=await readFile(path.join(root,'scripts/serve-development.mjs'),'utf8');
  assert.doesNotMatch(launcher,/<<<<<<<|codespaces-fetch|OIDC|identity-codespaces/);
  const staged=git(['diff','--cached','--name-only']);assert.ok(staged.includes('scripts/serve-development.mjs'));assert.ok(!staged.includes('next-env.d.ts'));
  git(['commit','--no-edit']);
 }finally{await rm(root,{recursive:true,force:true});}
});
