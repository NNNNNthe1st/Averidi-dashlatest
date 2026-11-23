import {dashboardDb} from "../../server/db";
import {requireWorkspaceRole,type VerifiedDashboardActor} from "../../server/workspace-access";

export type DashboardEntitlement={active:boolean;planCode:string|null;checkedAt:string};
export function evaluateDashboardSubscription(row:{planCode:string;status:string;currentPeriodEnd:Date|null;accessSuspended?:boolean;billingPlan?:{active:boolean;entitlements:unknown}|null}|null,now=new Date()):DashboardEntitlement{
 const active=Boolean(row&&!row.accessSuspended&&(!row.billingPlan||(row.billingPlan.active&&(row.billingPlan.entitlements as {dashboardAccess?:boolean})?.dashboardAccess===true))&&row.status==="ACTIVE"&&row.currentPeriodEnd&&row.currentPeriodEnd>now);
 return {active,planCode:active?row!.planCode:null,checkedAt:now.toISOString()};
}
export type DashboardTrial={active:boolean;startedAt:string;expiresAt:string;daysRemaining:number};
/** One calendar month from account creation, never reset by workspace creation. */
export function evaluateDashboardTrial(createdAt:Date,now=new Date()):DashboardTrial{
 const expires=new Date(createdAt);
 const day=expires.getUTCDate();
 expires.setUTCDate(1);
 expires.setUTCMonth(expires.getUTCMonth()+1);
 const lastDay=new Date(Date.UTC(expires.getUTCFullYear(),expires.getUTCMonth()+1,0)).getUTCDate();
 expires.setUTCDate(Math.min(day,lastDay));
 const active=now>=createdAt&&now<expires;
 return {active,startedAt:createdAt.toISOString(),expiresAt:expires.toISOString(),daysRemaining:active?Math.ceil((expires.getTime()-now.getTime())/86400000):0};
}
export async function dashboardTrialForActor(actor:VerifiedDashboardActor,now=new Date()):Promise<DashboardTrial|null>{
 const user=await dashboardDb.dashboardUser.findUnique({where:{id:actor.userId,erasureRequestedAt:null},select:{createdAt:true}});
 return user?evaluateDashboardTrial(user.createdAt,now):null;
}
export async function workspaceDashboardTrial(actor:VerifiedDashboardActor,workspaceId:string):Promise<DashboardTrial|null>{
 if(!await requireWorkspaceRole(actor,workspaceId,'VIEWER'))return null;
 const workspace=await dashboardDb.dashboardWorkspace.findUnique({where:{id:workspaceId},select:{trialStartedAt:true}});
 return workspace?.trialStartedAt?evaluateDashboardTrial(workspace.trialStartedAt):null;
}
export async function workspaceDashboardEntitlement(actor:VerifiedDashboardActor,workspaceId:string):Promise<DashboardEntitlement|null>{
 if(!await requireWorkspaceRole(actor,workspaceId,"VIEWER"))return null;
 const row=await dashboardDb.dashboardSubscription.findUnique({where:{workspaceId},select:{planCode:true,status:true,currentPeriodEnd:true,accessSuspended:true,billingPlan:{select:{active:true,entitlements:true}}}});
 const paid=evaluateDashboardSubscription(row);
 if(paid.active||row?.accessSuspended)return paid;
 const trial=await workspaceDashboardTrial(actor,workspaceId);
 return trial?.active?{active:true,planCode:'TRIAL',checkedAt:new Date().toISOString()}:paid;
}
export async function requireDashboardEntitlement(actor:VerifiedDashboardActor,workspaceId:string){
 const decision=await workspaceDashboardEntitlement(actor,workspaceId);
 return decision?.active===true;
}
