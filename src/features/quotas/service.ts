import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {requireWorkspaceRole} from '../../server/workspace-access';
import {assertCustomPermission} from '../permissions/policy';
import {quotaKeys,quotaSchema,type QuotaKey} from './contracts';
export async function workspaceQuotaUsage(workspaceId:string,tx:Prisma.TransactionClient=db){
 const subscription=await tx.dashboardSubscription.findUnique({where:{workspaceId},select:{planCode:true,billingPlan:{select:{code:true,entitlements:true}}}});
 const entitlements=subscription?.billingPlan?.entitlements;
 const raw=entitlements&&typeof entitlements==='object'&&!Array.isArray(entitlements)?entitlements.quotas:undefined;
 const parsed=quotaSchema.safeParse(raw??{});if(!parsed.success)throw Error('QUOTA_POLICY_INVALID');
 const [record]=await tx.$queryRaw<{usage:Record<QuotaKey,string>}[]>`SELECT dashboard_quota_usage(${workspaceId}) AS usage`;
 return {planCode:subscription?.billingPlan?.code??subscription?.planCode??null,resources:quotaKeys.map(key=>{
  const used=record.usage[key],limit=parsed.data[key]??null;
  return {key,used,limit:limit===null?null:String(limit),remaining:limit===null?null:(BigInt(used)>=BigInt(limit)?'0':String(BigInt(limit)-BigInt(used))),overLimit:limit!==null&&BigInt(used)>BigInt(limit)};
 })};
}
export async function readWorkspaceQuotaUsage(actor:Actor,workspaceId:string){
 if(!await requireWorkspaceRole(actor,workspaceId,'VIEWER'))throw Error('FORBIDDEN');
 await assertCustomPermission(actor,workspaceId,'workspace.read');return workspaceQuotaUsage(workspaceId);
}
/** Early capacity check before storage I/O; the DB publication trigger is authoritative. */
export async function assertStorageQuota(tx:Prisma.TransactionClient,key:string,bytes:number){
 const workspaceId=key.split('/')[1];
 const [result]=await tx.$queryRaw<{allowed:boolean}[]>`SELECT dashboard_storage_quota_allows(${workspaceId},${key},${BigInt(bytes)}) AS allowed`;
 if(!result.allowed)throw Error('DASHBOARD_QUOTA_EXCEEDED:storedBytes');
}
