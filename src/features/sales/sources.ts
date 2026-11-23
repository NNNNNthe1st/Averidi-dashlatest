import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {dashboardDb} from '../../server/db';
import {setAuditActor} from '../audit/context';
import {requireWorkspaceRole,type VerifiedDashboardActor} from '../../server/workspace-access';
import {datasetNameSchema,listWorkspaceDatasets} from '../datasets/service';
import {z} from 'zod';
export const salesSourceRequest=z.object({name:datasetNameSchema,requestId:z.string().uuid()}).strict();
/** A lost registration receipt must not create another source when retried. */
export async function registerSalesSource(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){
 const parsed=salesSourceRequest.safeParse(input);if(!parsed.success)throw Error('INVALID_NAME');
 if(!await requireWorkspaceRole(actor,workspaceId,'EDITOR'))throw Error('FORBIDDEN');
 const suffix=createHash('sha256').update(JSON.stringify([workspaceId,actor.userId,parsed.data.requestId])).digest('hex');
 return dashboardDb.$transaction(async tx=>{
  await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardWorkspace" WHERE id=${workspaceId} FOR UPDATE`;
  const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}},select:{role:true}});
  if(!member||!['OWNER','EDITOR'].includes(member.role))throw Error('FORBIDDEN');
  const existing=await tx.dashboardDataset.findUnique({where:{id:'sales_'+suffix},select:{id:true,name:true,status:true}});
  if(existing)return existing;
  const source=await tx.dashboardDataSource.create({data:{id:'sales_source_'+suffix,workspaceId,name:parsed.data.name,kind:'FILE',status:'CONNECTED'}});
  return tx.dashboardDataset.create({data:{id:'sales_'+suffix,workspaceId,name:parsed.data.name,sourceId:source.id},select:{id:true,name:true,status:true}});
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
export async function listSalesSources(actor:VerifiedDashboardActor,workspaceId:string){
 const datasets=await listWorkspaceDatasets(actor,workspaceId);if(!datasets)return null;
 const [versions,activeVersions]=await Promise.all([dashboardDb.dashboardDatasetVersion.findMany({where:{datasetId:{in:datasets.map(d=>d.id)}},orderBy:{version:'desc'},distinct:['datasetId'],select:{id:true,datasetId:true,version:true,rowCount:true,createdAt:true,importSummary:true,status:true}}),dashboardDb.dashboardDatasetVersion.findMany({where:{id:{in:datasets.flatMap(d=>d.latestVersionId?[d.latestVersionId]:[])}},select:{id:true,datasetId:true,version:true,rowCount:true,createdAt:true,importSummary:true,status:true}})]);
 return datasets.map(d=>{const newest=versions.find(v=>v.datasetId===d.id),v=activeVersions.find(v=>v.id===d.latestVersionId)??newest,summary=v?.importSummary as Record<string,unknown>|null;
  return {...d,fileName:typeof summary?.salesFileName==='string'?summary.salesFileName:null,rowCount:v?.rowCount??null,sourceVersion:v?.version??null,uploadedAt:v?.createdAt.toISOString()??null,uploadStatus:newest?.status??null};});
}
