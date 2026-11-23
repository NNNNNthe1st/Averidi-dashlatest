import {Prisma} from '@prisma/client';
import type {ErasureDecision} from './contracts';
export async function redactAccountEvidence(tx:Prisma.TransactionClient,decision:ErasureDecision,subjects:{issuer:string;subject:string}[]){
 await tx.$queryRaw`SELECT set_config('dashboard.erasure_subjects',${JSON.stringify(subjects)},true)`;
 const actorWhere=subjects.map(s=>({actorIssuer:s.issuer,actorSubject:s.subject}));
 if(actorWhere.length){
  await tx.dashboardAuditEvent.updateMany({where:{OR:actorWhere},data:{actorIssuer:'erased-account',actorSubject:decision.requestId}});
  await tx.dashboardOrganizationAuditEvent.updateMany({where:{OR:actorWhere},data:{actorIssuer:'erased-account',actorSubject:decision.requestId}});
  await tx.dashboardAdminAudit.updateMany({where:{OR:actorWhere},data:{actorIssuer:'erased-account',actorSubject:decision.requestId}});
 }
 // Remove private content from global administrative history of the erased owned workspaces.
 if(decision.workspaceIds.length)await tx.dashboardAdminAudit.updateMany({where:{workspaceId:{in:decision.workspaceIds}},data:{details:null}});
 const identityCondition=subjects.length?Prisma.sql`OR (${Prisma.join(subjects.map(s=>Prisma.sql`("actorIssuer"=${s.issuer} AND "actorSubject"=${s.subject})`),' OR ')})`:Prisma.empty;
 await tx.$executeRaw(Prisma.sql`UPDATE "DashboardMutationAudit" SET
  "userId"=CASE WHEN "userId"=${decision.userId} THEN NULL ELSE "userId" END,
  "actorUserId"=CASE WHEN "actorUserId"=${decision.userId} THEN NULL ELSE "actorUserId" END,
  "actorIssuer"=CASE WHEN "actorUserId"=${decision.userId} ${identityCondition} THEN 'erased-account' ELSE "actorIssuer" END,
  "actorSubject"=CASE WHEN "actorUserId"=${decision.userId} ${identityCondition} THEN ${decision.requestId} ELSE "actorSubject" END
 WHERE "userId"=${decision.userId} OR "actorUserId"=${decision.userId} ${identityCondition}`);
}
