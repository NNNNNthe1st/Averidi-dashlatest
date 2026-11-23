import {setAuditActor} from '../audit/context';
import {supportCreateSchema as createSchema,supportUpdateSchema as updateSchema} from '../../contracts/administration';
import {dashboardDb as db} from '../../server/db';
import {requireWorkspaceRole,type VerifiedDashboardActor} from '../../server/workspace-access';
import type {AdminActor} from '../billing/contracts';
const transitions:Record<string,string[]>={OPEN:['IN_PROGRESS','CLOSED'],IN_PROGRESS:['RESOLVED','CLOSED'],RESOLVED:['OPEN','CLOSED'],CLOSED:['OPEN']};
export async function createSupportCase(workspaceId:string,input:unknown,actor:VerifiedDashboardActor){
 if(!await requireWorkspaceRole(actor,workspaceId,'VIEWER'))throw Error('FORBIDDEN');
 const parsed=createSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_BILLING_INPUT');
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dashboard-support:${workspaceId}:${actor.userId}`},0))`;
  const settings=await tx.dashboardConfiguration.findMany({where:{key:{in:['SUPPORT_CASE_CREATION_ENABLED','SUPPORT_MAX_OPEN_CASES_PER_USER']}}});
  if(settings.find(x=>x.key==='SUPPORT_CASE_CREATION_ENABLED')?.value===false)throw Error('SUPPORT_DISABLED');
  const configured=settings.find(x=>x.key==='SUPPORT_MAX_OPEN_CASES_PER_USER')?.value;
  const limit=typeof configured==='number'&&Number.isInteger(configured)&&configured>=1&&configured<=1000?configured:20;
  if(await tx.dashboardSupportCase.count({where:{workspaceId,requesterId:actor.userId,status:{in:['OPEN','IN_PROGRESS']}}})>=limit)throw Error('SUPPORT_LIMIT');
  const record=await tx.dashboardSupportCase.create({data:{workspaceId,requesterId:actor.userId,subject:parsed.data.subject,details:{message:parsed.data.message}}});
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'SUPPORT_CASE_CREATED',resourceType:'SUPPORT_CASE',resourceId:record.id}});
  return {id:record.id,status:record.status,updatedAt:record.updatedAt};
 });
}
export async function updateSupportCase(id:string,input:unknown,actor:AdminActor){
 const parsed=updateSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_BILLING_INPUT');
 const v=parsed.data;
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  const previous=await tx.dashboardSupportCase.findUnique({where:{id}});if(!previous)throw Error('NOT_FOUND');
  if(!transitions[previous.status]?.includes(v.status))throw Error('SUPPORT_CASE_CONFLICT');
  const changed=await tx.dashboardSupportCase.updateMany({where:{id,status:previous.status,updatedAt:new Date(v.expectedUpdatedAt)},data:{status:v.status}});
  if(changed.count!==1)throw Error('SUPPORT_CASE_CONFLICT');
  await tx.dashboardAdminAudit.create({data:{workspaceId:previous.workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'ADMIN_SUPPORT_CASE',details:JSON.stringify({caseId:id,previous:previous.status,status:v.status,note:v.note})}});
  return tx.dashboardSupportCase.findUniqueOrThrow({where:{id},select:{id:true,status:true,updatedAt:true}});
 });
}
