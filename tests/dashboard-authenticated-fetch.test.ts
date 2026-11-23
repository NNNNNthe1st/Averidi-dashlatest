import {test} from "node:test";
import assert from "node:assert/strict";
import {dashboardAuthenticatedFetch,refreshDashboardSession} from "../src/lib/dashboard-authenticated-fetch";

test("concurrent unauthorized reads share one refresh and retry with updated credentials",async()=>{
 const original=globalThis.fetch;
 let refreshed=false,refreshes=0,reads=0;
 globalThis.fetch=async(input)=>{
  if(String(input).endsWith("/api/auth/refresh")){refreshes++;await new Promise(resolve=>setTimeout(resolve,10));refreshed=true;return new Response("{}",{status:200});}
  reads++;return new Response("{}",{status:refreshed?200:401});
 };
 try{
  const replies=await Promise.all(Array.from({length:5},()=>dashboardAuthenticatedFetch("/datasets")));
  assert.ok(replies.every(reply=>reply.status===200));
  assert.equal(refreshes,1);assert.equal(reads,10);
 }finally{globalThis.fetch=original;}
});
test("unsafe requests are not replayed after refresh",async()=>{
 const original=globalThis.fetch;let writes=0;
 globalThis.fetch=async(input)=>{
  if(String(input).endsWith("/api/auth/refresh"))return new Response("{}",{status:200});
  writes++;return new Response("{}",{status:401});
 };
 try{const reply=await dashboardAuthenticatedFetch("/analysis",{method:"POST",body:"{}"});assert.equal(reply.status,401);assert.equal(writes,1);}
 finally{globalThis.fetch=original;}
});
test("failed refresh preserves original unauthorized response",async()=>{
 const original=globalThis.fetch;let reads=0;
 globalThis.fetch=async(input)=>String(input).endsWith("/api/auth/refresh")?new Response("{}",{status:401}):(reads++,new Response("{}",{status:401}));
 try{assert.equal((await dashboardAuthenticatedFetch("/datasets")).status,401);assert.equal(reads,1);}
 finally{globalThis.fetch=original;}
});

test("XHR recovery shares the same renewal as unauthorized reads without replaying a transfer",async()=>{
 const original=globalThis.fetch;let refreshes=0,ready=false;
 globalThis.fetch=async(input)=>{
  if(String(input).endsWith('/api/auth/refresh')){refreshes++;await new Promise(resolve=>setTimeout(resolve,10));ready=true;return new Response('{}');}
  return new Response('{}',{status:ready?200:401});
 };
 try{
  const [read,xhrRenewal]=await Promise.all([dashboardAuthenticatedFetch('/datasets'),refreshDashboardSession()]);
  assert.equal(read.status,200);assert.equal(xhrRenewal,true);assert.equal(refreshes,1);
 }finally{globalThis.fetch=original;}
});

test("read-only dataset preview retries after a successful session refresh",async()=>{
 const original=globalThis.fetch;let previewCalls=0,refreshes=0;
 globalThis.fetch=async(input)=>{
  const url=String(input);
  if(url.endsWith("/api/auth/refresh")){refreshes++;return new Response("{}",{status:200});}
  if(url.includes("/datasets/preview")){previewCalls++;return new Response("{}",{status:previewCalls===1?401:200});}
  return new Response("{}",{status:200});
 };
 try{
  const reply=await dashboardAuthenticatedFetch("/dashboard/app/api/workspaces/example-workspace/datasets/preview",{
   method:"POST",body:new FormData(),
  });
  assert.equal(reply.status,200);
  assert.equal(previewCalls,2);
  assert.equal(refreshes,1);
 }finally{globalThis.fetch=original;}
});

test("refresh reuses a session refreshed by another tab while waiting for the lock",async()=>{
 const original=globalThis.fetch;
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,"navigator");
 let refreshes=0,identityChecks=0;
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{
  locks:{request:async(_name:string,callback:()=>Promise<boolean>)=>callback()},
 }});
 globalThis.fetch=async(input)=>{
  if(String(input).endsWith("/api/auth/me")){identityChecks++;return new Response('{"authenticated":true}',{status:200});}
  if(String(input).endsWith("/api/auth/refresh")){refreshes++;return new Response("{}",{status:200});}
  return new Response("{}",{status:404});
 };
 try{
  assert.equal(await refreshDashboardSession(),true);
  assert.equal(identityChecks,1);
  assert.equal(refreshes,0);
 }finally{
  globalThis.fetch=original;
  if(originalNavigator)Object.defineProperty(globalThis,"navigator",originalNavigator);
  else delete (globalThis as {navigator?:Navigator}).navigator;
 }
});
