import {setAuditActor} from '../audit/context';
import {assertDashboardAdmission} from '../administration/configuration';
import {randomBytes,createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {dashboardReleaseConfig,isDashboardWorkspaceReleased} from '../../server/release-gate';
const name=z.string().trim().min(2).max(120),id=z.string().min(1).max(128);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('RENAME'),name,expectedUpdatedAt:z.iso.datetime()}).strict(),
 z.object({action:z.literal('DELETE'),expectedUpdatedAt:z.iso.datetime()}).strict(),
 z.object({action:z.literal('MEMBER'),userId:id,role:z.enum(['OWNER','MEMBER','REMOVE'])}).strict(),
 z.object({action:z.literal('INVITE')}).strict(),
 z.object({action:z.literal('REVOKE'),invitationId:id}).strict(),
 z.object({action:z.literal('WORKSPACE'),workspaceId:id,linked:z.boolean()}).strict(),
]);
async function membership(tx:Prisma.TransactionClient,actor:Actor,organizationId:string,owner=false){
 const row=await tx.dashboardOrganizationMember.findUnique({where:{organizationId_userId:{organizationId,userId:actor.userId}}});
 if(!row||owner&&row.role!=='OWNER')throw Error('FORBIDDEN');return row;
}
async function audit(tx:Prisma.TransactionClient,actor:Actor,organizationId:string,action:string,resourceId:string){await tx.dashboardOrganizationAuditEvent.create({data:{organizationId,actorIssuer:actor.issuer,actorSubject:actor.subject,action,resourceId}});}
export async function createOrganization(actor:Actor,input:unknown){
 const p=z.object({name}).strict().safeParse(input);if(!p.success)throw Error('INVALID_QUERY');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await assertDashboardAdmission(tx,'ORGANIZATION_CREATION_ENABLED');const organization=await tx.dashboardOrganization.create({data:{name:p.data.name,organizationMemberRecords:{create:{userId:actor.userId,role:'OWNER'}}}});await audit(tx,actor,organization.id,'ORGANIZATION_CREATED',organization.id);return organization;});
}
export async function listOrganizations(actor:Actor){return db.dashboardOrganizationMember.findMany({where:{userId:actor.userId},select:{role:true,organization:{select:{id:true,name:true,updatedAt:true}}},orderBy:{organizationId:'asc'},take:200});}
export async function readOrganization(actor:Actor,organizationId:string){
 return db.$transaction(async tx=>{
  const own=await membership(tx,actor,organizationId),organization=await tx.dashboardOrganization.findUniqueOrThrow({where:{id:organizationId}}),owner=own.role==='OWNER';
  const members=await tx.dashboardOrganizationMember.findMany({where:{organizationId},select:{userId:true,role:true},orderBy:{id:'asc'},take:200});
  // Organization membership never reveals or grants access to other workspaces.
  const workspaces=(await tx.dashboardWorkspace.findMany({where:{organizationId,memberships:{some:{userId:actor.userId}}},select:{id:true,name:true},take:200})).filter(w=>isDashboardWorkspaceReleased(w.id,dashboardReleaseConfig()));
  const invitations=owner?await tx.dashboardOrganizationInvitation.findMany({where:{organizationId},select:{id:true,role:true,expiresAt:true,acceptedAt:true,revokedAt:true},orderBy:{createdAt:'desc'},take:200}):[];
  const events=owner?await tx.dashboardOrganizationAuditEvent.findMany({where:{organizationId},select:{id:true,action:true,resourceId:true,createdAt:true},orderBy:{createdAt:'desc'},take:100}):[];
  return {organization,role:own.role,members,workspaces,invitations,events};
 });
}
export async function mutateOrganization(actor:Actor,organizationId:string,input:unknown){
 const p=command.safeParse(input);if(!p.success)throw Error('INVALID_QUERY');const c=p.data;
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardOrganization" WHERE id=${organizationId} FOR UPDATE`;
  await membership(tx,actor,organizationId,true);
  const organization=await tx.dashboardOrganization.findUniqueOrThrow({where:{id:organizationId}});
  if(c.action==='RENAME'||c.action==='DELETE'){
   if(organization.updatedAt.toISOString()!==c.expectedUpdatedAt)throw Error('VERSION_CONFLICT');
   if(c.action==='DELETE'){if(await tx.dashboardWorkspace.count({where:{organizationId}}))throw Error('ORGANIZATION_IN_USE');await tx.dashboardOrganization.delete({where:{id:organizationId}});return {deleted:true};}
   await tx.dashboardOrganization.update({where:{id:organizationId},data:{name:c.name}});
  }else if(c.action==='MEMBER'){
   const target=await tx.dashboardOrganizationMember.findUnique({where:{organizationId_userId:{organizationId,userId:c.userId}}});if(!target)throw Error('NOT_FOUND');
   if(target.role==='OWNER'&&c.role!=='OWNER'&&await tx.dashboardOrganizationMember.count({where:{organizationId,role:'OWNER'}})<=1)throw Error('LAST_OWNER');
   if(c.role==='REMOVE')await tx.dashboardOrganizationMember.delete({where:{id:target.id}});else await tx.dashboardOrganizationMember.update({where:{id:target.id},data:{role:c.role}});
  }else if(c.action==='INVITE'){
   await assertDashboardAdmission(tx,'ORGANIZATION_INVITATIONS_ENABLED');
   const token=randomBytes(32).toString('base64url');const invitation=await tx.dashboardOrganizationInvitation.create({data:{organizationId,role:'MEMBER',invitedById:actor.userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+7*86400000)}});
   await audit(tx,actor,organizationId,'ORGANIZATION_INVITED',invitation.id);return {token};
  }else if(c.action==='REVOKE'){
   const changed=await tx.dashboardOrganizationInvitation.updateMany({where:{id:c.invitationId,organizationId,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});if(!changed.count)throw Error('NOT_FOUND');
  }else{
   if(!isDashboardWorkspaceReleased(c.workspaceId,dashboardReleaseConfig()))throw Error('FORBIDDEN');
   await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${c.workspaceId} FOR UPDATE`;
   const access=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId:c.workspaceId}}});if(access?.role!=='OWNER')throw Error('FORBIDDEN');
   const changed=await tx.dashboardWorkspace.updateMany({where:{id:c.workspaceId,organizationId:c.linked?null:organizationId},data:{organizationId:c.linked?organizationId:null}});if(!changed.count)throw Error('VERSION_CONFLICT');
   await tx.dashboardAuditEvent.create({data:{workspaceId:c.workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:c.linked?'ORGANIZATION_LINKED':'ORGANIZATION_UNLINKED',resourceType:'ORGANIZATION',resourceId:organizationId}});
  }
  await audit(tx,actor,organizationId,'ORGANIZATION_'+c.action,'userId' in c?c.userId:'workspaceId' in c?c.workspaceId:'invitationId' in c?c.invitationId:organizationId);return {ok:true};
 });
}
export async function acceptOrganizationInvitation(actor:Actor,input:unknown){
 const p=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().safeParse(input);if(!p.success)throw Error('INVALID_INVITATION');
 const hash=createHash('sha256').update(p.data.token).digest('hex');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await assertDashboardAdmission(tx,'ORGANIZATION_INVITATIONS_ENABLED');
  const invitation=await tx.dashboardOrganizationInvitation.findUnique({where:{tokenHash:hash}});if(!invitation)throw Error('INVALID_INVITATION');
  await tx.$queryRaw`SELECT id FROM "DashboardOrganization" WHERE id=${invitation.organizationId} FOR UPDATE`;
  const claimed=await tx.dashboardOrganizationInvitation.updateMany({where:{id:invitation.id,tokenHash:hash,role:'MEMBER',acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}},data:{acceptedAt:new Date()}});if(!claimed.count)throw Error('INVALID_INVITATION');
  await tx.dashboardOrganizationMember.upsert({where:{organizationId_userId:{organizationId:invitation.organizationId,userId:actor.userId}},update:{},create:{organizationId:invitation.organizationId,userId:actor.userId,role:'MEMBER'}});
  await audit(tx,actor,invitation.organizationId,'ORGANIZATION_INVITATION_ACCEPTED',invitation.id);return {organizationId:invitation.organizationId};
 });
}
