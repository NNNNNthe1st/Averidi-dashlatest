import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb} from '../src/server/db';
import {beginDashboardLogin,completeDashboardLogin} from '../src/server/oidc-browser';
import {issueDashboardBrowserSession,verifyDashboardBrowserSession,rotateDashboardBrowserSession,revokeAllDashboardSessions,cleanupDashboardAuthentication} from '../src/server/browser-session';
import {dashboardSameOrigin} from '../src/server/request-origin';
import {startOidcFixture} from './fixtures/oidc-provider';

test('HTTPS OIDC PKCE, single-use state, signed identity and session lifecycle',async()=>{
 const fixture=await startOidcFixture();
 const original={...process.env};
 const configured={DASHBOARD_OIDC_ISSUER:fixture.issuer,DASHBOARD_OIDC_JWKS_URL:fixture.issuer+'/jwks',DASHBOARD_OIDC_CLIENT_ID:'dashboard-test-client',DASHBOARD_OIDC_AUTHORIZATION_URL:fixture.issuer+'/authorize',DASHBOARD_OIDC_TOKEN_URL:fixture.issuer+'/token',DASHBOARD_OIDC_REDIRECT_URL:'https://dashboard.example.test/dashboard/app/api/auth/callback',DASHBOARD_SESSION_SECRET:'test-only-session-secret-'.repeat(3),DASHBOARD_SESSION_VERSION:'test'};
 Object.assign(process.env,configured);
 let userId='';const attemptIds:string[]=[];
 async function login(){const started=await beginDashboardLogin();const code=await (await fetch(started.url)).json();attemptIds.push(createHash("sha256").update(code.state).digest("hex"));return {...started,...code};}
 try{
  const first=await login();
  assert.equal(new URL(first.url).searchParams.get('code_challenge_method'),'S256');
  assert.equal(await completeDashboardLogin('wrong-state',first.code,first.pending),null);
  assert.equal(await completeDashboardLogin(first.state,first.code,first.pending+'tampered'),null);
  const identity=await completeDashboardLogin(first.state,first.code,first.pending);
  assert.deepEqual(identity,{issuer:fixture.issuer,subject:'external-person'});
  assert.equal(await completeDashboardLogin(first.state,first.code,first.pending),null);
  for(const mode of ['wrong-nonce','wrong-audience','wrong-issuer','expired','wrong-azp','wrong-signature','oversized','invalid-json','empty-subject'] as const){
   fixture.setMode(mode);const attempt=await login();
   let rejected=false;try{rejected=await completeDashboardLogin(attempt.state,attempt.code,attempt.pending)===null;}catch{rejected=true;}
   assert.equal(rejected,true,mode);
  }
  fixture.setMode('valid');
  const raced=await login();
  const identities=await Promise.all([completeDashboardLogin(raced.state,raced.code,raced.pending),completeDashboardLogin(raced.state,raced.code,raced.pending)]);
  assert.equal(identities.filter(Boolean).length,1,'one concurrent callback may consume an attempt');
  const timedOut=await login();
  await dashboardDb.dashboardLoginAttempt.update({where:{id:createHash('sha256').update(timedOut.state).digest('hex')},data:{expiresAt:new Date(Date.now()-1000)}});
  assert.equal(await completeDashboardLogin(timedOut.state,timedOut.code,timedOut.pending),null);
  const user=await dashboardDb.dashboardUser.create({data:{externalSubject:identity!.issuer+'|'+identity!.subject}});userId=user.id;
  const actor={userId,...identity!};
  const token=await issueDashboardBrowserSession(actor);
  assert.deepEqual(await verifyDashboardBrowserSession(token),actor);
  const rotations=await Promise.all([rotateDashboardBrowserSession(token),rotateDashboardBrowserSession(token)]);
  assert.equal(rotations.filter(Boolean).length,1);
  assert.equal(await verifyDashboardBrowserSession(token),null);
  const rotated=rotations.find(Boolean)!;
  assert.deepEqual(await verifyDashboardBrowserSession(rotated),actor);
  await revokeAllDashboardSessions(actor);
  assert.equal(await verifyDashboardBrowserSession(rotated),null);
  const expired=await issueDashboardBrowserSession(actor);
  await dashboardDb.dashboardSession.updateMany({where:{userId},data:{expiresAt:new Date(Date.now()-2*86400_000)}});
  assert.equal(await verifyDashboardBrowserSession(expired),null);
  assert.ok((await cleanupDashboardAuthentication()).sessions>=1);
  assert.equal(dashboardSameOrigin(new Request('https://dashboard.example.test/api',{method:'POST',headers:{origin:'https://evil.test'}})),false);
  assert.equal(dashboardSameOrigin(new Request('https://dashboard.example.test/api',{method:'POST',headers:{origin:'https://dashboard.example.test'}})),true);
 }finally{
  if(userId)await dashboardDb.dashboardUser.delete({where:{id:userId}});
  await dashboardDb.dashboardLoginAttempt.deleteMany({where:{id:{in:attemptIds}}});
  for(const key of Object.keys(configured))if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];
  await fixture.close();
 }
});
