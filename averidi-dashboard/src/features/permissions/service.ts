import {setAuditActor} from '../audit/context';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {permissionCatalog,permissionKeys,basePermissions,validPermissionSet} from './catalog';
const id=z.string().min(1).max(128),date=z.iso.datetime(),name=z.string().trim().min(2).max(80);
const permissions=z.array(z.enum(permissionKeys as [typeof permissionKeys[number],...typeof permissionKeys[number][]])).min(1).max(permissionKeys.length).refine(validPermissionSet);
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('CREATE'),name,permissions}).strict(),
 z.object({action:z.literal('UPDATE'),id,name,permissions,expectedUpdatedAt:date}).strict(),
 z.object({action:z.literal('DELETE'),id,expectedUpdatedAt:date}).strict(),
 z.object({action:z.literal('ASSIGN'),userId:id,roleId:id.nullable(),expectedRoleUpdatedAt:date.nullable(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
]);
async function owner(tx:Prisma.TransactionClient,actor:Actor,workspaceId:string){if((await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}}))?.role!=='OWNER')throw Error('FORBIDDEN');}
function revision(member:{id:string;role:string},ids:string[]){return createHash('sha256').update(JSON.stringify([member.id,member.role,ids.sort()])).digest('hex');}
export async function listWorkspaceRoles(actor:Actor,workspaceId:string){return db.$transaction(async tx=>{
 await owner(tx,actor,workspaceId);
 const roles=await tx.dashboardWorkspaceRole.findMany({where:{workspaceId},orderBy:{createdAt:'asc'},take:100}),members=await tx.dashboardMembership.findMany({where:{workspaceId},orderBy:{id:'asc'},take:200});
 const grants=await tx.dashboardPermissionGrant.findMany({where:{workspaceId,membershipId:{in:members.map(m=>m.id)}}});
 return {catalog:permissionCatalog.map(([key,label,minimumRole])=>({key,label,minimumRole})),roles:roles.map(r=>({...r,valid:permissions.safeParse(r.permissions).success})),members:members.map(m=>{const ids=grants.filter(g=>g.membershipId===m.id).map(g=>g.roleId);return {userId:m.userId,baseRole:m.role,roleId:ids.length===1?ids[0]:null,restricted:ids.length>0,revision:revision(m,ids)};})};
 });}
export async function mutateWorkspaceRole(actor:Actor,workspaceId:string,input:unknown){
 const parsed=schema.safeParse(input);if(!parsed.success)throw Error('INVALID_PERMISSIONS');const c=parsed.data;
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${workspaceId} FOR UPDATE`;await owner(tx,actor,workspaceId);let details:unknown;
  if(c.action==='CREATE'){
   if(await tx.dashboardWorkspaceRole.count({where:{workspaceId}})>=100)throw Error('ROLE_LIMIT');
   const role=await tx.dashboardWorkspaceRole.create({data:{workspaceId,key:'custom_'+randomUUID(),name:c.name,permissions:c.permissions}});details={action:c.action,roleId:role.id,name:role.name,permissions:role.permissions};
  }else if(c.action==='ASSIGN'){
   await tx.$queryRaw`SELECT id FROM "DashboardMembership" WHERE "workspaceId"=${workspaceId} AND "userId"=${c.userId} FOR UPDATE`;
   const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:c.userId,workspaceId}}});if(!member)throw Error('NOT_FOUND');if(member.role==='OWNER')throw Error('OWNER_ROLE_PROTECTED');
   const old=await tx.dashboardPermissionGrant.findMany({where:{workspaceId,userId:c.userId,membershipId:member.id}});if(revision(member,old.map(g=>g.roleId))!==c.expectedRevision)throw Error('ROLE_CONFLICT');
   if((c.roleId===null)!==(c.expectedRoleUpdatedAt===null))throw Error('INVALID_PERMISSIONS');
   const role=c.roleId?await tx.dashboardWorkspaceRole.findFirst({where:{id:c.roleId,workspaceId}}):null;if(c.roleId&&!role)throw Error('NOT_FOUND');if(role&&role.updatedAt.toISOString()!==c.expectedRoleUpdatedAt)throw Error('ROLE_CONFLICT');
   if(role&&(!permissions.safeParse(role.permissions).success||role.permissions.some(p=>!basePermissions(member.role).includes(p as typeof permissionKeys[number]))))throw Error('INVALID_PERMISSIONS');
   await tx.dashboardPermissionGrant.deleteMany({where:{workspaceId,userId:member.userId}});if(role)await tx.dashboardPermissionGrant.create({data:{workspaceId,userId:member.userId,membershipId:member.id,roleId:role.id}});
   details={action:c.action,userId:member.userId,baseRole:member.role,previousRoleIds:old.map(g=>g.roleId),roleId:role?.id??null};
  }else{
   const role=await tx.dashboardWorkspaceRole.findFirst({where:{id:c.id,workspaceId}});if(!role)throw Error('NOT_FOUND');if(role.updatedAt.toISOString()!==c.expectedUpdatedAt)throw Error('ROLE_CONFLICT');
   if(c.action==='DELETE'){if(await tx.dashboardPermissionGrant.count({where:{workspaceId,roleId:role.id,membershipId:{not:null}}}))throw Error('ROLE_IN_USE');await tx.dashboardWorkspaceRole.delete({where:{id:role.id}});}
   else {const assigned=await tx.dashboardPermissionGrant.findMany({where:{workspaceId,roleId:role.id,membershipId:{not:null}},include:{membership:true}});if(assigned.some(g=>g.membership&&c.permissions.some(p=>!basePermissions(g.membership!.role).includes(p))))throw Error('INVALID_PERMISSIONS');await tx.dashboardWorkspaceRole.update({where:{id:role.id},data:{name:c.name,permissions:c.permissions,updatedAt:new Date(Math.max(Date.now(),role.updatedAt.getTime()+1))}});}
   details={action:c.action,roleId:role.id,previous:{name:role.name,permissions:role.permissions},...(c.action==='UPDATE'?{name:c.name,permissions:c.permissions}:{})};
  }
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'WORKSPACE_ROLE_'+c.action,resourceType:'PERMISSIONS',resourceId:workspaceId,details:details as Prisma.InputJsonValue}});return {updated:true};
 },{timeout:15000});
}
