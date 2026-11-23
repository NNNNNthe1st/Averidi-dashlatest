import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash,X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {chromium,type Browser,type BrowserContext} from 'playwright';
import {dashboardDb as db} from '../../src/server/db';
import {startOidcFixture} from '../fixtures/oidc-provider';
import {DASHBOARD_SESSION_COOKIE} from '../../src/server/session-cookie';

const database=new URL(process.env.DASHBOARD_DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(database.hostname)||decodeURIComponent(database.pathname)!=='/dashboard_test')throw Error('Authentication browser acceptance requires disposable loopback dashboard_test.');
function listen(server:http.Server|https.Server){return new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve((server.address() as {port:number}).port));});}
async function freePort(){const server=http.createServer();const port=await listen(server);await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
async function ready(port:number){for(let i=0;i<150;i++){try{if((await fetch(`http://127.0.0.1:${port}/dashboard/app/api/health`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('Dashboard authentication fixture application did not start.');}

test('actual Chromium HTTPS OIDC login, cookies, replay, rotation, expiry and logout', {timeout:120000},async()=>{
 const subject='browser-'+randomUUID(),contexts:BrowserContext[]=[];
 const children:ReturnType<typeof spawn>[]=[];const attemptIds=new Set<string>();
 let browser:Browser|undefined,proxy:https.Server|undefined,fixture:Awaited<ReturnType<typeof startOidcFixture>>|undefined,userId:string|undefined;
 const cert=await readFile(process.env.DASHBOARD_TEST_TLS_CERT!),key=await readFile(process.env.DASHBOARD_TEST_TLS_KEY!);
 const appPort=await freePort();
 let mode='BETA';
 try{
  proxy=https.createServer({cert,key},(req,res)=>{const upstream=http.request({hostname:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode??502,reply.headers);reply.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
  const tlsPort=await listen(proxy),origin=`https://localhost:${tlsPort}`,base=origin+'/dashboard/app',callback=base+'/api/auth/callback';
  fixture=await startOidcFixture({redirectUrl:callback,subject});
  const env:NodeJS.ProcessEnv={...process.env,CHECKPOINT_DISABLE:'1',NEXT_TELEMETRY_DISABLED:'1',DASHBOARD_PUBLIC_ORIGIN:origin,DASHBOARD_OIDC_ISSUER:fixture.issuer,DASHBOARD_OIDC_AUDIENCE:'dashboard-test-client',DASHBOARD_OIDC_CLIENT_ID:'dashboard-test-client',DASHBOARD_OIDC_AUTHORIZATION_URL:fixture.issuer+'/authorize',DASHBOARD_OIDC_TOKEN_URL:fixture.issuer+'/token',DASHBOARD_OIDC_JWKS_URL:fixture.issuer+'/jwks',DASHBOARD_OIDC_REDIRECT_URL:callback,DASHBOARD_SESSION_SECRET:randomBytes(48).toString('hex'),DASHBOARD_WORKER_ENABLED:'false',DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_RELEASE_MODE:mode,DASHBOARD_BETA_WORKSPACE_IDS:''};
  delete env.DASHBOARD_MIGRATION_DATABASE_URL;
  async function start(){const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(appPort)],{env:{...env,DASHBOARD_RELEASE_MODE:mode},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout?.resume();child.stderr?.resume();await ready(appPort);return child;}
  async function stop(child:ReturnType<typeof spawn>){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(child.exitCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
  let app=await start();
  // Node validates TLS through NODE_EXTRA_CA_CERTS. Chromium trusts only this ephemeral
  // fixture public key; ignoreHTTPSErrors remains false (no global TLS bypass).
  const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
  browser=await chromium.launch({headless:true,...(process.env.DASHBOARD_BROWSER_EXECUTABLE?{executablePath:process.env.DASHBOARD_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage',`--ignore-certificate-errors-spki-list=${spki}`]});
  const context=await browser.newContext({ignoreHTTPSErrors:false});contexts.push(context);
  const page=await context.newPage();page.setDefaultTimeout(20000);
  let loginRequests=0;context.on('request',request=>{if(request.url()===base+'/api/auth/login')loginRequests++;});
  async function login(ctx:BrowserContext){
   const p=await ctx.newPage();await p.goto(base+'/api/auth/login');await p.getByRole('heading',{name:'Sign in to test identity'}).waitFor();
   const state=new URL(p.url()).searchParams.get('state')!;attemptIds.add(createHash('sha256').update(state).digest('hex'));
   const pending=(await ctx.cookies()).find(c=>c.name==='__Secure-dashboard-oidc-pending');
   assert.ok(pending?.httpOnly&&pending.secure);assert.equal(pending.path,'/dashboard/app/api/auth');
   await p.getByLabel('Username',{exact:true}).fill('dashboard-test-user');await p.getByLabel('Password',{exact:true}).fill('dashboard-test-password');
   const callbackRequest=p.waitForRequest(r=>r.url().startsWith(callback));
   await p.getByRole('button',{name:'Sign in',exact:true}).click();const request=await callbackRequest;
   await p.waitForURL(base+'/workspaces');await p.getByRole('heading',{name:'Select a business workspace'}).waitFor();
   const cookie=(await ctx.cookies()).find(c=>c.name===DASHBOARD_SESSION_COOKIE);assert.ok(cookie?.httpOnly&&cookie.secure);assert.equal(cookie.path,'/dashboard/app');assert.equal(cookie.sameSite,'Lax');assert.equal(cookie.domain,'localhost');
   assert.ok(!(await ctx.cookies(origin+'/')).some(c=>c.name===DASHBOARD_SESSION_COOKIE),'Dashboard session must not reach website root');
   assert.ok(!(await ctx.cookies(fixture!.issuer)).some(c=>c.name===DASHBOARD_SESSION_COOKIE),'Dashboard session must not reach identity provider');
   assert.ok(!(await ctx.cookies()).some(c=>c.name==='__Secure-dashboard-oidc-pending'));
   const headers=await request.allHeaders();return {p,cookie:cookie!,callbackUrl:request.url(),pending:headers.cookie};
  }
  await page.goto(base+'/workspaces');await page.getByRole('link',{name:'Sign in to Dashboard'}).waitFor();
  const first=await login(context);
  const me=await context.request.get(base+'/api/auth/me');assert.equal(me.status(),200);userId=(await me.json()).userId;
  assert.equal(await db.dashboardMembership.count({where:{userId}}),0,'login must not grant a workspace');
  assert.equal(await db.dashboardSubscription.count({where:{workspace:{memberships:{some:{userId}}}}}),0,'login must not grant a subscription');
  assert.equal((await context.request.get(base+'/api/workspaces')).status(),200);
  assert.equal((await context.request.get(base+'/api/workspaces/foreign-workspace/datasets')).status(),403);
  const isolated=await browser.newContext({ignoreHTTPSErrors:false});contexts.push(isolated);
  // Replay uses the original callback cookie and code, not a fabricated token.
  const replay=await isolated.request.get(first.callbackUrl,{headers:{cookie:first.pending}});assert.equal(replay.status(),401);
  const duplicate=new URL(first.callbackUrl);duplicate.searchParams.append('state','other-state');assert.equal((await isolated.request.get(duplicate.toString(),{headers:{cookie:first.pending}})).status(),401);
  assert.equal((await isolated.request.get(base+'/api/auth/me')).status(),401);
  assert.equal((await context.request.post(base+'/api/auth/refresh',{headers:{origin:'https://untrusted.example'}})).status(),403);
  const rotated=await context.request.post(base+'/api/auth/refresh',{headers:{origin}});assert.equal(rotated.status(),200);
  const newCookie=(await context.cookies()).find(c=>c.name===DASHBOARD_SESSION_COOKIE)!;assert.notEqual(newCookie.value,first.cookie.value);
  assert.equal((await isolated.request.get(base+'/api/auth/me',{headers:{cookie:`${DASHBOARD_SESSION_COOKIE}=${first.cookie.value}`}})).status(),401);
  await login(isolated);assert.equal((await isolated.request.get(base+'/api/auth/me')).status(),200);
  assert.equal((await context.request.post(base+'/api/auth/logout-all',{headers:{origin}})).status(),200);
  assert.equal((await isolated.request.get(base+'/api/auth/me')).status(),401);
  await login(context);
  await db.dashboardSession.updateMany({where:{userId},data:{expiresAt:new Date(Date.now()-1000)}});
  assert.equal((await context.request.get(base+'/api/auth/me')).status(),401);
  await login(context);
  const logout=await context.request.post(base+'/api/auth/logout',{headers:{origin}});assert.equal(logout.status(),200);
  const beforeSignOut=loginRequests;await first.p.goto(base+'/signed-out');await first.p.getByRole('heading',{name:'You are signed out'}).waitFor();assert.equal(loginRequests,beforeSignOut,'signed-out page must not restart login');
  assert.equal((await context.request.get(base+'/api/auth/me')).status(),401);
  // OFF must retain logout and signed-out access while blocking a new login.
  await stop(app);mode='OFF';app=await start();
  assert.equal((await context.request.get(base+'/api/auth/login')).status(),503);
  assert.equal((await context.request.post(base+'/api/auth/logout',{headers:{origin}})).status(),200);
  assert.equal((await context.request.get(base+'/signed-out')).status(),200);
  const check=spawn(process.execPath,['--import','tsx','scripts/check-authentication.mjs'],{env,stdio:['ignore','pipe','pipe']});children.push(check);check.stdout?.resume();check.stderr?.resume();assert.equal(await new Promise(resolve=>check.once('exit',resolve)),0,'discovery/PKCE/session-database readiness');
  console.log('PASS: real browser HTTPS provider login, scoped cookies, callback replay, rotation, revocation, expiry, BETA/OFF logout and discovery checks.');
 }finally{
  if(browser)await browser.close();
  for(const child of children.reverse())if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(proxy){proxy.closeAllConnections();await new Promise<void>(resolve=>proxy!.close(()=>resolve()));}
  if(fixture){await db.dashboardLoginAttempt.deleteMany({where:{id:{in:[...attemptIds]}}});await fixture.close();}
  const user=fixture?await db.dashboardUser.findUnique({where:{externalSubject:fixture.issuer+'|'+subject}}):null;
  if(user)await db.dashboardUser.delete({where:{id:user.id}});
  await db.$disconnect();
 }
});
