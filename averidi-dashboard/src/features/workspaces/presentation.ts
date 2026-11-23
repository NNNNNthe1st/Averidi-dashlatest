import {dashboardDb as db} from '../../server/db';
import {requireWorkspaceRole,type VerifiedDashboardActor} from '../../server/workspace-access';
import {setAuditActor} from '../audit/context';
import {workspacePresentationSchema,presentationChangeSchema} from './presentation-contracts';
import {workspacePolicy} from '../permissions/policy';
export async function readWorkspacePresentation(actor:VerifiedDashboardActor,workspaceId:string){
 if(!await requireWorkspaceRole(actor,workspaceId,'VIEWER'))throw Error('FORBIDDEN');
 if(!(await workspacePolicy(actor.userId,workspaceId))?.permissions.includes('workspace.read'))throw Error('FORBIDDEN');
 const row=await db.dashboardWorkspace.findUniqueOrThrow({where:{id:workspaceId},select:{presentation:true,presentationRevision:true}});
 return {presentation:row.presentation===null?null:workspacePresentationSchema.parse(row.presentation),revision:row.presentationRevision};
}
export async function updateWorkspacePresentation(actor:VerifiedDashboardActor,workspaceId:string,input:unknown){
 if(!await requireWorkspaceRole(actor,workspaceId,'OWNER'))throw Error('FORBIDDEN');
 const parsed=presentationChangeSchema.safeParse(input);if(!parsed.success)throw Error('INVALID_WORKSPACE_PRESENTATION');
 const value=parsed.data;
 return db.$transaction(async tx=>{
  await setAuditActor(tx,actor,'APPLICATION');
  // A concurrent removal/demotion cannot authorize a preference mutation.
  const member=await tx.$queryRaw<{role:string}[]>`SELECT role FROM "DashboardMembership" WHERE "workspaceId"=${workspaceId} AND "userId"=${actor.userId} FOR SHARE`;
  if(member[0]?.role!=='OWNER')throw Error('FORBIDDEN');
  const changed=await tx.dashboardWorkspace.updateMany({where:{id:workspaceId,presentationRevision:value.expectedRevision},data:{presentation:value.presentation,presentationRevision:{increment:1}}});
  if(changed.count!==1)throw Error('WORKSPACE_PRESENTATION_CONFLICT');
  await tx.dashboardAuditEvent.create({data:{workspaceId,actorIssuer:actor.issuer,actorSubject:actor.subject,action:'WORKSPACE_PRESENTATION_UPDATED',resourceType:'WORKSPACE',resourceId:workspaceId,details:{revision:value.expectedRevision+1}}});
  return {presentation:value.presentation,revision:value.expectedRevision+1};
 });
}
