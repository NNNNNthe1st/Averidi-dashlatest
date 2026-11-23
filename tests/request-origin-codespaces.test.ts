import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardSameOrigin,dashboardPublicOrigin} from '../src/server/request-origin';

test('Codespaces rewritten Origin requires exact development mode, same-origin metadata and public Referer',()=>{
 const saved={...process.env},name='super-duper-funicular-wvxj9449wvpqh57',origin='https://'+name+'-3000.app.github.dev';
 const request=(headers:Record<string,string>={})=>new Request('http://localhost:3000/dashboard/app/api/auth/signup',{method:'POST',headers:{origin:'https://localhost:3000',referer:origin+'/dashboard/app/signup','sec-fetch-site':'same-origin',...headers}});
 const originalError=console.error;console.error=()=>{};
 try{
  Object.assign(process.env,{NODE_ENV:'development',CODESPACES:'true',CODESPACE_NAME:name,GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev',DASHBOARD_DEVELOPMENT_CODESPACES:'true',DASHBOARD_PUBLIC_ORIGIN:origin});
  assert.equal(dashboardSameOrigin(request()),true);
  assert.equal(dashboardSameOrigin(request({origin:'http://localhost:3000'})),true);
  assert.equal(dashboardPublicOrigin(request()),origin); // Email links remain public.
  for(const headers of [
   {origin:'https://evil.example'}, {origin:'https://localhost:3001'},
   {origin:'null'}, {referer:''}, {referer:'https://evil.example/signup'},
   {referer:'https://'+name+'-3001.app.github.dev/signup'},
   {referer:'https://user:password@'+name+'-3000.app.github.dev/signup'},
   {'sec-fetch-site':'cross-site'}, {'sec-fetch-site':'same-site'}, {'sec-fetch-site':''},
  ] as Record<string,string>[])assert.equal(dashboardSameOrigin(request(headers)),false,JSON.stringify(headers));
  for(const [key,value] of Object.entries({NODE_ENV:'production',CODESPACES:'false',CODESPACE_NAME:'other-codespace',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'evil.example',DASHBOARD_DEVELOPMENT_CODESPACES:'false',DASHBOARD_PUBLIC_ORIGIN:'https://www.averidi.com'})){
   const old=process.env[key];process.env[key]=value;assert.equal(dashboardSameOrigin(request()),false,key);process.env[key]=old;
  }
  process.env.DASHBOARD_DEVELOPMENT_CODESPACES='true';
  assert.equal(dashboardSameOrigin(request()),true,'Standalone account mode works without an identity provider');
  Object.assign(process.env,{NODE_ENV:'production'});
  assert.equal(dashboardSameOrigin(request({origin})),true);
  assert.equal(dashboardSameOrigin(request({origin,'sec-fetch-site':'cross-site'})),false);
 }finally{
  console.error=originalError;
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
});
