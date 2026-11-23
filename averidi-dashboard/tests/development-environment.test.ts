import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {developmentRuntime,cleanDevelopmentEnvironment,privateDirectory,privateJson,readDevelopmentSettings,developmentOwner} from '../scripts/development/environment.mjs';
const settings={databaseUrl:'postgresql://dashboard_development_runtime:private-test-password@127.0.0.1:5434/dashboard_dev?schema=public',sessionSecret:'a'.repeat(96),connectorKey:'b'.repeat(64)};

test('development runtime uses only its restricted database and removes inherited owner, integration and release configuration',()=>{
 const runtime=developmentRuntime(settings,'/tmp/dashboard-environment',{PATH:'/usr/bin',DASHBOARD_MIGRATION_DATABASE_URL:'postgresql://production-owner:secret@production.invalid/main',DATABASE_URL:'foreign',DASHBOARD_RELEASE_MODE:'GENERAL',DASHBOARD_WORKER_ENABLED:'false',DASHBOARD_BILLING_ENABLED:'true',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'true',DASHBOARD_DATA_CONNECTORS_ENABLED:'true',DASHBOARD_OIDC_ISSUER:'https://foreign.invalid',COMPOSE_FILE:'foreign.yaml',COMPOSE_PROJECT_NAME:'foreign'});
 assert.equal(runtime.DASHBOARD_MIGRATION_DATABASE_URL,'');assert.equal(runtime.DATABASE_URL,undefined);assert.equal(runtime.COMPOSE_FILE,undefined);assert.equal(runtime.COMPOSE_PROJECT_NAME,undefined);
 for(const key of ['DASHBOARD_BILLING_ENABLED','DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED','DASHBOARD_DATA_CONNECTORS_ENABLED','DASHBOARD_ADMIN_BRIDGE_ENABLED'])assert.equal(runtime[key],'false');
 assert.equal(runtime.DASHBOARD_RELEASE_MODE,'OFF');assert.equal(runtime.DASHBOARD_WORKER_ENABLED,'true');assert.equal(runtime.DASHBOARD_OIDC_ISSUER,'');assert.equal(runtime.DASHBOARD_DATABASE_URL,settings.databaseUrl);assert.ok(!JSON.stringify(runtime).includes('production-owner'));
 assert.throws(()=>cleanDevelopmentEnvironment({NODE_TLS_REJECT_UNAUTHORIZED:'0'}));
});
test('development configuration refuses external, owner, shared or test databases and malformed secrets',()=>{
 for(const databaseUrl of [settings.databaseUrl.replace('127.0.0.1','production.invalid'),settings.databaseUrl.replace('dashboard_development_runtime:','dashboard:'),settings.databaseUrl.replace('dashboard_dev?','dashboard_test?'),settings.databaseUrl+'&schema=public',settings.databaseUrl.replace('schema=public','schema=public_shared')])assert.throws(()=>developmentRuntime({...settings,databaseUrl},'/tmp/dashboard-environment'));
 assert.throws(()=>developmentRuntime({...settings,sessionSecret:'weak'},'/tmp/dashboard-environment'));
 assert.equal(developmentOwner(settings.databaseUrl.replace('dashboard_development_runtime:','dashboard:')).pathname,'/dashboard_dev');
 for(const value of [settings.databaseUrl,settings.databaseUrl.replace('dashboard_dev?','dashboard_test?'),settings.databaseUrl.replace('127.0.0.1','remote.invalid')])assert.throws(()=>developmentOwner(value));
});
test('generated development credentials persist privately and reject symlinks or permissive runtime files',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-development-config-'));
 try{
  const folder=path.join(root,'.local/development');await privateDirectory(folder);const filename=path.join(folder,'runtime.json');
  await privateJson(filename,settings,{create:true});assert.deepEqual(await readDevelopmentSettings(root),settings);
  await assert.rejects(privateJson(filename,{...settings,sessionSecret:'c'.repeat(96)},{create:true}));assert.deepEqual(JSON.parse(await readFile(filename,'utf8')),settings);
  await chmod(filename,0o644);await assert.rejects(readDevelopmentSettings(root));await chmod(filename,0o600);
  const link=path.join(folder,'link.json');await symlink(filename,link);await assert.rejects(privateJson(link,{}));assert.deepEqual(await readDevelopmentSettings(root),settings);
  await mkdir(path.join(root,'other'));const dirlink=path.join(root,'linked');await symlink(path.join(root,'other'),dirlink);await assert.rejects(privateDirectory(dirlink));
 }finally{await rm(root,{recursive:true,force:true});}
});
