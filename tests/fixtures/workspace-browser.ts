import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import {waitForBrowserJson} from './browser-poll';
import {verifyWorkspacePresentation} from './presentation-browser';

/** Exercises real customer pages against the existing isolated BI fixture. */
export async function verifyWorkspacePages(page:Page,origin:string,workspaceId:string,checkAccessibility:(page:Page,phase:string)=>Promise<void>){
 const base=origin+'/dashboard/app',workspace=base+'/workspaces/'+workspaceId;
 await page.setViewportSize({width:1280,height:900});
 async function follow(name:string,menu?:string){const nav=page.getByRole('navigation',{name:'Workspace navigation'}),link=nav.getByRole('link',{name,exact:true});if(menu&&!await link.isVisible())await nav.getByText(menu,{exact:true}).click();await link.click();}
 await page.goto(base);await page.getByRole('heading',{name:'Business overview',exact:true}).waitFor();const saved=page.getByRole('region',{name:'Saved dashboards',exact:true});const opened=saved.getByRole('link',{name:'Open dashboard',exact:true}).first();assert.ok((await opened.getAttribute('href'))?.startsWith('/dashboard/app/workspaces/'+workspaceId+'/studio?view='));assert.ok(!(await opened.getAttribute('href'))?.includes('/dashboard/app/dashboard/app'));await opened.click();await page.getByRole('region',{name:'Dashboard results',exact:true}).waitFor();
 await page.goto(base+'/studio');await page.getByRole('heading',{name:'Business overview',exact:true}).waitFor();await page.goto(base+'/workspaces?choose=1');await page.getByRole('heading',{name:'Select a business workspace',exact:true}).waitFor();
 await page.goto(workspace+'/settings');await page.getByLabel('New workspace name',{exact:true}).fill('Updated browser workspace');await page.getByRole('button',{name:'Save workspace name',exact:true}).click();await page.getByText('Workspace name updated.',{exact:true}).waitFor();
 await verifyWorkspacePresentation(page,workspace,checkAccessibility);
 await checkAccessibility(page,'workspace-settings');
 await follow('Support','Account');await page.getByLabel('Subject',{exact:true}).fill('Browser support request');await page.getByLabel('Message',{exact:true}).fill('Please help with this Dashboard workspace.');await page.getByRole('button',{name:'Send support request',exact:true}).click();await page.getByRole('heading',{name:'Browser support request',exact:true}).waitFor();await checkAccessibility(page,'workspace-support');
 await follow('Billing','More tools and settings');await page.getByText('STARTER',{exact:true}).waitFor();await page.getByText('No invoices are available.',{exact:true}).waitFor();await checkAccessibility(page,'workspace-billing');
 await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:'Reports',exact:true}).click();await page.getByLabel('Report name',{exact:true}).fill('Browser CSV report');await page.getByLabel('Dashboard',{exact:true}).selectOption({label:'Sales performance'});await page.getByRole('button',{name:'Save report',exact:true}).click();await page.getByRole('heading',{name:'Browser CSV report',exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit Browser CSV report',exact:true}).click();await page.getByLabel('Report name',{exact:true}).fill('Updated CSV report');await page.getByRole('button',{name:'Save report',exact:true}).click();await page.getByRole('heading',{name:'Updated CSV report',exact:true}).waitFor();
 await page.getByRole('button',{name:'Generate Updated CSV report',exact:true}).click();
 await waitForBrowserJson<{exports:unknown[]}>(page,'/dashboard/app/api/workspaces/'+workspaceId+'/reports',value=>value.exports.length>0,'Report generation');
 await page.getByRole('button',{name:'Refresh reports',exact:true}).click();await page.getByRole('link',{name:'Updated CSV report — CSV',exact:true}).waitFor();
 const pending=page.waitForEvent('download');await page.getByRole('link',{name:'Updated CSV report — CSV',exact:true}).click();const downloaded=await pending;assert.equal(await downloaded.failure(),null);
 await page.getByLabel('Report',{exact:true}).selectOption({label:'Updated CSV report'});await page.getByRole('button',{name:'Schedule report',exact:true}).click();await page.getByText('Report delivery scheduled to your report inbox.',{exact:true}).waitFor();await page.getByRole('button',{name:'Disable schedule',exact:true}).click();await page.getByText('Schedule disabled.',{exact:true}).waitFor();
 await checkAccessibility(page,'workspace-reports');
 await follow('Jobs and schedules','More tools and settings');await page.getByRole('heading',{name:'Jobs and schedules',exact:true}).waitFor();await page.getByRole('heading',{name:'REPORT GENERATE',exact:true}).waitFor();await checkAccessibility(page,'workspace-jobs');
 await follow('Connections','More tools and settings');await page.getByLabel('Connection name',{exact:true}).fill('Browser sheet');await page.getByLabel('Spreadsheet ID',{exact:true}).fill('abcdefghijklmnop');await page.getByLabel('Range',{exact:true}).fill('Sheet1!A1:Z100');await page.getByRole('button',{name:'Create connection',exact:true}).click();await page.getByRole('alert').getByText('This connection is not available in this environment.',{exact:true}).waitFor();await checkAccessibility(page,'workspace-connections');
 await page.setViewportSize({width:390,height:844});await checkAccessibility(page,'workspace-connections-mobile');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Workspace page overflows the mobile viewport');
 console.log('PASS: application entry, workspace settings, support, billing, report authoring, report generation/download, schedules, jobs and inactive connector setup.');
}
