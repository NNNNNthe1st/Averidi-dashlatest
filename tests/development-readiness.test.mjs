import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readyDevelopmentRuntime,developmentFailureCategory} from '../scripts/development/ready.mjs';
const settings=port=>({databaseUrl:'postgresql://dashboard_development_runtime:fixture-only@127.0.0.1:'+port+'/dashboard_dev?schema=public',sessionSecret:'a'.repeat(96),connectorKey:'b'.repeat(64)});
test('healthy development database starts without provisioning or inherited privileged credentials',async()=>{
 let setups=0;
 const env=await readyDevelopmentRuntime('/tmp/dashboard',{read:async()=>settings(5434),probe:async(root,env)=>{assert.equal(env.DASHBOARD_MIGRATION_DATABASE_URL,'');return {ok:true};},setup:async()=>{setups++;},source:{DASHBOARD_MIGRATION_DATABASE_URL:'foreign-owner',DASHBOARD_RELEASE_MODE:'GENERAL'},log:()=>{}});
 assert.equal(setups,0);assert.equal(env.DASHBOARD_DATABASE_URL,settings(5434).databaseUrl);assert.equal(env.DASHBOARD_RELEASE_MODE,'OFF');
});
test('failed connection recovers once and reloads a changed published port',async()=>{
 let reads=0,setups=0,probes=0;
 const env=await readyDevelopmentRuntime('/tmp/dashboard',{read:async()=>settings(++reads===1?32768:32769),probe:async(root,env)=>{probes++;if(probes===1)return {ok:false,category:'DATABASE_UNAVAILABLE'};assert.ok(env.DASHBOARD_DATABASE_URL.includes(':32769/'));return {ok:true};},setup:async()=>{setups++;},log:()=>{}});
 assert.equal(reads,2);assert.equal(setups,1);assert.equal(probes,2);assert.ok(env.DASHBOARD_DATABASE_URL.includes(':32769/'));
});
test('failed recovery stops before web/worker startup; unsafe identities never trigger setup',async()=>{
 let setups=0;
 await assert.rejects(readyDevelopmentRuntime('/tmp/dashboard',{read:async()=>settings(5434),probe:async()=>({ok:false,category:'DATABASE_UNAVAILABLE'}),setup:async()=>{setups++;},log:()=>{}}),/still not ready/);
 assert.equal(setups,1);
 await assert.rejects(readyDevelopmentRuntime('/tmp/dashboard',{read:async()=>settings(5434),probe:async()=>({ok:false,category:'DATABASE_IDENTITY_MISMATCH'}),setup:async()=>{setups++;},log:()=>{}}),/IDENTITY_MISMATCH/);
 assert.equal(setups,1);
 await assert.rejects(readyDevelopmentRuntime('/tmp/dashboard',{read:async()=>({...settings(5434),databaseUrl:settings(5434).databaseUrl.replace('127.0.0.1','production.invalid')}),probe:async()=>{throw Error('Must not probe foreign databases');},log:()=>{}}),/isolated development database/);
});
test('initialization errors without Prisma codes are classified without exposing credentials',()=>{
 assert.equal(developmentFailureCategory({name:'PrismaClientInitializationError',message:"Can't reach database server at loopback"}),'DATABASE_UNAVAILABLE');
 assert.equal(developmentFailureCategory({code:'P2010',meta:{code:'42501'}}),'DATABASE_PERMISSIONS_MISSING');
 assert.equal(developmentFailureCategory({code:'P2021'}),'DATABASE_SCHEMA_NOT_CURRENT');
 assert.equal(developmentFailureCategory({code:'P1000'}),'DATABASE_CREDENTIALS_REJECTED');
 assert.equal(developmentFailureCategory({message:'private-secret-detail'}),'DATABASE_CHECK_FAILED');
});
