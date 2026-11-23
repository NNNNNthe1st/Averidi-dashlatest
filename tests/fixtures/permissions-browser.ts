import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Browser,BrowserContext,Page} from 'playwright';
import type {PrismaClient} from '@prisma/client';
import {issueDashboardBrowserSession} from '../../src/server/browser-session';
export async function verifyCustomPermissions(page:Page,browser:Browser,origin:string,workspaceId:string,db:PrismaClient,check:(page:Page,phase:string)=>Promise<void>){
 const request=async(target:Page,url:string,method='GET',body?:unknown)=>target.evaluate(async({url,method,body})=>(await fetch(url,{method,credentials:'same-origin',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})).status,{url,method,body});
 const tag=randomUUID(),issuer='permissions-browser-fixture',subject=tag,user=await db.dashboardUser.create({data:{externalSubject:issuer+'|'+subject}});let context:BrowserContext|undefined;
 try{
  await db.dashboardMembership.create({data:{workspaceId,userId:user.id,role:'EDITOR'}});
  const root=origin+'/dashboard/app/workspaces/'+workspaceId,api=origin+'/dashboard/app/api/workspaces/'+workspaceId,name='Browser job reader '+tag.slice(0,6);
  await page.goto(root+'/roles');await page.getByRole('heading',{name:'Create a custom role',exact:true}).waitFor();await page.getByLabel('Role name',{exact:true}).fill(name);await page.getByLabel('Inspect background jobs (Any built-in role)',{exact:true}).check();await page.getByRole('button',{name:'Create custom role',exact:true}).click();await page.getByRole('button',{name:'Edit '+name,exact:true}).waitFor();
  const role=await db.dashboardWorkspaceRole.findFirstOrThrow({where:{workspaceId,name}});page.once('dialog',d=>d.accept());await page.getByLabel('Custom role for '+user.id,{exact:true}).selectOption(role.id);
  await page.waitForFunction(({id,role})=>(document.querySelector('select[aria-label="Custom role for '+id+'"]') as HTMLSelectElement|null)?.value===role,{id:user.id,role:role.id});
  // Wait for server persistence, rather than relying on the optimistic select value.
  for(let i=0;i<100;i++){if(await db.dashboardPermissionGrant.count({where:{workspaceId,userId:user.id,roleId:role.id,membershipId:{not:null}}}))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await db.dashboardPermissionGrant.count({where:{workspaceId,userId:user.id,roleId:role.id,membershipId:{not:null}}}),1);
  await check(page,'owner custom role administration desktop');await page.setViewportSize({width:390,height:844});await check(page,'owner custom role administration mobile');await page.setViewportSize({width:1280,height:900});
  const token=await issueDashboardBrowserSession({userId:user.id,issuer,subject});context=await browser.newContext({ignoreHTTPSErrors:false,viewport:{width:1280,height:900}});await context.addCookies([{name:'__Secure-averidi-dashboard',value:token,domain:'localhost',path:'/dashboard/app',secure:true,httpOnly:true,sameSite:'Lax'}]);const member=await context.newPage();member.setDefaultTimeout(25000);
  await member.goto(root+'/jobs');await member.getByRole('heading',{name:'Jobs and schedules',exact:true}).waitFor();assert.equal(await member.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:'Data',exact:true}).count(),0);assert.equal(await member.getByRole('button',{name:'Schedule refresh',exact:true}).isDisabled(),true);
  assert.equal(await request(member,api+'/datasets'),403);assert.equal(await request(member,api+'/datasets','POST',{name:'Forbidden browser dataset'}),403);assert.equal(await request(member,api+'/roles'),403);
  await check(member,'custom role jobs reader desktop');await member.setViewportSize({width:390,height:844});await check(member,'custom role jobs reader mobile');await member.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Edit '+name,exact:true}).click();await page.getByLabel('Read dashboards and saved filters (Any built-in role)',{exact:true}).check();await page.getByLabel('Read connection status and configuration (Any built-in role)',{exact:true}).check();await page.getByRole('button',{name:'Save custom role',exact:true}).click();await page.getByRole('button',{name:'Edit '+name,exact:true}).waitFor();
  for(let i=0;i<100;i++){if((await db.dashboardWorkspaceRole.findUniqueOrThrow({where:{id:role.id}})).permissions.includes('views.read'))break;await new Promise(r=>setTimeout(r,100));}
  await member.goto(root+'/studio');await member.getByRole('heading',{name:'Dashboard Studio',exact:true}).waitFor();await member.getByRole('button',{name:'Download metric report',exact:true}).waitFor();assert.equal(await member.getByRole('button',{name:'Download metric report',exact:true}).isDisabled(),true);assert.equal(await request(member,api+'/views'),200);assert.equal(await request(member,api+'/views/generate','POST',{}),403);
  await check(member,'custom role read-only Studio');
  await member.goto(root+'/connectors');await member.getByRole('heading',{name:'Data connections',exact:true}).waitFor();assert.equal(await member.getByRole('button',{name:'Create connection',exact:true}).isDisabled(),true);assert.equal(await request(member,api+'/connectors','POST',{}),403);await check(member,'custom role read-only connections');
  await member.goto(root+'/metrics');await member.getByRole('heading',{name:'Custom metrics',exact:true}).waitFor();assert.equal(await member.getByRole('button',{name:'Save custom metric',exact:true}).isDisabled(),true);await check(member,'custom role read-only formula metrics');
  page.once('dialog',d=>d.accept());await page.getByLabel('Custom role for '+user.id,{exact:true}).selectOption('');for(let i=0;i<100;i++){if(!await db.dashboardPermissionGrant.count({where:{workspaceId,userId:user.id,membershipId:{not:null}}}))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await request(member,api+'/datasets'),200);
  const restoredName='Restored permission fixture '+tag;assert.equal(await request(member,api+'/datasets','POST',{name:restoredName}),201);await db.dashboardDataset.deleteMany({where:{workspaceId,name:restoredName}});
  const refreshed=await db.dashboardWorkspaceRole.findUniqueOrThrow({where:{id:role.id}});const result=await request(page,api+'/roles','POST',{action:'DELETE',id:role.id,expectedUpdatedAt:refreshed.updatedAt.toISOString()});assert.equal(result,200);
  console.log('PASS: owner custom role create/edit/assign/unassign/delete; direct API denial and base-role restoration; limited member navigation/read-only controls; seven custom-permission accessibility scans.');
 }finally{if(context)await context.close();await db.dashboardMembership.deleteMany({where:{workspaceId,userId:user.id}});await db.dashboardUser.delete({where:{id:user.id}});await db.dashboardWorkspaceRole.deleteMany({where:{workspaceId,name:{contains:tag.slice(0,6)}}});}
}
