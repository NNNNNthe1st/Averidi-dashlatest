import {setAuditActor} from '../audit/context';
import {subscriptionChangeSchema} from "../../contracts/administration";
export {subscriptionChangeSchema} from "../../contracts/administration";
import {dashboardDb} from "../../server/db";
import {billingLock} from "../billing/service";
export async function applyDashboardSubscriptionChange(workspaceId:string,input:unknown,actor:{issuer:string;subject:string}){
 const parsed=subscriptionChangeSchema.safeParse(input);
 if(!parsed.success)return {ok:false as const,error:"INVALID_SUBSCRIPTION" as const};
 const value=parsed.data;
 return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await billingLock(tx,workspaceId);
  if(await tx.dashboardBillingBinding.findUnique({where:{workspaceId}})||await tx.dashboardCheckoutAttempt.findUnique({where:{workspaceId_activeKey:{workspaceId,activeKey:'ACTIVE'}}}))return {ok:false as const,error:"PROVIDER_MANAGED" as const};
  const plan=await tx.dashboardBillingPlan.findUnique({where:{code:value.planCode}});
  if(value.status==="ACTIVE"&&(!plan||!plan.active||(plan.entitlements as {dashboardAccess?:boolean}|null)?.dashboardAccess!==true))return {ok:false as const,error:"INVALID_SUBSCRIPTION" as const};
  const workspace=await tx.dashboardWorkspace.findUnique({where:{id:workspaceId},select:{id:true}});
  if(!workspace)return {ok:false as const,error:"NOT_FOUND" as const};
  const previous=await tx.dashboardSubscription.findUnique({where:{workspaceId},select:{planCode:true,status:true,currentPeriodEnd:true}});
  const record=await tx.dashboardSubscription.upsert({
   where:{workspaceId},
   create:{workspaceId,billingPlanId:plan?.id??null,planCode:value.planCode,status:value.status,currentPeriodEnd:value.currentPeriodEnd?new Date(value.currentPeriodEnd):null},
   update:{billingPlanId:plan?.id??null,planCode:value.planCode,status:value.status,currentPeriodEnd:value.currentPeriodEnd?new Date(value.currentPeriodEnd):null},
   select:{workspaceId:true,planCode:true,status:true,currentPeriodEnd:true,updatedAt:true}
  });
  await tx.dashboardAdminAudit.create({data:{
   actorIssuer:actor.issuer,actorSubject:actor.subject,workspaceId,action:"ADMIN_SUBSCRIPTION_CHANGE",
   details:JSON.stringify({previous,newStatus:record.status,newPlanCode:record.planCode,newPeriodEnd:record.currentPeriodEnd})
  }});
  return {ok:true as const,subscription:record};
 });
}
