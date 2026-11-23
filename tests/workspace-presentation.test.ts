import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
import {workspacePresentationSchema,presentationChangeSchema} from '../src/features/workspaces/presentation-contracts';
import {readWorkspacePresentation,updateWorkspacePresentation} from '../src/features/workspaces/presentation';
import {formatWorkspaceDate} from '../src/components/workspace/WorkspacePresentation';
import {governedWorkspace} from './fixtures/governed-workspace';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {GET,PUT} from '../src/app/api/workspaces/[workspaceId]/presentation/route';
after(()=>db.$disconnect());
const settings={currency:'KES',timezone:'Africa/Nairobi',locale:'en-GB'};
test('workspace preferences validate currencies, named timezones and locales without changing English interface scope',()=>{
 assert.deepEqual(workspacePresentationSchema.parse(settings),settings);
 assert.equal(workspacePresentationSchema.parse({...settings,locale:'en-gb'}).locale,'en-GB');
 for(const update of [{currency:'ZZZ'},{currency:'usd'},{timezone:'+05:30'},{timezone:'Mars/Invalid'},{locale:'not_a_locale'},{locale:'zz-ZZ'},{other:'forged'}])assert.equal(workspacePresentationSchema.safeParse({...settings,...update}).success,false);
 assert.equal(presentationChangeSchema.safeParse({presentation:settings,expectedRevision:-1}).success,false);
 const when='2026-01-01T23:30:00Z';assert.match(formatWorkspaceDate(when,settings),/2 Jan 2026/);assert.match(formatWorkspaceDate(when,{...settings,timezone:'America/New_York'}),/1 Jan 2026/);
 assert.match(formatWorkspaceDate('2026-01-01',{...settings,timezone:'America/Los_Angeles'}),/1 Jan 2026/);
 assert.match(formatWorkspaceDate(when,{...settings,locale:'en-US',timezone:'America/New_York'}),/Jan 1, 2026/);
});
test('native owner preferences preserve dataset rules/results, reject stale races and retain scoped audit evidence',async()=>{
 const f=await governedWorkspace();try{
  assert.deepEqual(await readWorkspacePresentation(f.reader,f.workspace.id),{presentation:null,revision:0});
  const before=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}}),metrics=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{});
  await assert.rejects(updateWorkspacePresentation(f.reader,f.workspace.id,{presentation:settings,expectedRevision:0}),/FORBIDDEN/);
  await assert.rejects(readWorkspacePresentation(f.reader,f.foreign.id),/FORBIDDEN/);
  const results=await Promise.allSettled([updateWorkspacePresentation(f.actor,f.workspace.id,{presentation:settings,expectedRevision:0}),updateWorkspacePresentation(f.actor,f.workspace.id,{presentation:{...settings,currency:'JPY'},expectedRevision:0})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(String((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/WORKSPACE_PRESENTATION_CONFLICT/);
  const saved=await readWorkspacePresentation(f.reader,f.workspace.id);assert.equal(saved.revision,1);assert.ok(saved.presentation);
  const afterVersion=await db.dashboardDatasetVersion.findUniqueOrThrow({where:{id:f.versionId}});assert.deepEqual(afterVersion.semantics,before.semantics);assert.equal(afterVersion.semanticRevision,before.semanticRevision);
  const afterMetrics=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{});assert.deepEqual(afterMetrics.analysis.outcomes,metrics.analysis.outcomes);assert.equal(afterMetrics.widgets[0].outcome.lineage.currency,'USD');
  assert.equal(await db.dashboardAuditEvent.count({where:{workspaceId:f.workspace.id,action:'WORKSPACE_PRESENTATION_UPDATED'}}),1);
  assert.ok(await db.dashboardMutationAudit.count({where:{workspaceId:f.workspace.id,resourceType:'DashboardWorkspace',operation:'UPDATE',changedFields:{has:'presentation'}}}));
  await assert.rejects(updateWorkspacePresentation(f.actor,f.workspace.id,{presentation:{...settings,other:'forged'},expectedRevision:1}),/INVALID_WORKSPACE_PRESENTATION/);
 }finally{await f.cleanup();}
});
test('preference HTTP routes enforce session, origin, scope, body limits and server-owned actors',async()=>{
 const f=await governedWorkspace();try{
  const token=await issueDashboardBrowserSession(f.actor),readerToken=await issueDashboardBrowserSession(f.reader),url='https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/presentation',context={params:Promise.resolve({workspaceId:f.workspace.id})};
  const request=(body:unknown,session=token,origin='https://dashboard.test')=>new Request(url,{method:'PUT',headers:{origin,cookie:'__Secure-averidi-dashboard='+session,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const body={presentation:settings,expectedRevision:0};assert.equal((await GET(new Request(url),context)).status,401);
  assert.equal((await PUT(request(body,readerToken),context)).status,403);assert.equal((await PUT(request(body,token,'https://foreign.invalid'),context)).status,403);
  assert.equal((await PUT(request({...body,actor:f.actor}),context)).status,400);assert.equal((await PUT(request({...body,large:'x'.repeat(20000)}),context)).status,400);
  assert.equal((await PUT(request(body),context)).status,200);assert.equal((await PUT(request(body),context)).status,409);
  const response=await GET(new Request(url,{headers:{cookie:'__Secure-averidi-dashboard='+readerToken}}),context);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await response.json(),{presentation:settings,revision:1});
 }finally{await f.cleanup();}
});
