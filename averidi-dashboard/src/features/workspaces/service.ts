import {erasureAdmissionCode} from '../account-erasure/errors';
import {auditedWrite} from '../audit/service';
import {setAuditActor} from '../audit/context';
import {assertDashboardAdmission} from '../administration/configuration';
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { workspaceNameSchema } from "./validation";
import { dashboardDb } from "../../server/db";
import { requireWorkspaceRole, type VerifiedDashboardActor } from "../../server/workspace-access";


export async function listActorWorkspaces(actor:VerifiedDashboardActor) {
  return dashboardDb.dashboardMembership.findMany({
    where:{userId:actor.userId},
    select:{role:true,workspace:{select:{id:true,name:true,createdAt:true}}},
    orderBy:{workspace:{createdAt:"desc"}},take:100,
  });
}
export async function createActorWorkspace(actor:VerifiedDashboardActor,input:unknown) {
  const parsed=z.object({name:workspaceNameSchema}).strict().safeParse(input);
  if(!parsed.success)return {ok:false as const,error:"INVALID_WORKSPACE" as const};
  const created=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await assertDashboardAdmission(tx,'WORKSPACE_CREATION_ENABLED');const customer=await tx.dashboardUser.findUniqueOrThrow({where:{id:actor.userId},select:{createdAt:true}});return tx.dashboardWorkspace.create({
    data:{name:parsed.data.name,trialStartedAt:customer.createdAt,memberships:{create:{userId:actor.userId,role:"OWNER"}}},
    select:{id:true,name:true,createdAt:true},
  });
  });
  return {ok:true as const,workspace:created};
}
export async function renameWorkspace(actor:VerifiedDashboardActor,workspaceId:string,input:unknown) {
  const parsed=z.object({name:workspaceNameSchema}).strict().safeParse(input);
  if(!parsed.success)return {ok:false as const,error:"INVALID_WORKSPACE" as const};
  if(!await requireWorkspaceRole(actor,workspaceId,"OWNER"))return {ok:false as const,error:"FORBIDDEN" as const};
  const updated=await auditedWrite(actor,tx=>tx.dashboardWorkspace.updateMany({where:{id:workspaceId},data:{name:parsed.data.name}}));
  return updated.count===1?{ok:true as const}:{ok:false as const,error:"NOT_FOUND" as const};
}

export async function listWorkspaceMembers(actor:VerifiedDashboardActor,workspaceId:string) {
  if(!await requireWorkspaceRole(actor,workspaceId,"OWNER"))return null;
  return dashboardDb.dashboardMembership.findMany({
    where:{workspaceId},
    select:{userId:true,role:true,id:true},orderBy:{id:"asc"},take:100,
  });
}
export async function changeWorkspaceMemberRole(actor:VerifiedDashboardActor,workspaceId:string,targetUserId:string,role:unknown) {
  if(!await requireWorkspaceRole(actor,workspaceId,"OWNER"))return {ok:false as const,error:"FORBIDDEN" as const};
  if(!["OWNER","EDITOR","VIEWER"].includes(String(role)))return {ok:false as const,error:"INVALID_ROLE" as const};
  try { return await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
    const acting=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}},select:{role:true}});
    if(acting?.role!=="OWNER")return {ok:false as const,error:"FORBIDDEN" as const};
    const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:targetUserId,workspaceId}}});
    if(!member)return {ok:false as const,error:"NOT_FOUND" as const};
    if(member.role==="OWNER"&&role!=="OWNER"){
      const owners=await tx.dashboardMembership.count({where:{workspaceId,role:"OWNER"}});
      if(owners<=1)return {ok:false as const,error:"LAST_OWNER" as const};
    }
    if(role==='OWNER'){const cleared=await tx.dashboardPermissionGrant.deleteMany({where:{workspaceId,userId:targetUserId,membershipId:member.id}});if(cleared.count)await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'WORKSPACE_ROLE_CLEARED_FOR_OWNER',resourceType:'PERMISSIONS',resourceId:member.id,details:{userId:targetUserId,cleared:cleared.count}}});}
    await tx.dashboardMembership.update({where:{id:member.id},data:{role:String(role)}});
    return {ok:true as const};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}); }
  catch(error){
    if(erasureAdmissionCode(error)==='ERASURE_OWNERSHIP_CHANGED')return {ok:false as const,error:'LAST_OWNER' as const};
    if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2034")return {ok:false as const,error:"CONFLICT" as const};
    throw error;
  }
}

export async function removeWorkspaceMember(actor:VerifiedDashboardActor,workspaceId:string,targetUserId:string){
 if(!await requireWorkspaceRole(actor,workspaceId,"OWNER"))return {ok:false as const,error:"FORBIDDEN" as const};
 try { return await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  const acting=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}},select:{role:true}});
  if(acting?.role!=="OWNER")return {ok:false as const,error:"FORBIDDEN" as const};
  const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:targetUserId,workspaceId}}});
  if(!member)return {ok:false as const,error:"NOT_FOUND" as const};
  if(member.role==="OWNER"){
   const ownerCount=await tx.dashboardMembership.count({where:{workspaceId,role:"OWNER"}});
   if(ownerCount<=1)return {ok:false as const,error:"LAST_OWNER" as const};
  }
  await tx.dashboardMembership.delete({where:{id:member.id}});
  return {ok:true as const};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}); }
 catch(error){
   if(erasureAdmissionCode(error)==='ERASURE_OWNERSHIP_CHANGED')return {ok:false as const,error:'LAST_OWNER' as const};
   if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2034")return {ok:false as const,error:"CONFLICT" as const};
   throw error;
 }
}
