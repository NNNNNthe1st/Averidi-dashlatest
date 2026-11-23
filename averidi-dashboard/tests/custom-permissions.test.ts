import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {dashboardDb as db} from '../src/server/db';
import {listWorkspaceRoles,mutateWorkspaceRole} from '../src/features/permissions/service';
import {workspacePolicy,assertCustomPermission} from '../src/features/permissions/policy';
import {basePermissions,changePermission,jobPermission} from '../src/features/permissions/catalog';
import {issueDashboardBrowserSession} from '../src/server/browser-session';
import {changeWorkspaceMemberRole,removeWorkspaceMember} from '../src/features/workspaces/service';
import {completeConnectorAuthorization} from '../src/features/connectors/service';
import {enqueueActorDashboardJob} from '../src/worker/queue';
import {GET as jobsGet,POST as jobsPost} from '../src/app/api/workspaces/[workspaceId]/jobs/route';
import {GET as dataGet,POST as dataPost} from '../src/app/api/workspaces/[workspaceId]/datasets/route';
import {GET as rolesGet,POST as rolesPost} from '../src/app/api/workspaces/[workspaceId]/roles/route';
after(()=>db.$disconnect());
async function fixture(){
 const previous={...process.env},tag=randomUUID(),issuer='dashboard-permission-fixture';Object.assign(process.env,{DASHBOARD_SESSION_SECRET:'custom-role-fixture-only-secret-'.repeat(3),DASHBOARD_PUBLIC_ORIGIN:'https://dashboard.test'});
 const workspace=await db.dashboardWorkspace.create({data:{name:'Permission fixture'}}),other=await db.dashboardWorkspace.create({data:{name:'Other permission fixture'}});
 const actors:{userId:string;issuer:string;subject:string}[]=[];for(const role of ['OWNER','EDITOR','VIEWER']){const subject=tag+'-'+role,user=await db.dashboardUser.create({data:{externalSubject:issuer+'|'+subject}});await db.dashboardMembership.create({data:{workspaceId:workspace.id,userId:user.id,role}});actors.push({userId:user.id,issuer,subject});}
 await db.dashboardSubscription.create({data:{workspaceId:workspace.id,planCode:'STARTER',status:'ACTIVE',currentPeriodEnd:new Date(Date.now()+86400000)}});
 const [owner,editor,viewer]=actors;
 async function role(name='Job reader',permissions=['workspace.read','jobs.read']){await mutateWorkspaceRole(owner,workspace.id,{action:'CREATE',name,permissions});return (await listWorkspaceRoles(owner,workspace.id)).roles.find(r=>r.name===name)!;}
 async function assign(userId=editor.userId,roleId:string|null=null){const member=(await listWorkspaceRoles(owner,workspace.id)).members.find(m=>m.userId===userId)!;return mutateWorkspaceRole(owner,workspace.id,{action:'ASSIGN',userId,roleId,expectedRoleUpdatedAt:roleId?(await listWorkspaceRoles(owner,workspace.id)).roles.find(r=>r.id===roleId)!.updatedAt.toISOString():null,expectedRevision:member.revision});}
 async function request(actor=editor,body?:unknown,origin='https://dashboard.test'){const token=await issueDashboardBrowserSession(actor);return new Request('https://dashboard.test/dashboard/app/api/workspaces/'+workspace.id+'/datasets',{method:body===undefined?'GET':'POST',headers:{cookie:'__Secure-averidi-dashboard='+token,origin,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 return {workspace,other,owner,editor,viewer,role,assign,request,context:{params:Promise.resolve({workspaceId:workspace.id})},async cleanup(){await db.dashboardWorkspace.deleteMany({where:{id:{in:[workspace.id,other.id]}}});await db.dashboardUser.deleteMany({where:{id:{in:actors.map(a=>a.userId)}}});for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}};
}
test('custom permissions preserve built-in roles and are enforced on direct resource APIs',async()=>{
 const f=await fixture();try{
  assert.deepEqual((await workspacePolicy(f.editor.userId,f.workspace.id))?.permissions,basePermissions('EDITOR'));
  const role=await f.role();await f.assign(f.editor.userId,role.id);assert.equal((await workspacePolicy(f.editor.userId,f.workspace.id))?.restricted,true);
  assert.equal((await jobsGet(await f.request(),f.context)).status,200);assert.equal((await dataGet(await f.request(),f.context)).status,403);
  const count=await db.dashboardDataset.count({where:{workspaceId:f.workspace.id}});assert.equal((await dataPost(await f.request(f.editor,{name:'Must not be created'}),f.context)).status,403);assert.equal(await db.dashboardDataset.count({where:{workspaceId:f.workspace.id}}),count);
  const writer=await f.role('Limited data writer',changePermission(['workspace.read'],'datasets.write',true));await f.assign(f.editor.userId,writer.id);assert.equal((await dataPost(await f.request(f.editor,{name:'Allowed custom write'}),f.context)).status,201);assert.equal((await jobsGet(await f.request(),f.context)).status,403);
  await f.assign(f.editor.userId,null);assert.equal((await dataGet(await f.request(),f.context)).status,200);assert.equal((await dataPost(await f.request(f.editor,{name:'Allowed dataset'}),f.context)).status,201);
 }finally{await f.cleanup();}
});
test('owners alone administer profiles; assignments cannot elevate viewers or restrict owners',async()=>{
 const f=await fixture();try{
  await assert.rejects(listWorkspaceRoles(f.editor,f.workspace.id),/FORBIDDEN/);await assert.rejects(mutateWorkspaceRole(f.editor,f.workspace.id,{action:'CREATE',name:'Elevated',permissions:['workspace.read']}),/FORBIDDEN/);
  const role=await f.role('Data manager',changePermission(['workspace.read'],'datasets.write',true));await assert.rejects(f.assign(f.viewer.userId,role.id),/INVALID_PERMISSIONS/);await assert.rejects(f.assign(f.owner.userId,role.id),/OWNER_ROLE_PROTECTED/);
  await assert.rejects(mutateWorkspaceRole(f.owner,f.workspace.id,{action:'CREATE',name:'Unknown capability',permissions:['workspace.read','billing.manage']}),/INVALID_PERMISSIONS/);
  await assert.rejects(mutateWorkspaceRole(f.owner,f.workspace.id,{action:'CREATE',name:'Missing dependency',permissions:['workspace.read','analysis.manage']}),/INVALID_PERMISSIONS/);
  const reader=await f.role('Viewer reader',['workspace.read','jobs.read']);await f.assign(f.viewer.userId,reader.id);await assert.rejects(mutateWorkspaceRole(f.owner,f.workspace.id,{action:'UPDATE',id:reader.id,name:'Invalid escalation',permissions:changePermission(['workspace.read'],'datasets.write',true),expectedUpdatedAt:reader.updatedAt.toISOString()}),/INVALID_PERMISSIONS/);
  assert.deepEqual((await workspacePolicy(f.owner.userId,f.workspace.id))?.permissions,basePermissions('OWNER'));
 }finally{await f.cleanup();}
});
test('role edits and assignments reject stale revisions and in-use deletion cannot expand access',async()=>{
 const f=await fixture();try{
  const role=await f.role();const member=(await listWorkspaceRoles(f.owner,f.workspace.id)).members.find(m=>m.userId===f.editor.userId)!;
  const command={action:'ASSIGN',userId:f.editor.userId,roleId:role.id,expectedRoleUpdatedAt:role.updatedAt.toISOString(),expectedRevision:member.revision};const assigned=await Promise.allSettled([mutateWorkspaceRole(f.owner,f.workspace.id,command),mutateWorkspaceRole(f.owner,f.workspace.id,command)]);assert.equal(assigned.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(mutateWorkspaceRole(f.owner,f.workspace.id,{action:'DELETE',id:role.id,expectedUpdatedAt:role.updatedAt.toISOString()}),/ROLE_IN_USE/);
  await mutateWorkspaceRole(f.owner,f.workspace.id,{action:'UPDATE',id:role.id,name:'Only workspace',permissions:['workspace.read'],expectedUpdatedAt:role.updatedAt.toISOString()});assert.equal((await jobsGet(await f.request(),f.context)).status,403);
  await assert.rejects(mutateWorkspaceRole(f.owner,f.workspace.id,{action:'UPDATE',id:role.id,name:'Stale update',permissions:['workspace.read','jobs.read'],expectedUpdatedAt:role.updatedAt.toISOString()}),/ROLE_CONFLICT/);
  const currentMember=(await listWorkspaceRoles(f.owner,f.workspace.id)).members.find(m=>m.userId===f.editor.userId)!;await assert.rejects(mutateWorkspaceRole(f.owner,f.workspace.id,{...command,expectedRevision:currentMember.revision}),/ROLE_CONFLICT/);
  assert.ok(await db.dashboardAuditEvent.count({where:{workspaceId:f.workspace.id,action:{startsWith:'WORKSPACE_ROLE_'}}})>=3);
 }finally{await f.cleanup();}
});
test('membership deletion cascades active grants; rejoining and owner promotion do not resurrect a profile',async()=>{
 const f=await fixture();try{
  const role=await f.role();await f.assign(f.editor.userId,role.id);await removeWorkspaceMember(f.owner,f.workspace.id,f.editor.userId);assert.equal(await db.dashboardPermissionGrant.count({where:{workspaceId:f.workspace.id,userId:f.editor.userId}}),0);
  await db.dashboardMembership.create({data:{workspaceId:f.workspace.id,userId:f.editor.userId,role:'EDITOR'}});assert.equal((await workspacePolicy(f.editor.userId,f.workspace.id))?.restricted,false);await f.assign(f.editor.userId,role.id);await changeWorkspaceMemberRole(f.owner,f.workspace.id,f.editor.userId,'OWNER');assert.equal(await db.dashboardPermissionGrant.count({where:{workspaceId:f.workspace.id,userId:f.editor.userId}}),0);
  assert.equal((await workspacePolicy(f.editor.userId,f.workspace.id))?.restricted,false);
 }finally{await f.cleanup();}
});
test('grant constraints reject mismatched members/workspaces and old unbound records remain inactive',async()=>{
 const f=await fixture();try{
  const role=await f.role(),viewer=await db.dashboardMembership.findUniqueOrThrow({where:{userId_workspaceId:{userId:f.viewer.userId,workspaceId:f.workspace.id}}});
  await assert.rejects(db.dashboardPermissionGrant.create({data:{workspaceId:f.workspace.id,userId:f.editor.userId,membershipId:viewer.id,roleId:role.id}}));
  await assert.rejects(db.dashboardPermissionGrant.create({data:{workspaceId:f.other.id,userId:f.editor.userId,membershipId:viewer.id,roleId:role.id}}));
  await db.dashboardPermissionGrant.create({data:{workspaceId:f.workspace.id,userId:f.editor.userId,roleId:role.id}});assert.equal((await workspacePolicy(f.editor.userId,f.workspace.id))?.restricted,false);
 }finally{await f.cleanup();}
});
test('generic jobs and schedules cannot bypass the underlying work permission',async()=>{
 const f=await fixture();try{
  const role=await f.role('Job operator',['workspace.read','jobs.read','jobs.manage']);await f.assign(f.editor.userId,role.id);
  assert.equal((await jobsPost(await f.request(f.editor,{kind:'DATASET_PROFILE',payload:{datasetId:'fake',versionId:'fake',format:'csv'}}),f.context)).status,403);
  await assert.rejects(enqueueActorDashboardJob(f.editor,f.workspace.id,'DATASET_PROFILE',{datasetId:'fake',versionId:'fake',format:'csv'},randomUUID()),/FORBIDDEN/);
  for(const kind of ['DATASET_INGEST','DATASET_VALIDATE','METRICS_CALCULATE','DASHBOARD_GENERATE','REPORT_DELIVER','SOURCE_REFRESH','ALERTS_EVALUATE','DATA_CLEANUP'])await assert.rejects(assertCustomPermission(f.editor,f.workspace.id,jobPermission(kind)),/FORBIDDEN/);
  await assert.rejects(completeConnectorAuthorization(f.editor,f.workspace.id,'fake-connector',new URLSearchParams(),async()=>{throw Error('Must not contact a provider');}),/FORBIDDEN/);
  assert.equal(await db.dashboardJob.count({where:{workspaceId:f.workspace.id}}),0);
 }finally{await f.cleanup();}
});
test('role HTTP mutations require current owner, same origin and bounded strict input',async()=>{
 const f=await fixture();try{
  const command={action:'CREATE',name:'HTTP reader',permissions:['workspace.read','jobs.read']};assert.equal((await rolesPost(await f.request(f.owner,command,'https://evil.test'),f.context)).status,403);assert.equal((await rolesPost(await f.request(f.editor,command),f.context)).status,403);
  assert.equal((await rolesPost(await f.request(f.owner,{...command,actor:{userId:f.owner.userId}}),f.context)).status,400);assert.equal((await rolesPost(await f.request(f.owner,{...command,name:'x'.repeat(17000)}),f.context)).status,400);
  assert.equal((await rolesPost(await f.request(f.owner,command),f.context)).status,200);assert.equal((await rolesGet(await f.request(f.owner),f.context)).status,200);assert.equal((await rolesGet(await f.request(f.viewer),f.context)).status,403);
 }finally{await f.cleanup();}
});
test('every explicit workspace HTTP operation starts with its custom-permission boundary',async()=>{
 let checked=0;async function walk(folder:string){for(const entry of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name==='route.ts'){const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);for(const fn of source.statements){if(ts.isVariableStatement(fn)&&fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))for(const d of fn.declarationList.declarations)assert.ok(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(d.name.getText(source)),'HTTP exports must declare an explicit guarded function: '+file);if(ts.isExportDeclaration(fn)&&fn.exportClause&&ts.isNamedExports(fn.exportClause))for(const d of fn.exportClause.elements)assert.ok(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(d.name.text),'HTTP re-exports require explicit guard review: '+file);if(!ts.isFunctionDeclaration(fn)||!fn.name||!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(fn.name.text)||!fn.body)continue;assert.match(fn.body.statements[0].getText(source),/enforceWorkspacePermission\(/,file+' '+fn.name.text);checked++;}}}}
 await walk('src/app/api/workspaces/[workspaceId]');assert.ok(checked>=76);
});
