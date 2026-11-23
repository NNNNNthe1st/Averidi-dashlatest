import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {emailEnvironment,readDevelopmentEmail} from '../scripts/development/email.mjs';
import {developmentRuntime} from '../scripts/development/environment.mjs';
const settings={DASHBOARD_EMAIL_API_KEY:'re_test_private',DASHBOARD_EMAIL_FROM:'Averidi <support@averidi.com>',DASHBOARD_PUBLIC_URL:'https://example-3000.app.github.dev'};
test('email settings match the selected origin and cannot override runtime isolation',()=>{
 const env=emailEnvironment(settings,settings.DASHBOARD_PUBLIC_URL);
 assert.equal(env.DASHBOARD_PUBLIC_ORIGIN,settings.DASHBOARD_PUBLIC_URL);
 assert.throws(()=>emailEnvironment(settings,'https://localhost:8443'));
 for(const bad of [{DASHBOARD_DATABASE_URL:'foreign'},{DASHBOARD_EMAIL_API_KEY:''},{DASHBOARD_EMAIL_FROM:'invalid'},{DASHBOARD_EMAIL_FROM:'Averidi\n<support@averidi.com>'},{DASHBOARD_PUBLIC_URL:'http://example.com'},{DASHBOARD_PUBLIC_URL:'https://example.com/dashboard/app'},{DASHBOARD_PUBLIC_URL:'https://user:pass@example.com'},{DASHBOARD_PUBLIC_URL:'https://example.com?x=1'}])assert.throws(()=>emailEnvironment({...settings,...bad}));
 const runtime=developmentRuntime({databaseUrl:'postgresql://dashboard_development_runtime:test@127.0.0.1:5434/dashboard_dev?schema=public',sessionSecret:'a'.repeat(96),connectorKey:'b'.repeat(64)},'/tmp/dashboard',{DASHBOARD_EMAIL_API_KEY:'inherited',DASHBOARD_BILLING_ENABLED:'true'});
 assert.equal(runtime.DASHBOARD_EMAIL_API_KEY,undefined);
 Object.assign(runtime,env);
 assert.equal(runtime.DASHBOARD_EMAIL_API_KEY,settings.DASHBOARD_EMAIL_API_KEY);
 assert.equal(runtime.DASHBOARD_BILLING_ENABLED,'false');
 assert.equal(runtime.DASHBOARD_MIGRATION_DATABASE_URL,'');
});
test('optional private file rejects malformed, public, symlink and stale configuration',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-email-'));
 try{
  assert.deepEqual(await readDevelopmentEmail(root),{});
  const folder=path.join(root,'.local/development');await mkdir(folder,{recursive:true});
  const filename=path.join(folder,'email.json');await writeFile(filename,JSON.stringify(settings),{mode:0o600});
  assert.equal((await readDevelopmentEmail(root,settings.DASHBOARD_PUBLIC_URL)).DASHBOARD_EMAIL_FROM,settings.DASHBOARD_EMAIL_FROM);
  await assert.rejects(readDevelopmentEmail(root,'https://other.app.github.dev'));
  await chmod(filename,0o644);await assert.rejects(readDevelopmentEmail(root));await chmod(filename,0o600);
  await writeFile(filename,'{invalid');await assert.rejects(readDevelopmentEmail(root),/Invalid Dashboard email JSON/);
  await rm(filename);await writeFile(path.join(folder,'target.json'),JSON.stringify(settings),{mode:0o600});await symlink(path.join(folder,'target.json'),filename);await assert.rejects(readDevelopmentEmail(root));
 }finally{await rm(root,{recursive:true,force:true});}
});
