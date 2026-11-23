import assert from 'node:assert/strict';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {Page} from 'playwright';
import {waitForBrowserJson} from './browser-poll';
export async function verifyVisualReports(page:Page,origin:string,workspaceId:string,check:(page:Page,phase:string)=>Promise<void>){
 const api='/dashboard/app/api/workspaces/'+workspaceId,root=origin+'/dashboard/app/workspaces/'+workspaceId;
 const logo=await sharp({create:{width:16,height:16,channels:4,background:'#176b44'}}).png().toBuffer();
 type Reports={reports:{id:string;name:string;format:string;definition:{branding:{businessName:string;logoDataUrl:string|null}}}[];exports:{id:string;reportId:string;format:string}[]};
 for(const format of ['PDF','PNG'] as const){
  const name='Browser branded '+format;await page.goto(root+'/reports');await page.getByLabel('Report name',{exact:true}).fill(name);await page.getByLabel('Dashboard',{exact:true}).selectOption({label:'Sales performance'});await page.getByLabel('Output format',{exact:true}).selectOption(format);
  await page.getByLabel('Business name',{exact:true}).fill('Example Business');await page.getByLabel('Report subtitle',{exact:true}).fill('Board review');await page.getByLabel('Brand accent color',{exact:true}).fill('#176b44');if(format==='PNG')await page.getByLabel('Include Averidi branding',{exact:true}).uncheck();
  await page.getByLabel('Business logo',{exact:true}).setInputFiles({name:'brand.png',mimeType:'image/png',buffer:logo});await page.getByRole('img',{name:'Business logo preview',exact:true}).waitFor();await check(page,'report-branding-'+format.toLowerCase());
  await page.getByRole('button',{name:'Save report',exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();const saved=await waitForBrowserJson<Reports>(page,api+'/reports',r=>r.reports.some(report=>report.name===name),'Branded report definition'),report=saved.reports.find(r=>r.name===name)!;assert.equal(report.format,format);assert.equal(report.definition.branding.businessName,'Example Business');assert.ok(report.definition.branding.logoDataUrl?.startsWith('data:image/png;base64,'));
  await page.getByRole('button',{name:'Edit '+name,exact:true}).click();assert.equal(await page.getByLabel('Output format',{exact:true}).inputValue(),format);assert.equal(await page.getByLabel('Business name',{exact:true}).inputValue(),'Example Business');assert.equal(await page.getByLabel('Include Averidi branding',{exact:true}).isChecked(),format==='PDF');await page.getByRole('button',{name:'Cancel editing',exact:true}).click();
  await page.getByRole('button',{name:'Generate '+name,exact:true}).click();await waitForBrowserJson<Reports>(page,api+'/reports',r=>r.exports.some(file=>file.reportId===report.id&&file.format===format),'Branded '+format+' generation');await page.getByRole('button',{name:'Refresh reports',exact:true}).click();const link=page.getByRole('link',{name:name+' — '+format,exact:true});await link.waitFor();
  const pending=page.waitForEvent('download');await link.click();const download=await pending;assert.equal(await download.failure(),null);assert.equal(download.suggestedFilename(),'dashboard-report.'+format.toLowerCase());const file=await download.path();assert.ok(file);const bytes=await readFile(file);assert.equal(bytes.subarray(0,5).toString('hex'),format==='PDF'?'255044462d':'89504e470d');if(format==='PNG'){const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,794);assert.ok(metadata.height!>=1123);}
  const dir=path.join(process.cwd(),'.local','visual-report-qa');await mkdir(dir,{recursive:true});await copyFile(file,path.join(dir,'browser-'+format.toLowerCase()+'.'+format.toLowerCase()));
 }
 await page.getByLabel('Report',{exact:true}).selectOption({label:'Browser branded PNG'});await page.getByRole('button',{name:'Schedule report',exact:true}).click();await page.getByText('Report delivery scheduled to your report inbox.',{exact:true}).waitFor();await page.getByRole('button',{name:'Disable schedule',exact:true}).click();await page.getByText('Schedule disabled.',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await check(page,'branded-report-downloads-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Reports overflow mobile viewport');await page.setViewportSize({width:1280,height:900});
 console.log('PASS: real branded PDF/PNG authoring, logo conversion, persisted branding/format, worker generation, actual downloads, scheduled-format selection and three desktop/mobile accessibility scans.');
}
