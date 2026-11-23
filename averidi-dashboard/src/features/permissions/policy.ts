import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {permissionKeys,basePermissions,validPermissionSet,type WorkspacePermission} from './catalog';
type Client=Prisma.TransactionClient;
export async function workspacePolicy(userId:string,workspaceId:string,tx:Client=db){
 const membership=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId,workspaceId}}});if(!membership)return null;
 const base=basePermissions(membership.role);if(membership.role==='OWNER')return {role:membership.role,restricted:false,permissions:base};
 const grants=await tx.dashboardPermissionGrant.findMany({where:{workspaceId,userId,membershipId:membership.id},include:{role:true}});
 if(!grants.length)return {role:membership.role,restricted:false,permissions:base};
 const valid=grants.every(g=>g.role.workspaceId===workspaceId&&validPermissionSet(g.role.permissions));
 return {role:membership.role,restricted:true,permissions:valid?base.filter(p=>grants.some(g=>g.role.permissions.includes(p))):[]};
}
export async function assertCustomPermission(actor:Pick<Actor,'userId'>,workspaceId:string,permission:WorkspacePermission|'owner',tx:Client=db){
 const policy=await workspacePolicy(actor.userId,workspaceId,tx);if(!policy)throw Error('FORBIDDEN');
 // Existing endpoint/service authorization remains the base-role ceiling.
 if(policy.restricted&&(permission==='owner'||!policy.permissions.includes(permission)))throw Error('FORBIDDEN');
}
