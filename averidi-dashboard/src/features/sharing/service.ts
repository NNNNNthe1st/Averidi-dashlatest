import {setAuditActor} from '../audit/context';
import {assertDashboardAdmission} from '../administration/configuration';
import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {requireAnalysisAccess} from '../analysis/service';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
const id=z.string().min(1).max(128),expires=z.iso.datetime(),revision=z.iso.datetime();
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('MODE'),mode:z.enum(['WORKSPACE','RESTRICTED']),expectedUpdatedAt:revision}).strict(),
 z.object({action:z.literal('LINK'),expiresAt:expires,expectedUpdatedAt:revision}).strict(),
 z.object({action:z.literal('GRANT'),userId:id,permission:z.enum(['VIEW','EDIT']),expiresAt:expires,expectedUpdatedAt:revision}).strict(),
 z.object({action:z.literal('REVOKE_LINK'),id,expectedUpdatedAt:revision}).strict(),
 z.object({action:z.literal('REVOKE_GRANT'),id,expectedUpdatedAt:revision}).strict(),
]);
async function owner(tx:Prisma.TransactionClient,actor:Actor,workspaceId:string){const m=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}});if(m?.role!=='OWNER')throw Error('FORBIDDEN');return m;}
async function audit(tx:Prisma.TransactionClient,actor:Actor,workspaceId:string,viewId:string,action:string){await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action,resourceType:'VIEW',resourceId:viewId}});}
export async function readSharing(actor:Actor,workspaceId:string,viewId:string){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');return db.$transaction(async tx=>{
  await owner(tx,actor,workspaceId);const view=await tx.dashboardView.findFirst({where:{id:viewId,workspaceId},select:{id:true,name:true,accessMode:true,updatedAt:true}});if(!view)throw Error('NOT_FOUND');
  const active={revokedAt:null,expiresAt:{gt:new Date()}};
  const [links,history,grants,members]=await Promise.all([
   tx.dashboardShare.findMany({where:{workspaceId,viewId,kind:'LINK',...active},select:{id:true,expiresAt:true,revokedAt:true},orderBy:{createdAt:'desc'},take:100}),
   tx.dashboardShare.findMany({where:{workspaceId,viewId,kind:'LINK',OR:[{revokedAt:{not:null}},{expiresAt:{lte:new Date()}}]},select:{id:true,expiresAt:true,revokedAt:true},orderBy:{createdAt:'desc'},take:40}),
   tx.dashboardAccessGrant.findMany({where:{workspaceId,membershipId:{not:null},revokedAt:null,share:{viewId,...active},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{id:true,userId:true,permission:true,expiresAt:true,share:{select:{kind:true}}},orderBy:{createdAt:'desc'},take:200}),
   tx.dashboardMembership.findMany({where:{workspaceId},select:{userId:true,role:true},orderBy:{id:'asc'},take:200}),
  ]);return {view,links:[...links,...history],grants,members};
 });
}
export async function mutateSharing(actor:Actor,workspaceId:string,viewId:string,input:unknown){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');const p=command.safeParse(input);if(!p.success)throw Error('INVALID_SHARING');const c=p.data;
 if('expiresAt' in c&&(Date.parse(c.expiresAt)<=Date.now()||Date.parse(c.expiresAt)>Date.now()+30*86400000))throw Error('INVALID_SHARING');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardView" WHERE id=${viewId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  await owner(tx,actor,workspaceId);const view=await tx.dashboardView.findFirst({where:{id:viewId,workspaceId}});if(!view)throw Error('NOT_FOUND');if(view.updatedAt.toISOString()!==c.expectedUpdatedAt)throw Error('VERSION_CONFLICT');let token:string|undefined;
  if(c.action==='MODE')await tx.dashboardView.update({where:{id:viewId},data:{accessMode:c.mode}});
  else if(c.action==='LINK'||c.action==='GRANT'){
   if(c.action==='LINK')await assertDashboardAdmission(tx,'SHARE_LINK_CREATION_ENABLED');
   if(await tx.dashboardShare.count({where:{workspaceId,viewId,kind:'LINK',revokedAt:null,expiresAt:{gt:new Date()}}})>=100&&c.action==='LINK')throw Error('SHARING_LIMIT');
   if(c.action==='GRANT'){
    await tx.$queryRaw`SELECT id FROM "DashboardMembership" WHERE "userId"=${c.userId} AND "workspaceId"=${workspaceId} FOR SHARE`;
    const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:c.userId,workspaceId}}});if(!member||!['EDITOR','VIEWER'].includes(member.role)||c.permission==='EDIT'&&member.role!=='EDITOR')throw Error('INVALID_MEMBER');
    await tx.dashboardAccessGrant.updateMany({where:{workspaceId,userId:c.userId,share:{viewId,kind:'DIRECT'},revokedAt:null},data:{revokedAt:new Date()}});
    if(await tx.dashboardAccessGrant.count({where:{workspaceId,membershipId:{not:null},revokedAt:null,share:{viewId,revokedAt:null,expiresAt:{gt:new Date()}}}})>=200)throw Error('SHARING_LIMIT');
    const key=randomBytes(32).toString('base64url');const share=await tx.dashboardShare.create({data:{workspaceId,viewId,kind:'DIRECT',tokenHash:createHash('sha256').update(key).digest('hex'),permission:c.permission,expiresAt:new Date(c.expiresAt)}});
    await tx.dashboardAccessGrant.create({data:{workspaceId,userId:c.userId,membershipId:member.id,shareId:share.id,permission:c.permission,expiresAt:share.expiresAt}});
   }else{token=randomBytes(32).toString('base64url');await tx.dashboardShare.create({data:{workspaceId,viewId,kind:'LINK',tokenHash:createHash('sha256').update(token).digest('hex'),permission:'VIEW',expiresAt:new Date(c.expiresAt)}});}
  }else if(c.action==='REVOKE_LINK'){if(!(await tx.dashboardShare.updateMany({where:{id:c.id,workspaceId,viewId,kind:'LINK',revokedAt:null},data:{revokedAt:new Date()}})).count)throw Error('NOT_FOUND');}
  else if(!(await tx.dashboardAccessGrant.updateMany({where:{id:c.id,workspaceId,share:{viewId},revokedAt:null},data:{revokedAt:new Date()}})).count)throw Error('NOT_FOUND');
  const updatedAt=new Date(Math.max(Date.now(),view.updatedAt.getTime()+1));await tx.dashboardView.update({where:{id:viewId},data:{updatedAt}});await audit(tx,actor,workspaceId,viewId,'SHARING_'+c.action);return {updatedAt:updatedAt.toISOString(),...(token?{token}:{})};
 });
}
export async function redeemShare(actor:Actor,workspaceId:string,input:unknown){
 await requireAnalysisAccess(actor,workspaceId,'VIEWER');const p=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().safeParse(input);if(!p.success)throw Error('INVALID_SHARE');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  const hash=createHash('sha256').update(p.data.token).digest('hex'),lookup=await tx.dashboardShare.findFirst({where:{workspaceId,tokenHash:hash,kind:'LINK'}});if(!lookup)throw Error('INVALID_SHARE');
  await tx.$queryRaw`SELECT id FROM "DashboardView" WHERE id=${lookup.viewId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const share=await tx.dashboardShare.findFirst({where:{id:lookup.id,workspaceId,kind:'LINK',permission:'VIEW',revokedAt:null,expiresAt:{gt:new Date()}}});if(!share)throw Error('INVALID_SHARE');
  await tx.$queryRaw`SELECT id FROM "DashboardMembership" WHERE "userId"=${actor.userId} AND "workspaceId"=${workspaceId} FOR SHARE`;
  const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}});if(!member||!['OWNER','EDITOR','VIEWER'].includes(member.role))throw Error('FORBIDDEN');
  const old=await tx.dashboardAccessGrant.findUnique({where:{shareId_userId:{shareId:share.id,userId:actor.userId}}});if(old?.revokedAt||old&&old.membershipId!==member.id)throw Error('INVALID_SHARE');
  if(!old){if(await tx.dashboardAccessGrant.count({where:{workspaceId,membershipId:{not:null},revokedAt:null,share:{viewId:share.viewId,revokedAt:null,expiresAt:{gt:new Date()}}}})>=200)throw Error('SHARING_LIMIT');await tx.dashboardAccessGrant.create({data:{workspaceId,userId:actor.userId,membershipId:member.id,shareId:share.id,permission:'VIEW',expiresAt:share.expiresAt}});await audit(tx,actor,workspaceId,share.viewId,'SHARING_LINK_REDEEMED');}
  return {viewId:share.viewId};
 });
}
