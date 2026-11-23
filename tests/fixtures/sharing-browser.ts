import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Page} from 'playwright';
import {dashboardDb as db} from '../../src/server/db';
import {issueDashboardBrowserSession} from '../../src/server/browser-session';
export async function verifySharing(page:Page,origin:string,workspaceId:string,checkAccessibility:(page:Page,phase:string)=>Promise<void>){
 const subject=randomUUID(),issuer='sharing-browser-fixture',user=await db.dashboardUser.create({data:{externalSubject:issuer+'|'+subject}});let context;
 try{
  await db.dashboardMembership.create({data:{workspaceId,userId:user.id,role:'EDITOR'}});
  const token=await issueDashboardBrowserSession({userId:user.id,issuer,subject});context=await page.context().browser()!.newContext({ignoreHTTPSErrors:false,viewport:{width:1280,height:900}});await context.addCookies([{name:'__Secure-averidi-dashboard',value:token,domain:'localhost',path:'/dashboard/app',secure:true,httpOnly:true,sameSite:'Lax'}]);const editor=await context.newPage();editor.setDefaultTimeout(25000);
  await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/dashboard/app/workspaces/'+workspaceId+'/sharing');await page.getByLabel('Dashboard to share',{exact:true}).selectOption({label:'Sales performance'});await page.getByRole('button',{name:'Restrict dashboard access',exact:true}).waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Restrict dashboard access',exact:true}).click();await page.getByRole('button',{name:'Allow all workspace members',exact:true}).waitFor();
  await page.getByLabel('Member',{exact:true}).selectOption(user.id);await page.getByRole('button',{name:'Grant member access',exact:true}).click();await page.getByRole('button',{name:/^Revoke grant /}).waitFor();
  await editor.goto(origin+'/dashboard/app/workspaces/'+workspaceId+'/studio');await editor.getByLabel('Dashboard name',{exact:true}).waitFor();assert.equal(await editor.getByLabel('Dashboard name',{exact:true}).isDisabled(),true);assert.equal(await editor.getByText('Edit pages and widget layout',{exact:true}).count(),0);await checkAccessibility(editor,'shared-dashboard-view-only');
  await page.getByRole('button',{name:/^Revoke grant /}).click();await page.getByText('Sharing settings updated.',{exact:true}).waitFor();await editor.reload();await editor.getByText('No dashboards are available to you in this workspace.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Create share link',exact:true}).click();await page.getByLabel('New share link',{exact:true}).waitFor();const link=await page.getByLabel('New share link',{exact:true}).inputValue();assert.match(link,/#token=[A-Za-z0-9_-]{43}$/);
  await editor.goto(link);await editor.waitForFunction(()=>document.querySelector<HTMLInputElement>('input[autocomplete="off"]')?.value.length===43);assert.equal(new URL(editor.url()).hash,'');await editor.getByRole('button',{name:'Open shared dashboard',exact:true}).click();await editor.getByLabel('Dashboard name',{exact:true}).waitFor();assert.equal(await editor.getByLabel('Dashboard name',{exact:true}).isDisabled(),true);assert.match(editor.url(),/studio\?view=/);
  await checkAccessibility(page,'dashboard-sharing-management');await page.setViewportSize({width:390,height:844});await checkAccessibility(page,'dashboard-sharing-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sharing page overflows mobile viewport');await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:/^Revoke link /}).click();await page.getByText('Sharing settings updated.',{exact:true}).waitFor();await editor.reload();await editor.getByText('No dashboards are available to you in this workspace.',{exact:true}).waitFor();
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Allow all workspace members',exact:true}).click();await page.getByRole('button',{name:'Restrict dashboard access',exact:true}).waitFor();
  console.log('PASS: owner restrictions/direct grants, separate Editor view-only UI, revoked access, fragment-only share link redemption, link revocation, workspace access restoration and sharing accessibility.');
 }finally{if(context)await context.close();await db.dashboardUser.delete({where:{id:user.id}});}
}
