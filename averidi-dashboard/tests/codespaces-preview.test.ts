import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile,mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {codespacesPreviewLaunch} from '../scripts/development/codespaces-launcher.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {codespacesOrigins,codespacesOidcSettings,oidcLoopbackTarget} from '../scripts/development/codespaces.mjs';
const exec=promisify(execFile);
const fixture={CODESPACES:'true',CODESPACE_NAME:'dashboard-preview-test-only',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev',NODE_ENV:'development' as const};
test('Codespaces preview derives exact HTTPS origins and refuses non-development or foreign environments',()=>{
 const origins=codespacesOrigins(fixture),config=codespacesOidcSettings(fixture);
 assert.equal(origins.app,'https://dashboard-preview-test-only-3000.app.github.dev');
 assert.equal(config.DASHBOARD_OIDC_REDIRECT_URL,origins.app+'/dashboard/app/api/auth/callback');
 for(const values of [{CODESPACES:'false'},{NODE_ENV:'production'},{CODESPACE_NAME:'../foreign'},{CODESPACE_NAME:'--------'},{GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'attacker.invalid'}])assert.throws(()=>codespacesOrigins({...fixture,...values}));
});
test('OIDC development routing is limited to exact issuer backchannel paths and preserves application endpoints',()=>{
 const {issuer,app}=codespacesOrigins(fixture);
 for(const suffix of ['/protocol/openid-connect/token','/protocol/openid-connect/certs','/.well-known/openid-configuration'])assert.equal(oidcLoopbackTarget(issuer+suffix,fixture),'https://localhost:9443/realms/dashboard-development'+suffix);
 assert.equal(oidcLoopbackTarget(app+'/dashboard/app/api/health',fixture),null);
 assert.equal(oidcLoopbackTarget('https://other.example.com/token',fixture),null);
 for(const suffix of ['/protocol/openid-connect/auth','/protocol/openid-connect/certs?override=1','/protocol/openid-connect/token#fragment','/foreign'])assert.throws(()=>oidcLoopbackTarget(issuer+suffix,fixture));
 assert.throws(()=>oidcLoopbackTarget(issuer.replace('https://','https://user:password@')+'/protocol/openid-connect/token',fixture));
});
test('preloaded Codespaces OIDC backchannel performs real trusted TLS and preserves POST data and Request objects',async()=>{
 const cert=await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key=await readFile(process.env.DASHBOARD_TEST_TLS_KEY!);
 const seen:{path:string|undefined;method:string|undefined;body:string}[]=[];
 const server=https.createServer({cert,key},async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push({path:req.url,method:req.method,body});res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const issuer=codespacesOrigins(fixture).issuer;const env:NodeJS.ProcessEnv={...process.env,...fixture,DASHBOARD_DEVELOPMENT_CODESPACES_OIDC:'true',DASHBOARD_OIDC_ISSUER:issuer,NODE_EXTRA_CA_CERTS:process.env.DASHBOARD_TEST_TLS_CERT,DASHBOARD_TEST_CODESPACES_TLS_PORT:String(address.port)};delete env.NODE_TEST_CONTEXT;
  const result=await exec(process.execPath,['--input-type=module','-e',`const nativeFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://localhost:9443')throw Error('Unexpected backchannel destination');url.port=process.env.DASHBOARD_TEST_CODESPACES_TLS_PORT;return nativeFetch(input instanceof Request?new Request(url,input):url,init);};await import('./scripts/development/codespaces-fetch.mjs');const issuer=process.env.DASHBOARD_OIDC_ISSUER;const a=await fetch(issuer+'/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'code=fixture&code_verifier=fixture-pkce',redirect:'error'});if(!(await a.json()).ok)process.exit(1);const b=await fetch(new Request(issuer+'/protocol/openid-connect/certs'));if(!(await b.json()).ok)process.exit(1);console.log('trusted-tls-passed')`],{env});
  assert.match(result.stdout,/trusted-tls-passed/);assert.deepEqual(seen,[{path:'/realms/dashboard-development/protocol/openid-connect/token',method:'POST',body:'code=fixture&code_verifier=fixture-pkce'},{path:'/realms/dashboard-development/protocol/openid-connect/certs',method:'GET',body:''}]);
  await assert.rejects(exec(process.execPath,['--import','./scripts/development/codespaces-fetch.mjs','-e',''],{env:{...env,NODE_ENV:'production'}}));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('Next development asset access is limited to the exact Codespace host and is absent in production',async()=>{
 for(const mode of ['development','production'] as const){
  const env:NodeJS.ProcessEnv={...process.env,...fixture,NODE_ENV:mode};delete env.NODE_TEST_CONTEXT;
  const result=await exec(process.execPath,['--import','tsx','--input-type=module','-e',"import * as module from './next.config.ts';const config=module.default?.default??module.default??module;console.log(JSON.stringify(config.allowedDevOrigins??[]))"],{env});
  assert.deepEqual(JSON.parse(result.stdout.trim()),mode==='development'?['dashboard-preview-test-only-3000.app.github.dev']:[]);
 }
});


test('Codespaces launcher loads the generated identity, CA and preview workspace without email-provider settings',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-codespaces-launcher-'));
 try{
  const folder=path.join(root,'.local/identity-codespaces');
  await mkdir(folder,{recursive:true,mode:0o700});
  const settings={...codespacesOidcSettings(fixture),workspaceId:'dashboard_preview_'+'a'.repeat(32)};
  const settingsFile=path.join(folder,'settings.json');
  await writeFile(settingsFile,JSON.stringify(settings),{mode:0o600});
  await chmod(settingsFile,0o600);
  await writeFile(path.join(folder,'root.crt'),'fixture CA');
  const result=await codespacesPreviewLaunch(root,fixture);
  assert.equal(result.env.DASHBOARD_OIDC_ISSUER,settings.DASHBOARD_OIDC_ISSUER);
  assert.equal(result.env.DASHBOARD_DEVELOPMENT_CODESPACES,'true');
  assert.equal(result.env.DASHBOARD_DEVELOPMENT_CODESPACES_OIDC,'true');
  assert.equal(result.env.DASHBOARD_RELEASE_MODE,'BETA');
  assert.equal(result.env.DASHBOARD_BETA_WORKSPACE_IDS,settings.workspaceId);
  assert.equal(result.env.NODE_EXTRA_CA_CERTS,path.join(folder,'root.crt'));
  assert.equal(result.loginUrl,settings.DASHBOARD_PUBLIC_ORIGIN+'/dashboard/app/api/auth/login');
  assert.deepEqual(result.preload.slice(0,1),['--import']);
  assert.match(result.preload[1],/scripts[\\/]development[\\/]codespaces-fetch\\.mjs$/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Codespaces launcher reports missing identity setup without requiring email configuration',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'dashboard-codespaces-missing-'));
 try{
  await assert.rejects(codespacesPreviewLaunch(root,fixture),/npm run dev:codespaces:setup after npm run dev:setup/);
 }finally{await rm(root,{recursive:true,force:true});}
});
