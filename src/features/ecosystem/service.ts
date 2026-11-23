import {dashboardDb as db} from '../../server/db';
import {requireWorkspaceRole,resolveVerifiedDashboardActor} from '../../server/workspace-access';
import {evaluateDashboardSubscription} from '../subscriptions/entitlements';
import {dashboardResourceId,subscriptionSummarySchema,navigationSchema,type EcosystemClaims} from '../../contracts/integration';
async function member(claims:EcosystemClaims,workspaceId:string,permission:EcosystemClaims['dashboard_permissions'][number]){
 if(!dashboardResourceId.safeParse(workspaceId).success)throw Error('INVALID_CONTRACT_REQUEST');
 if(!claims.workspace_ids.includes(workspaceId)||!claims.dashboard_permissions.includes(permission))throw Error('FORBIDDEN');
 const actor=await resolveVerifiedDashboardActor({issuer:claims.iss,subject:claims.sub});
 const membership=actor?await requireWorkspaceRole(actor,workspaceId,'VIEWER'):null;if(!membership)throw Error('FORBIDDEN');
 return membership;
}
export async function readIntegrationSubscription(claims:EcosystemClaims,workspaceId:string){
 await member(claims,workspaceId,'dashboard:subscription:read');
 const row=await db.dashboardSubscription.findUnique({where:{workspaceId},select:{planCode:true,status:true,currentPeriodEnd:true,accessSuspended:true,billingPlan:{select:{active:true,entitlements:true}}}});
 return subscriptionSummarySchema.parse({contractVersion:'1.0',product:'averidi-dashboard',workspaceId,subscription:evaluateDashboardSubscription(row),status:row?.status??'INACTIVE',currentPeriodEnd:row?.currentPeriodEnd?.toISOString()??null});
}
export async function readIntegrationNavigation(claims:EcosystemClaims,workspaceId:string){
 const membership=await member(claims,workspaceId,'dashboard:navigation:read');
 return navigationSchema.parse({contractVersion:'1.0',product:'averidi-dashboard',workspaceId,links:{workspaces:'/dashboard/app/workspaces',studio:`/dashboard/app/workspaces/${workspaceId}/studio`,...(membership.role==='OWNER'?{members:`/dashboard/app/workspaces/${workspaceId}/members`}:{}),login:'/dashboard/app/api/auth/login'}});
}
