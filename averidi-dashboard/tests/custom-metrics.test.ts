import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {parseFormula,evaluateFormula} from '../src/features/custom-metrics/formula';
import {readCustomMetrics,mutateCustomMetric} from '../src/features/custom-metrics/service';
import {METRIC_DEFINITIONS,type MetricOutcome,type MetricKey} from '../src/engines/metrics/metric-engine';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {POST as metricPost} from '../src/app/api/workspaces/[workspaceId]/metrics/route';
after(()=>db.$disconnect());
function outcome(key:MetricKey,value:number):MetricOutcome{return {key,value,status:'READY',reason:null,definition:METRIC_DEFINITIONS.find(m=>m.key===key)!,lineage:{datasetVersionId:'fixture-version',fields:[key.toLowerCase()],rowCount:2,period:null,currency:['REVENUE','COST','PROFIT','AVERAGE_ORDER_VALUE'].includes(key)?'USD':null,definitionVersion:'governed-fixture-v1'}};}
const metrics=[outcome('REVENUE',300),outcome('COST',120),outcome('ORDERS',2),outcome('GROSS_MARGIN',.6)];
test('customer formulas use decimal arithmetic, governed inputs, precedence and explicit units',()=>{
 assert.equal(evaluateFormula('REVENUE - COST',metrics,'CURRENCY').value,'180');assert.equal(evaluateFormula('(REVENUE - COST) / REVENUE',metrics,'PERCENT').value,'0.6');assert.equal(evaluateFormula('REVENUE + COST * 0.1',metrics,'CURRENCY').value,'312');assert.equal(evaluateFormula('-REVENUE + COST',metrics,'CURRENCY').value,'-180');assert.equal(evaluateFormula('REVENUE / ORDERS',metrics,'CURRENCY').value,'150');assert.deepEqual(evaluateFormula('REVENUE / ORDERS',metrics,'CURRENCY').units,{orders:-1,USD:1});assert.equal(evaluateFormula('GROSS_MARGIN / 3',metrics,'NUMBER').value,'0.2');
 assert.throws(()=>evaluateFormula('REVENUE + ORDERS',metrics,'NUMBER'),/UNIT_MISMATCH/);assert.throws(()=>evaluateFormula('REVENUE',metrics,'PERCENT'),/UNIT_MISMATCH/);assert.throws(()=>evaluateFormula('REVENUE / (REVENUE - REVENUE)',metrics,'NUMBER'),/ZERO_DENOMINATOR/);assert.throws(()=>evaluateFormula('CUSTOMERS',metrics,'NUMBER'),/INPUT_UNAVAILABLE/);assert.throws(()=>evaluateFormula('REVENUE * REVENUE * REVENUE * REVENUE * REVENUE * REVENUE * REVENUE * REVENUE * REVENUE',metrics,'NUMBER'),/RANGE/);
 assert.equal(evaluateFormula('REVENUE / 7',metrics,'CURRENCY').value,'42.8571428571');
});
test('formula grammar refuses executable code, arbitrary fields, constants-only expressions and excessive work',()=>{
 for(const formula of ['process.exit()','REVENUE.constructor','REVENUE; COST','SUM(REVENUE)','1 + 2','REVENUE ** 2','REVENUE [0]','REVENUE +','REVENUE 2','REVENUE / 1e3','REVENUE + 1000000000001'])assert.throws(()=>parseFormula(formula),formula);
 assert.throws(()=>parseFormula('('.repeat(20)+'REVENUE'+')'.repeat(20)),/LIMIT/);assert.throws(()=>parseFormula('REVENUE+'.repeat(100)+'REVENUE'),/LIMIT|INVALID/);
 assert.throws(()=>evaluateFormula('REVENUE',[{...metrics[0],status:'UNAVAILABLE',value:null}],'CURRENCY'),/INPUT_UNAVAILABLE/);
});
function definition(f:Awaited<ReturnType<typeof governedWorkspace>>){return {datasetId:f.dataset.id,analysisId:f.analysisId,name:'Reviewed contribution',description:'Revenue remaining after the confirmed cost of goods sold.',expression:'REVENUE - COST',format:'CURRENCY',query:{filters:[],compare:false},confirmed:true};}
async function preview(f:Awaited<ReturnType<typeof governedWorkspace>>,d:unknown=definition(f)){return mutateCustomMetric(f.actor,f.workspace.id,{action:'PREVIEW',definition:d}) as Promise<{reviewToken:string;preview:{value:string;inputs:unknown[]};source:{versionId:string};basis:unknown}>;}
test('custom metric authoring persists traceable definitions and components while preserving built-in metrics',async()=>{
 const f=await governedWorkspace();try{
  const builtin=await db.dashboardMetricDefinition.create({data:{workspaceId:f.workspace.id,key:'REVENUE',name:'Governed revenue',definition:{catalogKey:'REVENUE'}}}),d=definition(f),p=await preview(f);assert.equal(p.preview.value,'180');assert.equal(p.source.versionId,f.versionId);assert.ok(p.basis);
  const created=await mutateCustomMetric(f.actor,f.workspace.id,{action:'CREATE',definition:d,expectedPreview:p.reviewToken}) as {id:string};assert.equal(await db.dashboardMetricComponent.count({where:{metricId:created.id}}),2);
  const model=await readCustomMetrics(f.reader,f.workspace.id,f.dataset.id);assert.equal(model.definitions.length,1);assert.equal(model.definitions[0].current,true);assert.equal(model.state,null);
  await assert.rejects(mutateCustomMetric(f.actor,f.workspace.id,{action:'UPDATE',id:builtin.id,expectedUpdatedAt:builtin.updatedAt.toISOString(),definition:d,expectedPreview:p.reviewToken}),/NOT_FOUND/);assert.deepEqual((await db.dashboardMetricDefinition.findUniqueOrThrow({where:{id:builtin.id}})).definition,{catalogKey:'REVENUE'});
  const record=model.definitions[0];await mutateCustomMetric(f.actor,f.workspace.id,{action:'DELETE',id:record.id,expectedUpdatedAt:record.updatedAt.toISOString()});assert.equal(await db.dashboardMetricComponent.count({where:{metricId:record.id}}),0);assert.equal(await db.dashboardAuditEvent.count({where:{workspaceId:f.workspace.id,resourceId:record.id,action:{startsWith:'CUSTOM_METRIC_'}}}),2);
 }finally{await f.cleanup();}
});
test('formula saves require the reviewed preview and reject concurrent edits or changed confirmations',async()=>{
 const f=await governedWorkspace();try{
  const d=definition(f),p=await preview(f);await assert.rejects(mutateCustomMetric(f.actor,f.workspace.id,{action:'CREATE',definition:{...d,expression:'REVENUE'},expectedPreview:p.reviewToken}),/PREVIEW_CHANGED/);
  const created=await mutateCustomMetric(f.actor,f.workspace.id,{action:'CREATE',definition:d,expectedPreview:p.reviewToken}) as {id:string},row=await db.dashboardMetricDefinition.findUniqueOrThrow({where:{id:created.id}}),next={...d,name:'Reviewed margin',expression:'(REVENUE - COST) / REVENUE',format:'PERCENT'},p2=await preview(f,next),command={action:'UPDATE',id:row.id,expectedUpdatedAt:row.updatedAt.toISOString(),definition:next,expectedPreview:p2.reviewToken};
  const race=await Promise.allSettled([mutateCustomMetric(f.actor,f.workspace.id,command),mutateCustomMetric(f.actor,f.workspace.id,command)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  await db.dashboardDatasetVersion.update({where:{id:f.versionId},data:{semanticRevision:{increment:1}}});assert.equal((await readCustomMetrics(f.actor,f.workspace.id)).definitions[0].current,false);await assert.rejects(preview(f,d),/STALE_ANALYSIS/);
 }finally{await f.cleanup();}
});
test('formula preview recalculates governed values for the confirmed reporting period and refuses empty inputs',async()=>{
 const f=await governedWorkspace();try{
  const d={...definition(f),query:{filters:[{type:'DATE_RANGE',field:'day',value:'2026-01-01',end:'2026-01-01'}],compare:false}};const p=await preview(f,d);assert.equal(p.preview.value,'60');assert.ok(JSON.stringify(p.preview.inputs).includes('DATE_RANGE'));
  await assert.rejects(preview(f,{...d,query:{filters:[{type:'DATE_RANGE',field:'day',value:'2027-01-01',end:'2027-01-01'}],compare:false}}),/INPUT_UNAVAILABLE/);
 }finally{await f.cleanup();}
});
test('custom metrics enforce workspace, subscription, built-in role and custom permission boundaries',async()=>{
 const f=await governedWorkspace();try{
  const d=definition(f),p=await preview(f);await assert.rejects(mutateCustomMetric(f.reader,f.workspace.id,{action:'CREATE',definition:d,expectedPreview:p.reviewToken}),/FORBIDDEN/);await assert.rejects(mutateCustomMetric(f.actor,f.foreign.id,{action:'PREVIEW',definition:d}),/DATASET_UNAVAILABLE/);
  await db.dashboardMembership.update({where:{userId_workspaceId:{userId:f.reader.userId,workspaceId:f.workspace.id}},data:{role:'EDITOR'}});const member=await db.dashboardMembership.findUniqueOrThrow({where:{userId_workspaceId:{userId:f.reader.userId,workspaceId:f.workspace.id}}}),role=await db.dashboardWorkspaceRole.create({data:{workspaceId:f.workspace.id,key:'metric-reader',name:'Metric reader',permissions:['workspace.read','datasets.read','analysis.read','views.read']}});await db.dashboardPermissionGrant.create({data:{workspaceId:f.workspace.id,userId:f.reader.userId,membershipId:member.id,roleId:role.id}});await mutateCustomMetric(f.reader,f.workspace.id,{action:'PREVIEW',definition:d});await assert.rejects(mutateCustomMetric(f.reader,f.workspace.id,{action:'CREATE',definition:d,expectedPreview:p.reviewToken}),/FORBIDDEN/);
  await db.dashboardSubscription.update({where:{workspaceId:f.workspace.id},data:{accessSuspended:true}});await assert.rejects(readCustomMetrics(f.actor,f.workspace.id),/SUBSCRIPTION_REQUIRED/);
 }finally{await f.cleanup();}
});
test('custom metric HTTP mutations require same-origin authenticated identity and strict bounded input',async()=>{
 const f=await governedWorkspace(),oldOrigin=process.env.DASHBOARD_PUBLIC_ORIGIN;process.env.DASHBOARD_PUBLIC_ORIGIN='https://dashboard.test';try{
  const d=definition(f),token=await issueDashboardBrowserSession(f.actor),context={params:Promise.resolve({workspaceId:f.workspace.id})},request=(body:unknown,origin='https://dashboard.test')=>new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/metrics',{method:'POST',headers:{origin,cookie:'__Secure-averidi-dashboard='+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await metricPost(request({action:'PREVIEW',definition:d},'https://evil.test'),context)).status,403);assert.equal((await metricPost(request({action:'PREVIEW',definition:d,actor:f.actor}),context)).status,422);assert.equal((await metricPost(request({action:'PREVIEW',definition:{...d,expression:'x'.repeat(17000)}}),context)).status,422);const result=await metricPost(request({action:'PREVIEW',definition:d}),context);assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');
 }finally{if(oldOrigin===undefined)delete process.env.DASHBOARD_PUBLIC_ORIGIN;else process.env.DASHBOARD_PUBLIC_ORIGIN=oldOrigin;await f.cleanup();}
});
