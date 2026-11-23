import {setAuditActor} from '../audit/context';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
const id=z.string().min(1).max(128),name=z.string().trim().min(2).max(120);
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('CREATE'),name}).strict(),
 z.object({action:z.literal('RENAME'),id,name,expectedUpdatedAt:z.iso.datetime()}).strict(),
 z.object({action:z.literal('DELETE'),id,expectedUpdatedAt:z.iso.datetime()}).strict(),
 z.object({action:z.literal('MEMBERS'),id,userIds:z.array(id).max(200),expectedUpdatedAt:z.iso.datetime()}).strict(),
]);
async function access(tx:Prisma.TransactionClient,actor:Actor,workspaceId:string,owner=false){const row=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}});if(!row||owner&&row.role!=='OWNER')throw Error('FORBIDDEN');return row;}
export async function listTeams(actor:Actor,workspaceId:string){return db.$transaction(async tx=>{const own=await access(tx,actor,workspaceId);return {role:own.role,teams:await tx.dashboardTeam.findMany({where:{workspaceId},include:{members:{select:{userId:true}}},orderBy:{createdAt:'asc'},take:200}),members:await tx.dashboardMembership.findMany({where:{workspaceId},select:{userId:true,role:true},orderBy:{id:'asc'},take:200})};});}
export async function mutateTeam(actor:Actor,workspaceId:string,input:unknown){
 const p=schema.safeParse(input);if(!p.success)throw Error('INVALID_QUERY');const c=p.data;
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  // Serialize team edits and verify current ownership inside the transaction.
  await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${workspaceId} FOR UPDATE`;
  await access(tx,actor,workspaceId,true);let teamId:string;
  if(c.action==='CREATE'){teamId=(await tx.dashboardTeam.create({data:{workspaceId,name:c.name}})).id;}
  else{
   const team=await tx.dashboardTeam.findFirst({where:{id:c.id,workspaceId}});if(!team)throw Error('NOT_FOUND');if(team.updatedAt.toISOString()!==c.expectedUpdatedAt)throw Error('VERSION_CONFLICT');teamId=team.id;
   if(c.action==='DELETE')await tx.dashboardTeam.delete({where:{id:team.id}});
   else if(c.action==='RENAME')await tx.dashboardTeam.update({where:{id:team.id},data:{name:c.name,updatedAt:new Date(Math.max(Date.now(),team.updatedAt.getTime()+1))}});
   else{
    const userIds=[...new Set(c.userIds)];if(await tx.dashboardMembership.count({where:{workspaceId,userId:{in:userIds}}})!==userIds.length)throw Error('INVALID_MEMBER');
    await tx.dashboardTeamMember.deleteMany({where:{teamId:team.id,workspaceId}});
    await tx.dashboardTeamMember.createMany({data:userIds.map(userId=>({teamId:team.id,workspaceId,userId}))});
    await tx.dashboardTeam.update({where:{id:team.id},data:{updatedAt:new Date(Math.max(Date.now(),team.updatedAt.getTime()+1))}});
   }
  }
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'TEAM_'+c.action,resourceType:'TEAM',resourceId:teamId}});return {ok:true};
 });
}
