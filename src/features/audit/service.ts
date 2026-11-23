import {dashboardDb as db} from '../../server/db';
import type {Prisma} from '@prisma/client';
import {requireWorkspaceRole,type VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {readAdminPage,adminPageResult} from '../../server/admin-pagination';
import {setAuditActor} from './context';
export async function auditedWrite<T>(actor:Actor,apply:(tx:Prisma.TransactionClient)=>Promise<T>){return db.$transaction(async tx=>{await setAuditActor(tx,actor);return apply(tx);});}
export async function readMutationAudit(request:Request,scope:Prisma.DashboardMutationAuditWhereInput={}){
 const params=new URL(request.url).searchParams,allowed=['limit','cursor','resourceType','operation','transactionId'];
 if([...params.keys()].some(k=>!allowed.includes(k)||params.getAll(k).length!==1))throw Error('INVALID_QUERY');
 const page=readAdminPage(request);if(!page)throw Error('INVALID_QUERY');
 const type=params.get('resourceType'),operation=params.get('operation'),transactionId=params.get('transactionId');
 if(type&&!/^Dashboard[A-Za-z]{1,80}$/.test(type)||operation&&!['INSERT','UPDATE','DELETE'].includes(operation)||transactionId&&!/^\d{1,30}$/.test(transactionId))throw Error('INVALID_QUERY');
 const where:Prisma.DashboardMutationAuditWhereInput={AND:[scope,...(type?[{resourceType:type}]:[]),...(operation?[{operation}]:[]),...(transactionId?[{transactionId}]:[])]};
 if(page.cursor&&!await db.dashboardMutationAudit.count({where:{AND:[where,{id:page.cursor.id}]}}))throw Error('INVALID_QUERY');
 const rows=await db.dashboardMutationAudit.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:page.take,cursor:page.cursor,skip:page.skip});return adminPageResult(rows,page.limit);
}
export async function workspaceMutationAudit(actor:Actor,workspaceId:string,request:Request){if(!await requireWorkspaceRole(actor,workspaceId,'OWNER'))throw Error('FORBIDDEN');return readMutationAudit(request,{workspaceId});}
export async function accountMutationAudit(actor:Actor,request:Request){return readMutationAudit(request,{workspaceId:null,organizationId:null,OR:[{userId:actor.userId},{actorUserId:actor.userId}]});}
