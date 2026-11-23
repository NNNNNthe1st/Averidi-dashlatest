import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardDb as db} from '../src/server/db';
import {governedWorkspace} from './fixtures/governed-workspace';
import {readSharing,mutateSharing,redeemShare} from '../src/features/sharing/service';
import {authorizedView} from '../src/features/sharing/access';
import {listWorkspaceViews,updateWorkspaceView} from '../src/features/views/service';
import {readWorkspaceDashboardData} from '../src/features/analysis/views';
import {readDashboardLayout} from '../src/features/views/layout-service';
import {listFilterPresets} from '../src/features/views/exploration';
import {saveReportDefinition,listReportDefinitions} from '../src/features/reports/definitions';
import {queueInAppReportDelivery} from '../src/features/reports/delivery';
import {enqueueActorDashboardJob} from '../src/worker/queue';
import {runDashboardWorkerOnce} from '../src/worker/run-once';
import {removeWorkspaceMember} from '../src/features/workspaces/service';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {GET as exportReport} from '../src/app/api/workspaces/[workspaceId]/reports/exports/[exportId]/route';
import {GET as exportDefinition} from '../src/app/api/workspaces/[workspaceId]/views/[viewId]/export/route';
import {GET as inbox} from '../src/app/api/workspaces/[workspaceId]/reports/deliveries/route';
import {GET as readSharingRoute,POST as sharingRoute} from '../src/app/api/workspaces/[workspaceId]/views/[viewId]/sharing/route';
import {POST as redeemRoute} from '../src/app/api/workspaces/[workspaceId]/shares/redeem/route';
after(()=>db.$disconnect());
const expiry=()=>new Date(Date.now()+7*86400000).toISOString();
async function context(){const f=await governedWorkspace();const subject=randomUUID(),user=await db.dashboardUser.create({data:{externalSubject:'share-editor|'+subject}}),editor={userId:user.id,issuer:'share-editor',subject};await db.dashboardMembership.create({data:{workspaceId:f.workspace.id,userId:user.id,role:'EDITOR'}});return {...f,editor,async change(input:Record<string,unknown>){const state=await readSharing(f.actor,f.workspace.id,f.viewId);return mutateSharing(f.actor,f.workspace.id,f.viewId,{...input,expectedUpdatedAt:state.view.updatedAt.toISOString()});},async cleanup(){await f.cleanup();await db.dashboardUser.delete({where:{id:user.id}});}};}
test('restricted dashboards retain owners and enforce view/edit grants without escalating workspace roles',async()=>{
 const f=await context();try{
  assert.ok((await listWorkspaceViews(f.reader,f.workspace.id))?.some(v=>v.id===f.viewId));assert.equal((await listWorkspaceViews(f.editor,f.workspace.id))?.find(v=>v.id===f.viewId)?.canEdit,true);
  await f.change({action:'MODE',mode:'RESTRICTED'});assert.equal((await listWorkspaceViews(f.reader,f.workspace.id))?.length,0);
  for(const call of [()=>readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{filters:[],compare:false}),()=>readDashboardLayout(f.reader,f.workspace.id,f.viewId),()=>listFilterPresets(f.reader,f.workspace.id,f.viewId)])await assert.rejects(call(),/NOT_FOUND/);
  await f.change({action:'GRANT',userId:f.reader.userId,permission:'VIEW',expiresAt:expiry()});await f.change({action:'GRANT',userId:f.editor.userId,permission:'VIEW',expiresAt:expiry()});
  assert.equal((await readWorkspaceDashboardData(f.reader,f.workspace.id,f.viewId,{filters:[],compare:false})).analysis.outcomes.find(m=>m.key==='REVENUE')?.value,300);
  assert.equal((await listWorkspaceViews(f.editor,f.workspace.id))?.find(v=>v.id===f.viewId)?.canEdit,false);const view=await authorizedView(f.actor,f.workspace.id,f.viewId);assert.equal((await updateWorkspaceView(f.editor,f.workspace.id,f.viewId,view.definition,view.updatedAt.toISOString())).ok,false);
  await assert.rejects(f.change({action:'GRANT',userId:f.reader.userId,permission:'EDIT',expiresAt:expiry()}),/INVALID_MEMBER/);
  await f.change({action:'GRANT',userId:f.editor.userId,permission:'EDIT',expiresAt:expiry()});let latest=await authorizedView(f.actor,f.workspace.id,f.viewId);assert.equal((await updateWorkspaceView(f.editor,f.workspace.id,f.viewId,latest.definition,latest.updatedAt.toISOString())).ok,true);
  await f.change({action:'GRANT',userId:f.editor.userId,permission:'VIEW',expiresAt:expiry()});assert.equal((await listWorkspaceViews(f.editor,f.workspace.id))?.find(v=>v.id===f.viewId)?.canEdit,false);
  latest=await authorizedView(f.actor,f.workspace.id,f.viewId);assert.equal((await updateWorkspaceView(f.editor,f.workspace.id,f.viewId,latest.definition,latest.updatedAt.toISOString())).ok,false);
  await f.change({action:'MODE',mode:'WORKSPACE'});assert.equal((await listWorkspaceViews(f.editor,f.workspace.id))?.find(v=>v.id===f.viewId)?.canEdit,true);
 }finally{await f.cleanup();}
});
test('hashed share links enforce workspace membership, expiry, revocation, replay and current membership identity',async()=>{
 const f=await context();try{
  await f.change({action:'MODE',mode:'RESTRICTED'});const result=await f.change({action:'LINK',expiresAt:expiry()});assert.ok(result.token);assert.match(result.token,/^[\w-]{43}$/);
  const state=await readSharing(f.actor,f.workspace.id,f.viewId);assert.equal(JSON.stringify(state).includes(result.token),false);assert.equal(JSON.stringify(state).includes('tokenHash'),false);
  await assert.rejects(redeemShare(f.reader,f.foreign.id,{token:result.token}),/FORBIDDEN/);await assert.rejects(redeemShare(f.actor,f.foreign.id,{token:result.token}),/INVALID_SHARE/);
  await Promise.all([redeemShare(f.reader,f.workspace.id,{token:result.token}),redeemShare(f.reader,f.workspace.id,{token:result.token})]);assert.equal(await db.dashboardAccessGrant.count({where:{workspaceId:f.workspace.id,userId:f.reader.userId}}),1);
  const grant=(await readSharing(f.actor,f.workspace.id,f.viewId)).grants[0];await f.change({action:'REVOKE_GRANT',id:grant.id});await assert.rejects(redeemShare(f.reader,f.workspace.id,{token:result.token}),/INVALID_SHARE/);
  const second=await f.change({action:'LINK',expiresAt:expiry()});await redeemShare(f.reader,f.workspace.id,{token:second.token});assert.ok(await authorizedView(f.reader,f.workspace.id,f.viewId));
  const link=(await readSharing(f.actor,f.workspace.id,f.viewId)).links.find(l=>l.id!==state.links[0].id)!;await f.change({action:'REVOKE_LINK',id:link.id});await assert.rejects(authorizedView(f.reader,f.workspace.id,f.viewId),/NOT_FOUND/);
  const third=await f.change({action:'LINK',expiresAt:expiry()});await redeemShare(f.editor,f.workspace.id,{token:third.token});assert.equal((await listWorkspaceViews(f.editor,f.workspace.id))?.find(v=>v.id===f.viewId)?.canEdit,false);
  await db.dashboardShare.updateMany({where:{workspaceId:f.workspace.id,revokedAt:null},data:{expiresAt:new Date(0)}});await assert.rejects(redeemShare(f.reader,f.workspace.id,{token:third.token}),/INVALID_SHARE/);await assert.rejects(authorizedView(f.editor,f.workspace.id,f.viewId),/NOT_FOUND/);
 }finally{await f.cleanup();}
});
test('membership revocation cascades grants and legacy unbound grants cannot authorize a restricted view',async()=>{
 const f=await context();try{
  await f.change({action:'MODE',mode:'RESTRICTED'});const link=await f.change({action:'LINK',expiresAt:expiry()});await redeemShare(f.reader,f.workspace.id,{token:link.token});const share=(await readSharing(f.actor,f.workspace.id,f.viewId)).links[0];
  assert.equal((await removeWorkspaceMember(f.actor,f.workspace.id,f.reader.userId)).ok,true);assert.equal(await db.dashboardAccessGrant.count({where:{workspaceId:f.workspace.id,userId:f.reader.userId}}),0);
  await db.dashboardMembership.create({data:{workspaceId:f.workspace.id,userId:f.reader.userId,role:'VIEWER'}});await assert.rejects(authorizedView(f.reader,f.workspace.id,f.viewId),/NOT_FOUND/);
  await db.dashboardAccessGrant.create({data:{workspaceId:f.workspace.id,userId:f.reader.userId,shareId:share.id,permission:'EDIT'}});await assert.rejects(authorizedView(f.reader,f.workspace.id,f.viewId),/NOT_FOUND/);await assert.rejects(redeemShare(f.reader,f.workspace.id,{token:link.token}),/INVALID_SHARE/);
  await db.dashboardAccessGrant.deleteMany({where:{workspaceId:f.workspace.id,userId:f.reader.userId}});await redeemShare(f.reader,f.workspace.id,{token:link.token});assert.ok(await authorizedView(f.reader,f.workspace.id,f.viewId));
 }finally{await f.cleanup();}
});
test('report listings, export download, worker queues and deliveries honor current dashboard grants',async()=>{
 const f=await context();try{
  const report=await saveReportDefinition(f.actor,f.workspace.id,{name:'Shared report',viewId:f.viewId,definition:{}}),artifact=await f.run('REPORT_GENERATE',{reportId:report.id});
  const delivery=await queueInAppReportDelivery(f.actor,f.workspace.id,{exportId:artifact.exportId,userId:f.reader.userId},randomUUID());assert.equal((await runDashboardWorkerOnce()).status,'COMPLETED');
  await f.change({action:'MODE',mode:'RESTRICTED'});assert.equal((await listReportDefinitions(f.reader,f.workspace.id)).reports.length,0);assert.equal((await listReportDefinitions(f.reader,f.workspace.id)).exports.length,0);
  await assert.rejects(enqueueActorDashboardJob(f.editor,f.workspace.id,'REPORT_GENERATE',{reportId:report.id},randomUUID()),/NOT_FOUND/);await assert.rejects(queueInAppReportDelivery(f.actor,f.workspace.id,{exportId:artifact.exportId,userId:f.reader.userId},randomUUID()),/RECIPIENT_UNAVAILABLE/);
  const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.reader),req=new Request('https://dashboard.test',{headers:{cookie}}),ec={params:Promise.resolve({workspaceId:f.workspace.id,exportId:artifact.exportId})},vc={params:Promise.resolve({workspaceId:f.workspace.id,viewId:f.viewId})},wc={params:Promise.resolve({workspaceId:f.workspace.id})};
  assert.equal((await exportReport(req,ec)).status,404);assert.equal((await exportDefinition(req,vc)).status,404);assert.equal((await (await inbox(req,wc)).json()).deliveries.length,0);
  await f.change({action:'GRANT',userId:f.reader.userId,permission:'VIEW',expiresAt:expiry()});assert.equal((await exportReport(req,ec)).status,200);assert.equal((await (await inbox(req,wc)).json()).deliveries.length,1);
  const pending=await queueInAppReportDelivery(f.actor,f.workspace.id,{exportId:artifact.exportId,userId:f.reader.userId},randomUUID());assert.ok(pending.deliveryId);const grant=(await readSharing(f.actor,f.workspace.id,f.viewId)).grants[0];await f.change({action:'REVOKE_GRANT',id:grant.id});await assert.rejects(runDashboardWorkerOnce(),/RECIPIENT_UNAVAILABLE/);
  assert.equal((await exportReport(req,ec)).status,404);assert.ok(delivery.deliveryId);
 }finally{await f.cleanup();}
});
test('sharing mutations reject concurrent stale edits, forged actors, unauthorized owners and cross-origin requests',async()=>{
 const f=await context();try{
  const state=await readSharing(f.actor,f.workspace.id,f.viewId),input={action:'MODE',mode:'RESTRICTED',expectedUpdatedAt:state.view.updatedAt.toISOString()};const outcomes=await Promise.allSettled([mutateSharing(f.actor,f.workspace.id,f.viewId,input),mutateSharing(f.actor,f.workspace.id,f.viewId,input)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(readSharing(f.editor,f.workspace.id,f.viewId),/FORBIDDEN/);await assert.rejects(f.change({action:'LINK',expiresAt:new Date(Date.now()+31*86400000).toISOString()}),/INVALID_SHARING/);
  const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.actor),vc={params:Promise.resolve({workspaceId:f.workspace.id,viewId:f.viewId})};const req=(body:unknown,origin='https://dashboard.test')=>new Request('https://dashboard.test/dashboard/app/api/workspaces/'+f.workspace.id+'/views/'+f.viewId+'/sharing',{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await readSharingRoute(new Request('https://dashboard.test'),vc)).status,401);assert.equal((await sharingRoute(req(input,'https://foreign.invalid'),vc)).status,403);assert.equal((await sharingRoute(req({...input,actor:f.reader}),vc)).status,422);
  assert.equal((await redeemRoute(req({token:'x'.repeat(17000)}),{params:Promise.resolve({workspaceId:f.workspace.id})})).status,422);
 }finally{await f.cleanup();}
});

test('historical exports keep their original dashboard authorization when a report is rebound',async()=>{
 const {generateWorkspaceDashboard}=await import('../src/features/analysis/views');
 const f=await context();try{
  const report=await saveReportDefinition(f.actor,f.workspace.id,{name:'Historical report',viewId:f.viewId,definition:{}}),artifact=await f.run('REPORT_GENERATE',{reportId:report.id});
  assert.equal((await db.dashboardReportExport.findUniqueOrThrow({where:{id:artifact.exportId}})).sourceViewId,f.viewId);
  await f.change({action:'MODE',mode:'RESTRICTED'});
  const other=await generateWorkspaceDashboard(f.actor,f.workspace.id,{datasetId:f.dataset.id,analysisId:f.analysisId,template:'SALES',name:'Public to workspace'});
  await assert.rejects(saveReportDefinition(f.editor,f.workspace.id,{name:'Attempted rebind',viewId:other.id,definition:{},expectedUpdatedAt:report.updatedAt.toISOString()},report.id),/NOT_FOUND/);
  await saveReportDefinition(f.actor,f.workspace.id,{name:'Rebound report',viewId:other.id,definition:{},expectedUpdatedAt:report.updatedAt.toISOString()},report.id);
  assert.equal((await listReportDefinitions(f.reader,f.workspace.id)).exports.length,0);
  const cookie='__Secure-averidi-dashboard='+await issueDashboardBrowserSession(f.reader),request=new Request('https://dashboard.test',{headers:{cookie}}),ctx={params:Promise.resolve({workspaceId:f.workspace.id,exportId:artifact.exportId})};
  assert.equal((await exportReport(request,ctx)).status,404);await assert.rejects(queueInAppReportDelivery(f.actor,f.workspace.id,{exportId:artifact.exportId,userId:f.reader.userId},randomUUID()),/RECIPIENT_UNAVAILABLE/);
  await f.change({action:'GRANT',userId:f.reader.userId,permission:'VIEW',expiresAt:expiry()});assert.equal((await exportReport(request,ctx)).status,200);
  const foreign=await db.dashboardView.create({data:{workspaceId:f.foreign.id,datasetId:(await db.dashboardDataset.create({data:{workspaceId:f.foreign.id,name:'Foreign export'}})).id,name:'Foreign',definition:{}}});
  await assert.rejects(db.dashboardReportExport.update({where:{id:artifact.exportId},data:{sourceViewId:foreign.id}}));
 }finally{await f.cleanup();}
});
