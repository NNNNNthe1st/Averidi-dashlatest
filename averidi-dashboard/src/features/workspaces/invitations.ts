import {auditedWrite} from '../audit/service';
import {setAuditActor} from '../audit/context';
import {assertDashboardAdmission} from '../administration/configuration';
import {createHash,randomBytes} from "node:crypto";
import {dashboardDb} from "../../server/db";
import {requireWorkspaceRole,type VerifiedDashboardActor} from "../../server/workspace-access";
export type InviteRole="EDITOR"|"VIEWER";
export function hashInvitationToken(token:string){return createHash("sha256").update(token).digest("hex");}
export function validInviteRole(role:unknown):role is InviteRole{return role==="EDITOR"||role==="VIEWER";}
export async function createWorkspaceInvitation(actor:VerifiedDashboardActor,workspaceId:string,role:unknown){
 if(!await requireWorkspaceRole(actor,workspaceId,"OWNER"))return {ok:false as const,error:"FORBIDDEN" as const};
 if(!validInviteRole(role))return {ok:false as const,error:"INVALID_ROLE" as const};
 const token=randomBytes(32).toString("base64url");
 const expiresAt=new Date(Date.now()+7*86400000);
 const invite=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');await assertDashboardAdmission(tx,'WORKSPACE_INVITATIONS_ENABLED');return tx.dashboardWorkspaceInvitation.create({data:{workspaceId,invitedById:actor.userId,role,tokenHash:hashInvitationToken(token),expiresAt},select:{id:true,expiresAt:true,role:true}});});
 return {ok:true as const,invitation:invite,token};
}
export async function acceptWorkspaceInvitation(actor:VerifiedDashboardActor,token:unknown){
 if(typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))return {ok:false as const,error:"INVALID_INVITATION" as const};
 return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await assertDashboardAdmission(tx,'WORKSPACE_INVITATIONS_ENABLED');
  const invite=await tx.dashboardWorkspaceInvitation.findUnique({where:{tokenHash:hashInvitationToken(token)}});
  if(!invite||invite.revokedAt||invite.acceptedAt||invite.expiresAt<=new Date())return {ok:false as const,error:"INVALID_INVITATION" as const};
  const updated=await tx.dashboardWorkspaceInvitation.updateMany({where:{id:invite.id,revokedAt:null,acceptedAt:null,expiresAt:{gt:new Date()}},data:{acceptedAt:new Date(),acceptedById:actor.userId}});
  if(updated.count!==1)return {ok:false as const,error:"INVALID_INVITATION" as const};
  await tx.dashboardMembership.upsert({where:{userId_workspaceId:{userId:actor.userId,workspaceId:invite.workspaceId}},create:{userId:actor.userId,workspaceId:invite.workspaceId,role:invite.role},update:{}});
  return {ok:true as const,workspaceId:invite.workspaceId};
 });
}
export async function revokeWorkspaceInvitation(actor:VerifiedDashboardActor,workspaceId:string,id:string){
 if(!await requireWorkspaceRole(actor,workspaceId,"OWNER"))return {ok:false as const,error:"FORBIDDEN" as const};
 const result=await auditedWrite(actor,tx=>tx.dashboardWorkspaceInvitation.updateMany({where:{id,workspaceId,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}}));
 return result.count===1?{ok:true as const}:{ok:false as const,error:"NOT_FOUND" as const};
}
export async function listWorkspaceInvitations(actor:VerifiedDashboardActor,workspaceId:string){
 if(!await requireWorkspaceRole(actor,workspaceId,"OWNER"))return null;
 return dashboardDb.dashboardWorkspaceInvitation.findMany({where:{workspaceId},select:{id:true,role:true,expiresAt:true,revokedAt:true,acceptedAt:true,createdAt:true},orderBy:{createdAt:"desc"},take:100});
}
