import {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {requireDashboardEntitlement} from '../subscriptions/entitlements';
import {assertCustomPermission} from '../permissions/policy';
export async function customSourceAccess(actor:Actor,workspaceId:string,write=false,allowExpired=false,tx:Prisma.TransactionClient=db){
 const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}});if(!member||!(write?['OWNER','EDITOR']:['OWNER','EDITOR','VIEWER']).includes(member.role))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,write?'connectors.manage':'connectors.read',tx);
 if(!allowExpired&&!await requireDashboardEntitlement(actor,workspaceId))throw Error('SUBSCRIPTION_REQUIRED');
}
