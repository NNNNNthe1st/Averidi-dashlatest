import {createHmac} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {requireErasureSettings} from './contracts';
export async function erasureBlockers(tx:Prisma.TransactionClient,workspaceIds:string[],supportWorkspaceIds:string[]=[],now=new Date()){
 const settings=requireErasureSettings(),blockers:string[]=[];
 if(await tx.dashboardStoragePolicy.count({where:{workspaceId:{in:[...new Set([...workspaceIds,...supportWorkspaceIds])]},legalHold:true}}))blockers.push('LEGAL_HOLD');
 const [bindings,customers,invoices,attempts]=await Promise.all([tx.dashboardBillingBinding.findMany({where:{workspaceId:{in:workspaceIds}}}),tx.dashboardBillingCustomer.findMany({where:{workspaceId:{in:workspaceIds}}}),tx.dashboardInvoice.findMany({where:{workspaceId:{in:workspaceIds}}}),tx.dashboardCheckoutAttempt.findMany({where:{workspaceId:{in:workspaceIds}}})]);
 const liveBindings=bindings.filter(b=>!['canceled','incomplete_expired'].includes(b.providerStatus??'')).length;
 if(liveBindings||bindings.some(b=>!b.reconciledAt))blockers.push('BILLING_ACTIVE');
 if(attempts.some(a=>a.activeKey!==null))blockers.push('CHECKOUT_PENDING');
 const events=await tx.dashboardBillingEvent.findMany({where:{workspaceId:{in:workspaceIds}},select:{createdAt:true}});const financial=[...bindings,...customers,...invoices,...attempts,...events];
 if(financial.length&&(settings.financialRetentionDays===null||financial.some(row=>Math.max(row.createdAt.getTime(),...['updatedAt','paidAt','periodEnd'].flatMap(key=>{const value=(row as unknown as Record<string,unknown>)[key];return value instanceof Date?[value.getTime()]:[];}))>now.getTime()-settings.financialRetentionDays!*86400000)))blockers.push('FINANCIAL_RETENTION');
 return blockers;
}
export async function reviewAccountErasure(actor:Actor,tx:Prisma.TransactionClient=db){
 requireErasureSettings();const user=await tx.dashboardUser.findUnique({where:{id:actor.userId}});if(!user||user.erasureRequestedAt)throw Error('ACCOUNT_ERASING');
 const memberships=await tx.dashboardMembership.findMany({where:{userId:actor.userId},include:{workspace:{select:{id:true,name:true,memberships:{select:{userId:true,role:true,user:{select:{erasureRequestedAt:true}}}}}}},orderBy:{workspaceId:'asc'},take:1001});
 const organizations=await tx.dashboardOrganizationMember.findMany({where:{userId:actor.userId},include:{organization:{select:{id:true,name:true,updatedAt:true,organizationMemberRecords:{select:{userId:true,role:true,user:{select:{erasureRequestedAt:true}}}},workspaces:{select:{id:true}}}}},orderBy:{organizationId:'asc'},take:1001});
 if(memberships.length>1000||organizations.length>1000)throw Error('ERASURE_SCOPE_LIMIT');const blockers:string[]=[],solo:string[]=[],soloOrgs:string[]=[];
 for(const m of memberships){const members=m.workspace.memberships;if(m.role==='OWNER'&&!members.some(x=>x.role==='OWNER'&&x.userId!==actor.userId&&!x.user.erasureRequestedAt)){if(members.length!==1)blockers.push('WORKSPACE_OWNER_TRANSFER');else solo.push(m.workspaceId);}}
 for(const m of organizations){const members=m.organization.organizationMemberRecords;if(m.role==='OWNER'&&!members.some(x=>x.role==='OWNER'&&x.userId!==actor.userId&&!x.user.erasureRequestedAt)){if(members.length!==1||m.organization.workspaces.some(w=>!solo.includes(w.id)))blockers.push('ORGANIZATION_OWNER_TRANSFER');else soloOrgs.push(m.organizationId);}}
 const cases=await tx.dashboardSupportCase.findMany({where:{requesterId:actor.userId},select:{workspaceId:true,updatedAt:true},orderBy:{id:'asc'}});blockers.push(...await erasureBlockers(tx,solo,cases.map(c=>c.workspaceId)));
 for(const m of memberships)m.workspace.memberships.sort((a,b)=>a.userId.localeCompare(b.userId));for(const m of organizations){m.organization.organizationMemberRecords.sort((a,b)=>a.userId.localeCompare(b.userId));m.organization.workspaces.sort((a,b)=>a.id.localeCompare(b.id));}
 const state={userId:user.id,externalSubject:user.externalSubject,displayName:user.displayName,memberships,organizations,cases,solo,soloOrgs,blockers:[...new Set(blockers)].sort()};
 const reviewToken=createHmac('sha256',requireErasureSettings().key).update('review\0'+JSON.stringify(state)).digest('hex');
 return {reviewToken,blockers:state.blockers,workspaceIds:solo,organizationIds:soloOrgs,workspaces:memberships.map(m=>({id:m.workspaceId,name:m.workspace.name,deleted:solo.includes(m.workspaceId)})),organizations:organizations.map(m=>({id:m.organizationId,name:m.organization.name,deleted:soloOrgs.includes(m.organizationId)}))};
}
