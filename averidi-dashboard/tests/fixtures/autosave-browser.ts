import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import {waitForBrowserJson} from './browser-poll';
export async function verifyAutosave(page:Page,workspaceId:string,check:(page:Page,phase:string)=>Promise<void>){
 const root='/dashboard/app/api/workspaces/'+workspaceId,editor=page.getByRole('region',{name:'Dashboard editor',exact:true}),name=editor.getByLabel('Dashboard name',{exact:true}),original=await name.inputValue();
 type Views={views:{id:string;definition:{name:string}}[]};
 const list=await page.evaluate(async url=>(await fetch(url)).json(),root+'/views') as Views,view=list.views.find(v=>v.definition.name===original)!;assert.ok(view);
 async function persisted(value:string){await waitForBrowserJson<Views>(page,root+'/views',r=>r.views.some(v=>v.id===view.id&&v.definition.name===value),'Automatic configuration persistence');}
 await name.fill('Autosave first draft');await name.fill('Autosave final draft');await persisted('Autosave final draft');await page.getByText('Changes saved.',{exact:true}).waitFor();await page.reload();await name.waitFor();assert.equal(await name.inputValue(),'Autosave final draft');
 const path='**'+root+'/views/'+view.id;await page.route(path,async route=>{if(route.request().method()==='PATCH')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'FIXTURE_UNAVAILABLE'})});else await route.continue();});
 await name.fill('Retained unsaved draft');await page.getByText('Unable to save changes.',{exact:true}).waitFor();await page.getByText(/^Autosave paused\./).waitFor();assert.equal(await name.inputValue(),'Retained unsaved draft');await persisted('Autosave final draft');await check(page,'autosave-retained-error');
 await page.unroute(path);await page.getByRole('button',{name:'Save changes',exact:true}).click();await persisted('Retained unsaved draft');await page.getByText('Changes saved.',{exact:true}).waitFor();await page.reload();await name.waitFor();assert.equal(await name.inputValue(),'Retained unsaved draft');await name.fill(original);await persisted(original);await page.getByText('Changes saved.',{exact:true}).waitFor();await page.reload();await name.waitFor();assert.equal(await name.inputValue(),original);const chooser=page.getByRole('region',{name:'Choose dashboard type',exact:true});if(!await chooser.isVisible())await page.getByText('Create a dashboard or prepare data',{exact:true}).click();await chooser.getByRole('button',{name:/^Sales performance\b/}).click();await check(page,'autosave-persisted');
 console.log('PASS: automatic debounced configuration persistence, reload, failed-save draft retention, paused retry and original configuration restoration.');
}
