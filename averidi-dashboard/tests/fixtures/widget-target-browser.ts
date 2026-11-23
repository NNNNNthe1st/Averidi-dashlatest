import assert from 'node:assert/strict';
import type {Page} from 'playwright';
export async function verifyWidgetTargets(page:Page,workspaceId:string,check:(page:Page,phase:string)=>Promise<void>){
 const root='/dashboard/app/api/workspaces/'+workspaceId,canvas=page.getByRole('region',{name:'Dashboard results',exact:true});
 const datasets=await page.evaluate(async url=>(await fetch(url)).json(),root+'/datasets'),dataset=datasets.datasets.find((d:{name:string})=>d.name==='Browser orders');assert.ok(dataset);
 const input={datasetId:dataset.id,metricKey:'REVENUE',name:'KPI acceptance goal',value:500,start:'2026-01-01',through:'2026-01-03'};
 async function command(body:unknown){return page.evaluate(async({url,body})=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},{url:root+'/monitoring',body});}
 const created=await command({action:'SAVE_TARGET',input});assert.equal(created.status,200);let target=created.body.target;
 try{
  await canvas.getByLabel('Filter by',{exact:true}).selectOption('day');await canvas.getByLabel('From',{exact:true}).fill('2026-01-01');await canvas.getByLabel('Through',{exact:true}).fill('2026-01-03');await canvas.getByRole('button',{name:'Apply filter',exact:true}).click();const goals=canvas.getByRole('region',{name:'Matching targets for Revenue',exact:true});await goals.getByText('KPI acceptance goal',{exact:true}).waitFor();await goals.getByText('$500.00',{exact:true}).waitFor();await check(page,'kpi-targets-desktop');
  const updated=await command({action:'SAVE_TARGET',input:{...input,value:600},expected:{id:target.id,expectedRevision:target.revision}});assert.equal(updated.status,200);target=updated.body.target;await canvas.getByRole('button',{name:'Apply filter',exact:true}).click();await goals.getByText('$600.00',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await check(page,'kpi-targets-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'KPI target card overflows mobile viewport');await page.setViewportSize({width:1280,height:900});
  await canvas.getByLabel('Filter by',{exact:true}).selectOption('channel');await canvas.getByLabel('Value',{exact:true}).fill('Web');await canvas.getByRole('button',{name:'Apply filter',exact:true}).click();await canvas.getByText('$300.00',{exact:true}).first().waitFor();assert.equal(await goals.count(),0);
  await canvas.getByRole('button',{name:'Clear filters',exact:true}).click();await canvas.getByText('$350.00',{exact:true}).first().waitFor();assert.equal(await goals.count(),0);
 }finally{assert.equal((await command({action:'REMOVE_TARGET',input:{id:target.id,expectedRevision:target.revision}})).status,200);}
}
