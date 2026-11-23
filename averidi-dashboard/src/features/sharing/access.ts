import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import {roleAllows,type VerifiedDashboardActor as Actor} from '../../server/workspace-access';
type Client=Prisma.TransactionClient;
export function viewAccessWhere(member:{id:string;role:string;workspaceId:string},userId:string,permission:'VIEW'|'EDIT'='VIEW'):Prisma.DashboardViewWhereInput{
 if(member.role==='OWNER')return {workspaceId:member.workspaceId};
 const grant={userId,membershipId:member.id,revokedAt:null,permission:{in:permission==='EDIT'?['EDIT']:['VIEW','EDIT']},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]};
 return {OR:[{accessMode:'WORKSPACE'},{shareRecords:{some:{revokedAt:null,expiresAt:{gt:new Date()},accessGrantRecords:{some:grant}}}}]};
}
export async function memberViewWhere(userId:string,workspaceId:string,permission:'VIEW'|'EDIT'='VIEW',tx:Client=db){
 const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId,workspaceId}}});if(!member||!roleAllows(member.role,permission==='EDIT'?'EDITOR':'VIEWER'))throw Error('FORBIDDEN');return viewAccessWhere(member,userId,permission);
}
export async function authorizedView(actor:Pick<Actor,'userId'>,workspaceId:string,viewId:string,permission:'VIEW'|'EDIT'='VIEW',tx:Client=db){
 const where=await memberViewWhere(actor.userId,workspaceId,permission,tx);const view=await tx.dashboardView.findFirst({where:{id:viewId,workspaceId,AND:[where]}});if(!view)throw Error('NOT_FOUND');return view;
}
// Standalone legacy report records retain their workspace authorization boundary.
export async function assertReportView(actor:Pick<Actor,'userId'>,workspaceId:string,viewId:string|null,permission:'VIEW'|'EDIT'='VIEW',tx:Client=db){if(viewId)await authorizedView(actor,workspaceId,viewId,permission,tx);else await memberViewWhere(actor.userId,workspaceId,permission,tx);}
