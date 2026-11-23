import {currentSourceQuality} from './source-quality-status';
import {ANALYSIS_ENGINE_VERSION} from '../../engines/analysis/pipeline';
import {setAuditActor} from '../audit/context';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {dashboardDb as db} from '../../server/db';
import type {VerifiedDashboardActor as Actor} from '../../server/workspace-access';
import {assertCustomPermission} from '../permissions/policy';
import {dataAccess} from './service';
import {id} from './contracts';
import {assertCurrentAnalysis} from '../analysis/service';
const revision=(issue:unknown)=>createHash('sha256').update(JSON.stringify(issue)).digest('hex');
export async function readQuality(actor:Actor,workspaceId:string,datasetId:string){
 await dataAccess(actor,workspaceId);
 const dataset=await db.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:{not:'ARCHIVED'}},select:{activeVersionId:true,name:true,activeVersion:{select:{id:true,status:true,profile:true,semanticRevision:true,checksum:true}},versions:{orderBy:{version:'desc'},take:1,select:{id:true,status:true}}}});if(!dataset)throw Error('NOT_FOUND');
 const checks=await db.dashboardQualityCheck.findMany({where:{workspaceId,datasetId},orderBy:{createdAt:'desc'},take:20,include:{qualityIssueRecords:{take:100,orderBy:{id:'asc'}}}});
 const version=dataset.activeVersion??dataset.versions[0],analysis=dataset.activeVersion?await db.dashboardAnalysisRun.findUnique({where:{versionId_semanticRevision_engineVersion:{versionId:dataset.activeVersion.id,semanticRevision:dataset.activeVersion.semanticRevision,engineVersion:ANALYSIS_ENGINE_VERSION}},select:{status:true}}):null;

 return {qualityAssessment:await currentSourceQuality({workspaceId,datasetId,versionId:version?.id,status:version?.status,profile:dataset.activeVersion?.profile,semanticRevision:dataset.activeVersion?.semanticRevision,checksum:dataset.activeVersion?.checksum,analysisStatus:analysis?.status}),activeVersionId:dataset.activeVersionId,checks:checks.map(({qualityIssueRecords,...check})=>({...check,scope:check.rule&&typeof check.rule==='object'&&!Array.isArray(check.rule)?check.rule.scope:null,current:check.versionId===dataset.activeVersionId&&!!check.rule&&typeof check.rule==='object'&&!Array.isArray(check.rule)&&check.rule.semanticRevision===dataset.activeVersion?.semanticRevision&&check.rule.sourceChecksum===dataset.activeVersion?.checksum,issues:qualityIssueRecords.map(issue=>({...issue,revision:revision(issue)}))}))};
}
const command=z.object({issueId:id,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(['ACKNOWLEDGE','REOPEN','RESOLVE_FIXED']),note:z.string().trim().min(5).max(1000),verificationCheckId:id.optional()}).strict();
export async function reviewQuality(actor:Actor,workspaceId:string,datasetId:string,input:unknown){
 const parsed=command.safeParse(input);if(!parsed.success)throw Error('INVALID_QUALITY_REVIEW');const c=parsed.data;await dataAccess(actor,workspaceId,true);
 return db.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
  await tx.$queryRaw`SELECT id FROM "DashboardDataset" WHERE id=${datasetId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const member=await tx.dashboardMembership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId}}});if(!member||!['OWNER','EDITOR'].includes(member.role))throw Error('FORBIDDEN');await assertCustomPermission(actor,workspaceId,'datasets.write',tx);
  await tx.$queryRaw`SELECT id FROM "DashboardQualityIssue" WHERE id=${c.issueId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const issue=await tx.dashboardQualityIssue.findFirst({where:{id:c.issueId,workspaceId,check:{datasetId}}});if(!issue)throw Error('NOT_FOUND');if(revision(issue)!==c.expectedRevision)throw Error('QUALITY_CONFLICT');
  const dataset=await tx.dashboardDataset.findFirst({where:{id:datasetId,workspaceId,status:'READY'},include:{activeVersion:true}});if(!dataset)throw Error('DATASET_UNAVAILABLE');
  if(c.action==='RESOLVE_FIXED'){
   if(!dataset.activeVersion)throw Error('DATASET_UNAVAILABLE');
   await assertCurrentAnalysis(tx,workspaceId,datasetId,dataset.activeVersion.id,dataset.activeVersion.semanticRevision);
   const original=await tx.dashboardQualityCheck.findUniqueOrThrow({where:{id:issue.checkId}});
   if(!c.verificationCheckId||original.versionId===dataset.activeVersionId||!await tx.dashboardQualityCheck.count({where:{id:c.verificationCheckId,workspaceId,datasetId,versionId:dataset.activeVersionId!,status:'PASS',checkedAt:{not:null},kind:'DATASET_VALIDATION',AND:[{rule:{path:['semanticRevision'],equals:dataset.activeVersion.semanticRevision}},{rule:{path:['sourceChecksum'],equals:dataset.activeVersion.checksum}},...(issue.code==='DUPLICATE_ROWS'?[]:[{rule:{path:['scope'],equals:'GOVERNED'}}])]}}))throw Error('QUALITY_VERIFICATION_REQUIRED');
  }
  const oldDetails=issue.details&&typeof issue.details==='object'&&!Array.isArray(issue.details)?issue.details:{};
  await tx.dashboardQualityIssue.update({where:{id:issue.id},data:{resolvedAt:c.action==='RESOLVE_FIXED'?new Date():null,details:{...oldDetails,review:{action:c.action,note:c.note,verificationCheckId:c.verificationCheckId??null,at:new Date().toISOString(),actorIssuer:actor.issuer,actorSubject:actor.subject}} as Prisma.InputJsonValue}});
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'QUALITY_ISSUE_'+c.action,resourceType:'QUALITY',resourceId:issue.id,details:{datasetId,note:c.note,verificationCheckId:c.verificationCheckId??null,previousResolvedAt:issue.resolvedAt?.toISOString()??null}}});return {updated:true};
 });
}
