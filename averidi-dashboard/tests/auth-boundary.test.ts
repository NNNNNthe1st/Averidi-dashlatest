import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getAuthenticatedDashboardActor,installDashboardIdentityProvider} from '../src/server/auth-boundary';
import {DASHBOARD_SESSION_COOKIE,extractSingleDashboardCookie} from '../src/server/session-cookie';

test('an invalid or duplicate browser cookie cannot fall through to bearer identity',async()=>{
 let calls=0;
 const actor={userId:'verified-provider-user',issuer:'provider',subject:'subject'};
 installDashboardIdentityProvider({getVerifiedActor:async()=>{calls++;return actor;}});
 for(const cookie of [`${DASHBOARD_SESSION_COOKIE}=bad%20value`,`${DASHBOARD_SESSION_COOKIE}=one; ${DASHBOARD_SESSION_COOKIE}=two`,`${DASHBOARD_SESSION_COOKIE}=`,DASHBOARD_SESSION_COOKIE]){
  assert.equal(await getAuthenticatedDashboardActor(new Request('https://dashboard.example.test',{headers:{cookie,authorization:'Bearer verified'}})),null);
 }
 assert.equal(calls,0);
 assert.deepEqual(await getAuthenticatedDashboardActor(new Request('https://dashboard.example.test',{headers:{authorization:'Bearer verified'}})),actor);
 assert.equal(calls,1);
 const pending='__Secure-dashboard-oidc-pending';
 assert.equal(extractSingleDashboardCookie(new Request('https://dashboard.example.test',{headers:{cookie:`${pending}=first; ${pending}=second`}}),pending),null);
});
