import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash,X509Certificate} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import * as dbModule from '../src/server/db.ts';
import * as sessionModule from '../src/server/browser-session.ts';
import {verificationDatabases} from './verification/contracts.mjs';
verificationDatabases(process.env.DASHBOARD_DATABASE_URL,process.env.DASHBOARD_MIGRATION_DATABASE_URL);
const {dashboardDb:db}=dbModule.default??dbModule,{issueDashboardBrowserSession}=sessionModule.default??sessionModule;
const root=await mkdtemp(path.join(tmpdir(),'dashboard-customer-billing-')),savedSecret=process.env.DASHBOARD_SESSION_SECRET;
let browser,proxy,provider,app,workspace,user,plan,checkout,appOutput='';const scans=[];
const tag=randomUUID().replaceAll('-',''),price='price_'+tag,customer='cus_'+tag,subscriptionId='sub_'+tag,now=Math.floor(Date.now()/1000);
let status='incomplete',cancel=false,portalRequests=0;
const subscription=()=>({id:subscriptionId,object:'subscription',customer,livemode:false,status,cancel_at_period_end:cancel,pause_collection:null,items:{has_more:false,data:[{quantity:1,current_period_start:now-60,current_period_end:now+86400,price:{id:price,currency:'usd',unit_amount:2500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]},latest_invoice:null});
function listen(s){return new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>resolve(s.address().port));});}
async function poll(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Billing fixture condition timed out');}
async function a11y(page,phase){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();scans.push({phase,violations:result.violations});assert.deepEqual(result.violations,[],phase+' WCAG violations');}
try{
 const issuer='dashboard-customer-billing-fixture',subject=tag;
 user=await db.dashboardUser.create({data:{externalSubject:issuer+'|'+subject}});workspace=await db.dashboardWorkspace.create({data:{name:'Subscription purchase fixture'}});
 await db.dashboardMembership.create({data:{userId:user.id,workspaceId:workspace.id,role:'OWNER'}});
 plan=await db.dashboardBillingPlan.create({data:{code:'BROWSER_'+tag.toUpperCase().slice(0,24),name:'Browser fixture plan',active:true,entitlements:{dashboardAccess:true},externalPriceId:price,currency:'USD',amountMinor:2500,billingInterval:'month'}});
 process.env.DASHBOARD_SESSION_SECRET=randomBytes(48).toString('hex');const token=await issueDashboardBrowserSession({userId:user.id,issuer,subject});
 const cert=path.join(root,'cert.pem'),key=path.join(root,'key.pem');assert.equal(spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'}).status,0);
 const tls={key:await readFile(key),cert:await readFile(cert)};
 provider=https.createServer(tls,async(req,res)=>{try{
  res.setHeader('content-type','application/json');assert.equal(req.headers.authorization,'Bearer sk_test_customerBrowserFixture123');assert.equal(req.headers['stripe-version'],'2025-06-30.basil');assert.equal(req.headers['stripe-account'],undefined);
  const parts=[];for await(const p of req)parts.push(p);const fields=Object.fromEntries(new URLSearchParams(Buffer.concat(parts).toString()));let result;
  if(req.url==='/v1/prices/'+price)result={id:price,object:'price',active:true,livemode:false,currency:'usd',unit_amount:2500,billing_scheme:'per_unit',type:'recurring',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}};
  else if(req.url==='/v1/checkout/sessions'&&req.method==='POST'){
   assert.match(req.headers['idempotency-key'],/^dashboard-checkout:/);result=checkout={id:'cs_test_'+tag,object:'checkout.session',livemode:false,mode:'subscription',status:'open',client_reference_id:fields.client_reference_id,metadata:{dashboardProduct:fields['metadata[dashboardProduct]'],dashboardCheckoutAttemptId:fields['metadata[dashboardCheckoutAttemptId]']},customer:null,subscription:null,expires_at:Number(fields.expires_at),success_url:fields.success_url,cancel_url:fields.cancel_url,url:'https://checkout.stripe.com/c/pay/'+tag,line_items:{has_more:false,data:[{quantity:1,price:{id:fields['line_items[0][price]']}}]}};
  }else if(req.url.startsWith('/v1/checkout/sessions/cs_test_'))result=checkout;
  else if(req.url==='/v1/subscriptions/'+subscriptionId)result=subscription();
  else if(req.url==='/v1/billing_portal/configurations/bpc_fixture')result={id:'bpc_fixture',object:'billing_portal.configuration',active:true,livemode:false,application:null,features:{payment_method_update:{enabled:true},invoice_history:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:true,default_allowed_updates:['price'],proration_behavior:'none',products:[{product:'prod_fixture',prices:[price]}]}}};
  else if(req.url==='/v1/billing_portal/sessions'){assert.equal(fields.customer,customer);assert.equal(fields.configuration,'bpc_fixture');portalRequests++;result={id:'bps_fixture',object:'billing_portal.session',customer,configuration:'bpc_fixture',livemode:false,return_url:fields.return_url,url:'https://billing.stripe.com/p/session/'+tag};}
  else throw Error('Unexpected provider request '+req.url);
  res.end(JSON.stringify(result));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}});
 const providerPort=await listen(provider),probe=http.createServer(),appPort=await listen(probe);await new Promise(r=>probe.close(r));
 proxy=https.createServer(tls,(req,res)=>{const up=http.request({hostname:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode??502,reply.headers);reply.pipe(res);});up.on('error',()=>{res.writeHead(502);res.end();});req.pipe(up);});
 const origin='https://localhost:'+await listen(proxy),billing=origin+'/dashboard/app/workspaces/'+workspace.id+'/billing';
 // Test-only preload redirects the fixed provider endpoint to a verified local HTTPS fixture.
 const preload=path.join(root,'provider.mjs');await writeFile(preload,`const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=String(input);return original(u.startsWith('https://api.stripe.com/v1/')?'https://127.0.0.1:${providerPort}'+new URL(u).pathname+new URL(u).search:input,init);};`);
 const env={...process.env,NODE_EXTRA_CA_CERTS:cert,NEXT_TELEMETRY_DISABLED:'1',DASHBOARD_PUBLIC_ORIGIN:origin,DASHBOARD_RELEASE_MODE:'BETA',DASHBOARD_BETA_WORKSPACE_IDS:workspace.id,DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED:'false',DASHBOARD_BILLING_ENABLED:'true',DASHBOARD_BILLING_SELF_SERVICE_ENABLED:'true',DASHBOARD_BILLING_STRIPE_MODE:'test',DASHBOARD_BILLING_STRIPE_SECRET_KEY:'sk_test_customerBrowserFixture123',DASHBOARD_BILLING_STRIPE_WEBHOOK_SECRET:'whsec_customerBrowserFixture123456',DASHBOARD_BILLING_PORTAL_CONFIGURATION:'bpc_fixture',DASHBOARD_MIGRATION_DATABASE_URL:''};
 app=spawn(process.execPath,['--import',preload,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(appPort)],{env,stdio:['ignore','pipe','pipe']});app.stdout.on('data',d=>{appOutput+=d});app.stderr.on('data',d=>{appOutput+=d});
 await poll(async()=>{try{return (await fetch('http://127.0.0.1:'+appPort+'/dashboard/app/api/health')).ok;}catch{return false;}});
 const spki=createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
 browser=await chromium.launch({headless:true,args:['--ignore-certificate-errors-spki-list='+spki,'--no-sandbox','--disable-dev-shm-usage'],...(process.env.DASHBOARD_BROWSER_EXECUTABLE?{executablePath:process.env.DASHBOARD_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({ignoreHTTPSErrors:false,viewport:{width:1280,height:900}});await context.addCookies([{name:'__Secure-averidi-dashboard',value:token,domain:'localhost',path:'/dashboard/app',secure:true,httpOnly:true,sameSite:'Lax'}]);
 await context.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Fixture hosted checkout</h1>'}));await context.route('https://billing.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Fixture hosted billing</h1>'}));
 const page=await context.newPage();page.setDefaultTimeout(20000);await page.goto(billing);await page.getByRole('button',{name:'Continue to secure checkout — Browser fixture plan',exact:true}).waitFor();await a11y(page,'available plans desktop');await page.setViewportSize({width:390,height:844});await a11y(page,'available plans mobile');
 await page.getByRole('button',{name:'Continue to secure checkout — Browser fixture plan',exact:true}).click();await page.waitForURL('https://checkout.stripe.com/**');assert.equal(await db.dashboardSubscription.count({where:{workspaceId:workspace.id}}),0);
 await page.goto(billing+'?checkout=returned');await page.getByRole('button',{name:'Resume secure checkout',exact:true}).waitFor();await a11y(page,'pending checkout mobile');assert.equal(await db.dashboardSubscription.count({where:{workspaceId:workspace.id}}),0);
 checkout.status='complete';checkout.customer=customer;checkout.subscription=subscriptionId;status='active';
 await page.getByRole('button',{name:'Refresh billing status',exact:true}).click();await page.getByRole('button',{name:'Manage plan, cancellation and payment methods',exact:true}).waitFor();await poll(async()=> (await db.dashboardSubscription.findUnique({where:{workspaceId:workspace.id}}))?.status==='ACTIVE');
 await page.getByRole('button',{name:'Manage plan, cancellation and payment methods',exact:true}).click();await page.waitForURL('https://billing.stripe.com/**');assert.equal(portalRequests,1);
 cancel=true;await page.goto(billing);await page.getByRole('button',{name:'Refresh billing status',exact:true}).click();await page.getByText('Scheduled',{exact:true}).waitFor();await a11y(page,'scheduled cancellation mobile');
 status='canceled';await page.getByRole('button',{name:'Refresh billing status',exact:true}).click();await page.getByRole('button',{name:'Continue to secure checkout — Browser fixture plan',exact:true}).waitFor();await page.setViewportSize({width:1280,height:900});await a11y(page,'canceled subscription desktop');
 console.log('PASS: production HTTPS checkout, no access from redirect, provider-confirmed activation, owner portal, scheduled/terminal cancellation, five desktop/mobile accessibility scans.');
 if(process.env.DASHBOARD_BILLING_A11Y_REPORT)await writeFile(process.env.DASHBOARD_BILLING_A11Y_REPORT,JSON.stringify({scans},null,2)+'\n');
}catch(error){throw Error(String(error)+'\n'+appOutput);}finally{
 if(browser)await browser.close();if(app){app.kill('SIGTERM');await Promise.race([new Promise(r=>app.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(app.exitCode===null)app.kill('SIGKILL');}
 for(const server of [proxy,provider])if(server)await new Promise(r=>server.close(r));
 if(workspace)await db.dashboardWorkspace.delete({where:{id:workspace.id}});if(user)await db.dashboardUser.delete({where:{id:user.id}});if(plan)await db.dashboardBillingPlan.delete({where:{id:plan.id}});await db.$disconnect();
 if(savedSecret===undefined)delete process.env.DASHBOARD_SESSION_SECRET;else process.env.DASHBOARD_SESSION_SECRET=savedSecret;await rm(root,{recursive:true,force:true});
}
