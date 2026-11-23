import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {pagesSchema,normalizeLayout,validateLayoutMembership,positionWidget,transferWidget} from '../src/features/views/layout';
import {readDashboardLayout,saveDashboardLayout} from '../src/features/views/layout-service';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {updateWorkspaceView} from '../src/features/views/service';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {GET,POST} from '../src/app/api/workspaces/[workspaceId]/views/[viewId]/layout/route';
after(()=>db.$disconnect());
const first={widgetId:'revenue',x:0,y:0,width:4,height:3},second={widgetId:'orders',x:4,y:0,width:4,height:3};
test('layout boundaries refuse overlaps, duplicated widgets/pages, invalid sizes and forged metadata',()=>{
 const valid=[{id:'overview',name:'Overview',widgets:[first,second]}];assert.equal(pagesSchema.safeParse(valid).success,true);
 for(const pages of [[],[...valid,valid[0]],[{...valid[0],widgets:[first,first]}],[{...valid[0],widgets:[first,{...second,x:2}]}],[{...valid[0],widgets:[{...first,x:11}]}],[{...valid[0],widgets:[{...first,height:NaN}]}],[{...valid[0],widgets:[{...first,metricKey:'COST'}]}]])assert.equal(pagesSchema.safeParse(pages).success,false);
 assert.equal(validateLayoutMembership(valid,['revenue','orders']),true);assert.equal(validateLayoutMembership(valid,['revenue','foreign']),false);
 assert.throws(()=>positionWidget(valid,'overview',{...first,x:2}),/LAYOUT_OVERLAP/);
});
test('layout normalization retains prior positions and appends newly saved widgets exactly once',()=>{
 const original=[{id:'overview',name:'Overview',widgets:[first]},{id:'details',name:'Details',widgets:[second]}],widgets=[{id:'revenue',kind:'KPI',order:0},{id:'orders',kind:'KPI',order:1},{id:'chart',kind:'BAR',order:2}];
 const result=normalizeLayout(original,widgets);assert.deepEqual(result[0].widgets[0],first);assert.deepEqual(result[1].widgets[0],second);assert.ok(pagesSchema.safeParse(result).success);assert.equal(validateLayoutMembership(result,widgets.map(w=>w.id)),true);
 assert.equal(transferWidget(result,'revenue','details','KPI')[1].widgets.length,2);const sized=[{...original[0],widgets:[{...first,width:5,height:6}]},original[1]];const transferred=transferWidget(sized,'revenue','details','KPI')[1].widgets.find(w=>w.widgetId==='revenue')!;assert.equal(transferred.width,5);assert.equal(transferred.height,6);assert.deepEqual(normalizeLayout(result,widgets),result);
});
test('real page persistence is tenant scoped, stale-safe and does not change metrics or source bindings',async()=>{
 const f=await governedWorkspace();try{
  const before=await db.dashboardView.findUniqueOrThrow({where:{id:f.viewId}}),initial=await readDashboardLayout(f.reader,f.workspace.id,f.viewId),ids=initial.pages[0].widgets.map(w=>w.widgetId);
  assert.equal(initial.customized,false);const layout=[{id:'summary',name:'Summary',widgets:initial.pages[0].widgets},{id:'details',name:'Details',widgets:[]}];
  await assert.rejects(saveDashboardLayout(f.reader,f.workspace.id,f.viewId,{pages:layout,expectedUpdatedAt:initial.updatedAt}),/FORBIDDEN/);
  await assert.rejects(readDashboardLayout(f.actor,f.foreign.id,f.viewId),/NOT_FOUND/);
  await assert.rejects(saveDashboardLayout(f.actor,f.workspace.id,f.viewId,{pages:[{...layout[0],widgets:[{...first,widgetId:'foreign-widget'}]}],expectedUpdatedAt:initial.updatedAt}),/INVALID_LAYOUT/);
  const saved=await saveDashboardLayout(f.actor,f.workspace.id,f.viewId,{pages:layout,expectedUpdatedAt:initial.updatedAt});assert.notEqual(saved.updatedAt,initial.updatedAt);
  await assert.rejects(saveDashboardLayout(f.actor,f.workspace.id,f.viewId,{pages:layout,expectedUpdatedAt:initial.updatedAt}),/VERSION_CONFLICT/);
  const reloaded=await readDashboardLayout(f.reader,f.workspace.id,f.viewId);assert.equal(reloaded.customized,true);assert.deepEqual(reloaded.pages,layout);
  const after=await db.dashboardView.findUniqueOrThrow({where:{id:f.viewId}});assert.deepEqual(after.definition,before.definition);assert.equal(after.analysisId,before.analysisId);assert.equal(after.datasetId,before.datasetId);
  const data=await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{filters:[],compare:false});assert.equal(data.analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);
  const moved=transferWidget(reloaded.pages,ids[0],'details','KPI');await saveDashboardLayout(f.actor,f.workspace.id,f.viewId,{pages:[moved[1],moved[0]],expectedUpdatedAt:reloaded.updatedAt});
  const current=await readDashboardLayout(f.actor,f.workspace.id,f.viewId);assert.equal(current.pages[0].name,'Details');assert.ok(current.pages[0].widgets.some(w=>w.widgetId===ids[0]));
  const outcomes=await Promise.allSettled([1,2].map(n=>saveDashboardLayout(f.actor,f.workspace.id,f.viewId,{pages:current.pages.map(p=>({...p,name:p.name+n})),expectedUpdatedAt:current.updatedAt})));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await db.dashboardAuditEvent.count({where:{workspaceId:f.workspace.id,action:'DASHBOARD_LAYOUT_SAVED'}}),3);
  const stale=await updateWorkspaceView(f.actor,f.workspace.id,f.viewId,before.definition,initial.updatedAt);assert.equal(stale.ok,false);
 }finally{await f.cleanup();}
});
test('content additions retain existing page positions and layout APIs enforce authentication, CSRF and input bounds',async()=>{
 const f=await governedWorkspace();try{
  const view=await db.dashboardView.findUniqueOrThrow({where:{id:f.viewId}}),definition=view.definition as unknown as {widgets:{id:string;order:number}[]};
  const original=await readDashboardLayout(f.actor,f.workspace.id,f.viewId);await saveDashboardLayout(f.actor,f.workspace.id,f.viewId,{pages:original.pages,expectedUpdatedAt:original.updatedAt});
  const revision=await readDashboardLayout(f.actor,f.workspace.id,f.viewId),next={...definition,widgets:[...definition.widgets,{...definition.widgets[0],id:'second-revenue',order:definition.widgets.length}]};
  assert.equal((await updateWorkspaceView(f.actor,f.workspace.id,f.viewId,next,revision.updatedAt)).ok,true);
  const current=await readDashboardLayout(f.actor,f.workspace.id,f.viewId);assert.deepEqual(current.pages[0].widgets.slice(0,-1),original.pages[0].widgets);assert.equal(current.pages[0].widgets.at(-1)?.widgetId,'second-revenue');
  const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.actor),context={params:Promise.resolve({workspaceId:f.workspace.id,viewId:f.viewId})};
  const request=(body:unknown,origin='https://dashboard.test')=>new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/views/'+f.viewId+'/layout',{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await GET(new Request('https://dashboard.test'),context)).status,401);assert.equal((await POST(request({pages:current.pages,expectedUpdatedAt:current.updatedAt},'https://foreign.invalid'),context)).status,403);
  assert.equal((await POST(request({pages:current.pages,expectedUpdatedAt:current.updatedAt,actor:{userId:f.reader.userId}}),context)).status,422);
  assert.equal((await POST(request({pages:current.pages,expectedUpdatedAt:current.updatedAt}),context)).status,200);
  assert.equal((await POST(request({pages:current.pages,expectedUpdatedAt:current.updatedAt}),context)).status,409);
  assert.equal((await POST(request({pages:'x'.repeat(17000)}),context)).status,422);
 }finally{await f.cleanup();}
});
