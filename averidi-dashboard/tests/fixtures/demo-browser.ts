import assert from 'node:assert/strict';
import type {Browser,Page} from 'playwright';
import type {PrismaClient} from '@prisma/client';
import {DEMO_CSV} from '../../src/features/demo/sample';
export async function verifyPublicDemo(browser:Browser,origin:string,db:PrismaClient,check:(page:Page,phase:string)=>Promise<void>){
 const counts=async()=>Promise.all([db.dashboardWorkspace.count(),db.dashboardDataset.count(),db.dashboardUser.count(),db.dashboardJob.count()]);
 const before=await counts(),context=await browser.newContext({ignoreHTTPSErrors:false,viewport:{width:1280,height:900}}),page=await context.newPage(),apiRequests:string[]=[],errors:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname.includes('/api/'))apiRequests.push(request.url());});page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(origin+'/dashboard/app/demo');await page.getByRole('heading',{name:'Explore before uploading a file',exact:true}).waitFor();await page.getByRole('article',{name:'Revenue',exact:true}).getByText('$900.00',{exact:true}).waitFor();await page.getByText('This read-only demo uses eight fictional orders.',{exact:false}).waitFor();assert.equal((await context.cookies()).length,0);await check(page,'public-demo-desktop');
  await page.getByLabel('Sample channel',{exact:true}).selectOption('Web');await page.getByRole('button',{name:'Apply sample filter',exact:true}).click();await page.getByRole('article',{name:'Revenue',exact:true}).getByText('$400.00',{exact:true}).waitFor();await page.getByRole('article',{name:'Revenue',exact:true}).getByText('Previous: $300.00.',{exact:false}).waitFor();
  await page.getByRole('article',{name:'Revenue',exact:true}).getByText('How this is calculated',{exact:true}).click();await page.getByRole('article',{name:'Revenue',exact:true}).getByText('Formula: SUM(net revenue)',{exact:true}).waitFor();
  const pending=page.waitForEvent('download');await page.getByRole('link',{name:'Download sample CSV',exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),'averidi-demo-orders.csv');const stream=await download.createReadStream();assert.ok(stream);let text='';for await(const chunk of stream)text+=chunk.toString();assert.equal(text,DEMO_CSV);
  await page.setViewportSize({width:390,height:844});await check(page,'public-demo-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sample demo has horizontal overflow');
  await page.getByLabel('Sample period',{exact:true}).selectOption('JAN');await page.getByRole('button',{name:'Apply sample filter',exact:true}).click();await page.getByRole('article',{name:'Revenue',exact:true}).getByText('$300.00',{exact:true}).waitFor();assert.equal(await page.getByRole('article',{name:'Revenue',exact:true}).getByText('Previous:',{exact:false}).count(),0);
  await page.goto(origin+'/dashboard/app/demo?channel=foreign_workspace');await page.getByRole('alert').getByText('Unsupported selections have been reset.',{exact:false}).waitFor();await page.getByRole('article',{name:'Revenue',exact:true}).getByText('$900.00',{exact:true}).waitFor();await check(page,'public-demo-invalid-selection');
  assert.deepEqual(apiRequests,[]);assert.deepEqual(errors,[]);assert.deepEqual(await counts(),before);
 }finally{await context.close();}
}
