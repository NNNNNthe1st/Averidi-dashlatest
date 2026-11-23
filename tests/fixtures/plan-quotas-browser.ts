import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Page} from 'playwright';
import type {PrismaClient} from '@prisma/client';
export async function verifyPlanQuotas(page:Page,origin:string,workspaceId:string,db:PrismaClient,check:(page:Page,phase:string)=>Promise<void>){
 const root=origin+'/dashboard/app/workspaces/'+workspaceId,api=origin+'/dashboard/app/api/workspaces/'+workspaceId;
 const previous=await db.dashboardSubscription.findUniqueOrThrow({where:{workspaceId}}),count=await db.dashboardDataset.count({where:{workspaceId,status:{not:'ARCHIVED'}}});
 const plan=await db.dashboardBillingPlan.create({data:{code:'QUOTA_'+randomUUID().replaceAll('-','').toUpperCase(),name:'Browser capacity fixture',active:true,entitlements:{dashboardAccess:true,quotas:{datasets:count}}}});
 try{
  await db.dashboardSubscription.update({where:{workspaceId},data:{billingPlanId:plan.id,planCode:plan.code}});
  await page.goto(root+'/usage');await page.getByRole('heading',{name:'Plan usage',exact:true}).waitFor();await page.getByText('Plan: '+plan.code,{exact:true}).waitFor();
  const row=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Active datasets',exact:true})});assert.equal(await row.getByRole('cell').nth(1).innerText(),String(count));assert.equal(await row.getByRole('cell').nth(2).innerText(),'0');
  const denied=await page.evaluate(async url=>{const r=await fetch(url+'/datasets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Exceeds plan'})});return {status:r.status,body:await r.json()};},api);assert.equal(denied.status,409);assert.deepEqual(denied.body,{error:'QUOTA_EXCEEDED',resource:'datasets'});assert.equal(await db.dashboardDataset.count({where:{workspaceId,status:{not:'ARCHIVED'}}}),count);
  await check(page,'plan-usage-desktop');await page.setViewportSize({width:390,height:844});await check(page,'plan-usage-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify(await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main p, main table, main div')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,text:e.textContent?.slice(0,70),width:e.getBoundingClientRect().width}))}))));
  await db.dashboardBillingPlan.update({where:{id:plan.id},data:{entitlements:{dashboardAccess:true,quotas:{datasets:0}}}});await page.reload();await page.getByText(String(count)+' (above current limit)',{exact:true}).waitFor();
  await db.dashboardSubscription.update({where:{workspaceId},data:{currentPeriodEnd:new Date(0)}});await page.reload();await page.getByRole('table').waitFor();assert.equal((await page.evaluate(async url=>(await fetch(url+'/usage')).status,api)),200);
 }finally{await db.dashboardSubscription.update({where:{workspaceId},data:{billingPlanId:previous.billingPlanId,planCode:previous.planCode,currentPeriodEnd:previous.currentPeriodEnd}});await db.dashboardBillingPlan.delete({where:{id:plan.id}});await page.setViewportSize({width:1280,height:900});}
 console.log('PASS: HTTPS plan usage, authoritative capacity rejection, downgrade retention, expiry access and responsive accessibility.');
}
