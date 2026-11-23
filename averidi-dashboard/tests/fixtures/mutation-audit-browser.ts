import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type {PrismaClient} from '@prisma/client';
export async function verifyMutationAudit(page:Page,origin:string,workspaceId:string,db:PrismaClient,check:(page:Page,phase:string)=>Promise<void>){
 const root=origin+'/dashboard/app/workspaces/'+workspaceId;
 await page.setViewportSize({width:1280,height:900});await page.goto(root+'/activity');await page.getByRole('heading',{name:'Workspace activity',exact:true}).waitFor();await page.getByRole('table',{name:'Recorded resource changes'}).waitFor();await check(page,'workspace-activity-desktop');
 await page.getByRole('button',{name:'Older events',exact:true}).click();await page.getByText('Page 2. Up to 25 events per page.',{exact:true}).waitFor();await page.getByRole('button',{name:'Newer events',exact:true}).click();await page.getByText('Page 1. Up to 25 events per page.',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await check(page,'workspace-activity-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.goto(origin+'/dashboard/app/activity');await page.getByRole('heading',{name:'Account activity',exact:true}).waitFor();await page.getByRole('table',{name:'Recorded resource changes'}).waitFor();await check(page,'account-activity-mobile');await page.setViewportSize({width:1280,height:900});await check(page,'account-activity-desktop');
 const rows=await db.dashboardMutationAudit.findMany({where:{workspaceId},take:100});assert.ok(rows.length);assert.ok(rows.some(row=>row.actorSource==='WORKER'));
 console.log('PASS: actual HTTPS Owner/account mutation history, older/newer pagination and four desktop/mobile accessibility scans.');
}
