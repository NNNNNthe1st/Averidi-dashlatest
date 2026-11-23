import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {createWorkspaceDataset} from '../src/features/datasets/service';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {prepareSales} from '../src/features/sales/preparation';
import {generateWorkspaceDashboard,readWorkspaceDashboardData,refreshWorkspaceDashboard} from '../src/features/analysis/views';
import {exportDashboardMetricReport} from '../src/engines/reporting/metric-report';
import {POST as upload} from '../src/app/api/workspaces/[workspaceId]/datasets/[datasetId]/sales-upload/route';
after(()=>db.$disconnect());
test('changing a sales field clears its accounting facts, then recalculates with newly confirmed adjustments',async()=>{
 process.env.DASHBOARD_SESSION_SECRET='isolated-engine-gap-fixture-'.repeat(4);
 const user=await db.dashboardUser.create({data:{externalSubject:'gap|'+randomUUID()}}),ws=await db.dashboardWorkspace.create({data:{name:'Disposable engine gap probe',presentation:{currency:'USD',locale:'en-US',timezone:'UTC'}}});
 await db.dashboardUser.update({where:{id:user.id},data:{externalSubject:'gap|'+user.id}});const actor={userId:user.id,issuer:'gap',subject:user.id};
 try{
  await db.dashboardMembership.create({data:{userId:user.id,workspaceId:ws.id,role:'OWNER'}});
  await db.dashboardSubscription.create({data:{workspaceId:ws.id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}});
  const created=await createWorkspaceDataset(actor,ws.id,'Accounting source');assert.ok(created.ok);if(!created.ok)return;
  const datasetId=created.dataset.id,cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(actor),form=new FormData();
  form.set('file',new File([JSON.stringify([{'Order ID':'O1',Sales:90,'Gross Sales':100,'Discount Amount':10,Currency:'USD'}])],'sample.json',{type:'application/json'}));
  const response=await upload(new Request('https://dashboard.test/dashboard/app/api/workspaces/'+ws.id+'/datasets/'+datasetId+'/sales-upload',{method:'POST',headers:{cookie,origin:'https://dashboard.test'},body:form}),{params:Promise.resolve({workspaceId:ws.id,datasetId})});assert.equal(response.status,202,await response.clone().text());const versionId=(await response.json()).version.id;
  assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');
  const first=await prepareSales(actor,ws.id,datasetId,{versionId,answers:{discountsAlreadyApplied:true,refundsAlreadyApplied:true,taxExcluded:true,deliveryExcluded:true}});
  const corrected=await prepareSales(actor,ws.id,datasetId,{versionId,previousAnalysisId:first.analysisId,answers:{discountsAlreadyApplied:true,refundsAlreadyApplied:true,taxExcluded:true,deliveryExcluded:true,overrides:{Sales:'IGNORE','Gross Sales':'REVENUE'}}});
  const metric=(x:any)=>x.analysis.outcomes.find((m:any)=>m.key==='REVENUE');

  assert.equal(metric(first)?.value,90);assert.notEqual(metric(corrected)?.status,'READY');assert.equal(corrected.answers.discountsAlreadyApplied,undefined);assert.ok(corrected.interpretation.questions.some(q=>q.key==='discountsAlreadyApplied'));
  const adjusted=await prepareSales(actor,ws.id,datasetId,{versionId,previousAnalysisId:corrected.analysisId,answers:{discountsAlreadyApplied:false,refundsAlreadyApplied:true,taxExcluded:true,deliveryExcluded:true}});assert.equal(metric(adjusted)?.value,90);
  const reopened=await prepareSales(actor,ws.id,datasetId,{versionId});assert.equal(metric(reopened)?.value,90);assert.ok(reopened.interpretation.projection.netFromGross);
  const priced=await createWorkspaceDataset(actor,ws.id,'Priced multi-currency orders');assert.ok(priced.ok);if(!priced.ok)return;
  const pricedRows=[{'Order ID':'1',Quantity:2,'Unit Price':20,'Unit Cost':8,Currency:'USD',Status:'Completed',Category:'Services'},{'Order ID':'2',Quantity:1,'Unit Price':999,'Unit Cost':1,Currency:'USD',Status:'Cancelled',Category:'Services'},{'Order ID':'3',Quantity:3,'Unit Price':10,'Unit Cost':4,Currency:'EUR',Status:'Paid',Category:'Services'}],pricedForm=new FormData();pricedForm.set('file',new File([JSON.stringify(pricedRows)],'priced.json',{type:'application/json'}));
  const pricedUpload=await upload(new Request('https://dashboard.test/dashboard/app/api/workspaces/'+ws.id+'/datasets/'+priced.dataset.id+'/sales-upload',{method:'POST',headers:{cookie,origin:'https://dashboard.test'},body:pricedForm}),{params:Promise.resolve({workspaceId:ws.id,datasetId:priced.dataset.id})});assert.equal(pricedUpload.status,202);const pricedVersion=(await pricedUpload.json()).version.id;assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');
  const pricedAnswers={discountsAlreadyApplied:true,refundsAlreadyApplied:true,taxExcluded:true,deliveryExcluded:true,excludeNonSalesStatuses:true};
  const mixed=await prepareSales(actor,ws.id,priced.dataset.id,{versionId:pricedVersion,answers:pricedAnswers});assert.equal(metric(mixed)?.status,'NEEDS_CONFIRMATION');
  const view=await generateWorkspaceDashboard(actor,ws.id,{datasetId:priced.dataset.id,analysisId:mixed.analysisId,template:'SALES'}),usd=await readWorkspaceDashboardData(actor,ws.id,view.id,{filters:[{type:'CATEGORY',field:'Currency',value:'USD'}]});assert.equal(usd.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,40);assert.ok(usd.widgets.some(w=>w.id==='sales-revenue-category'&&w.series[0]?.value===40));assert.match(exportDashboardMetricReport(usd),/"USD"/);
  const eur=await prepareSales(actor,ws.id,priced.dataset.id,{versionId:pricedVersion,answers:{reportingCurrency:'EUR'}});assert.equal(metric(eur)?.value,30);assert.equal(eur.source.rows,3);assert.equal(eur.eligibleRows,1);
  await refreshWorkspaceDashboard(actor,ws.id,view.id,view.updatedAt.toISOString());const eurView=await readWorkspaceDashboardData(actor,ws.id,view.id,{});assert.equal(eurView.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,30);assert.match(exportDashboardMetricReport(eurView),/"EUR"/);

 }finally{await db.dashboardWorkspace.delete({where:{id:ws.id}});await db.dashboardUser.delete({where:{id:user.id}});}
});
