import {auditedWrite} from '../audit/service';
import {workspaceQuotaUsage} from '../quotas/service';
import {setAuditActor} from '../audit/context';
import {workspacePolicy} from '../permissions/policy';
import {authorizedView,viewAccessWhere} from "../sharing/access";
import {currentAnalysis,assertCurrentAnalysis} from "../analysis/service";
import {validateGovernedDefinition} from "../analysis/views";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { dashboardDb } from "../../server/db";
import { requireWorkspaceRole, type VerifiedDashboardActor } from "../../server/workspace-access";
import { createViewSchema, definitionSchema, preservesViewMetricBindings } from "./validation";

export async function listWorkspaceViews(actor: VerifiedDashboardActor, workspaceId: string) {
  const member=await requireWorkspaceRole(actor, workspaceId, "VIEWER");if(!member)return null;
  const [rows,policy]=await Promise.all([
    dashboardDb.dashboardView.findMany({
      where: { workspaceId,AND:[viewAccessWhere(member,actor.userId)] },
      select: { id:true, name:true, datasetId:true, analysisId:true, definition:true, updatedAt:true },
      orderBy: { updatedAt:"desc" },
      take:100,
    }),
    workspacePolicy(actor.userId,workspaceId),
  ]);
  const editable=member.role==='EDITOR'?await dashboardDb.dashboardView.findMany({where:{workspaceId,id:{in:rows.map(r=>r.id)},AND:[viewAccessWhere(member,actor.userId,'EDIT')]},select:{id:true}}):[];
  const editableIds=new Set(editable.map(view=>view.id));
  return rows.map(row=>({...row,canEdit:!!policy?.permissions.includes('views.manage')&&(member.role==='OWNER'||editableIds.has(row.id))}));
}

export async function createWorkspaceView(actor: VerifiedDashboardActor, workspaceId: string, input: unknown) {
  if (!await requireWorkspaceRole(actor, workspaceId, "EDITOR"))
    return {ok:false as const,error:"FORBIDDEN" as const};
  const validated=createViewSchema.safeParse(input);
  if (!validated.success) return {ok:false as const,error:"INVALID_VIEW" as const};
  const {datasetId,definition}=validated.data;
  // Enforce tenant membership through the dataset/workspace pair.
  const dataset=await dashboardDb.dashboardDataset.findFirst({
    where:{id:datasetId,workspaceId,status:"READY"},
    select:{id:true},
  });
  if (!dataset) return {ok:false as const,error:"DATASET_UNAVAILABLE" as const};
  // A READY dataset is profiled, not necessarily semantically confirmed.
  // Metric-bearing definitions must use the separate governed generation endpoint.
  // This closes the direct-API bypass of the Studio eligibility controls.
  if (definition.widgets.length>0) return {ok:false as const,error:"METRICS_NOT_CONFIRMED" as const};
  const view=await auditedWrite(actor,async tx=>{
    const dashboardQuota=(await workspaceQuotaUsage(workspaceId,tx)).resources.find(resource=>resource.key==='dashboards');
    if(dashboardQuota?.remaining==='0')throw Error('DASHBOARD_QUOTA_EXCEEDED:dashboards');
    return tx.dashboardView.create({
    data:{workspaceId,datasetId,name:definition.name,definition:definition as Prisma.InputJsonValue},
    select:{id:true,name:true,datasetId:true,updatedAt:true},
  });});
  return {ok:true as const,view};
}

export async function updateWorkspaceView(actor: VerifiedDashboardActor,workspaceId:string,viewId:string,definition:unknown,expectedUpdatedAt:unknown) {
  if (!await requireWorkspaceRole(actor,workspaceId,"EDITOR"))
    return {ok:false as const,error:"FORBIDDEN" as const};
  try{await authorizedView(actor,workspaceId,viewId,'EDIT');}catch{return {ok:false as const,error:"FORBIDDEN" as const};}
  const timestamp=z.string().datetime({offset:true}).safeParse(expectedUpdatedAt);
  if(!timestamp.success)return {ok:false as const,error:"INVALID_VERSION" as const};
  const validated=definitionSchema.safeParse(definition);
  if(!validated.success) return {ok:false as const,error:"INVALID_VIEW" as const};
  // Linked views validate every customization against current governed outcomes;
  // legacy definitions retain the original immutable binding rule.
  const previous=await dashboardDb.dashboardView.findFirst({
    where:{id:viewId,workspaceId},
    select:{definition:true,analysisId:true,datasetId:true},
  });
  if(!previous)return {ok:false as const,error:"NOT_FOUND" as const};
  let governed:Awaited<ReturnType<typeof currentAnalysis>>|null=null;
  if(previous.analysisId){
    try{governed=await currentAnalysis(workspaceId,previous.datasetId,previous.analysisId);validateGovernedDefinition(validated.data,governed.result);}catch{return {ok:false as const,error:"STALE_OR_INVALID_ANALYSIS" as const};}
    const old=definitionSchema.safeParse(previous.definition);
    if(!old.success||old.data.template!==validated.data.template||old.data.templateVersion!==validated.data.templateVersion)return {ok:false as const,error:"METRIC_BINDINGS_IMMUTABLE" as const};
  }
  if(!governed&&!preservesViewMetricBindings(previous.definition,validated.data))
    return {ok:false as const,error:"METRIC_BINDINGS_IMMUTABLE" as const};
  // updateMany includes the workspace predicate to avoid cross-tenant writes.
  const changed=await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
    await authorizedView(actor,workspaceId,viewId,'EDIT',tx);
    if(governed)await assertCurrentAnalysis(tx,workspaceId,previous.datasetId,governed.version.id,governed.version.semanticRevision);
    const updated=await tx.dashboardView.updateMany({
    where:{id:viewId,workspaceId,updatedAt:new Date(timestamp.data)},
    data:{name:validated.data.name,definition:validated.data as Prisma.InputJsonValue,updatedAt:new Date(Math.max(Date.now(),Date.parse(timestamp.data)+1))},
  });
    const row=updated.count?await tx.dashboardView.findFirst({where:{id:viewId,workspaceId},select:{updatedAt:true}}):null;return {...updated,updatedAt:row?.updatedAt.toISOString()??null};
  });
  if(changed.count===1) {
    return {ok:true as const,updatedAt:changed.updatedAt};
  }
  const existing=await dashboardDb.dashboardView.findFirst({where:{id:viewId,workspaceId},select:{id:true}});
  return {ok:false as const,error:existing?"CONFLICT" as const:"NOT_FOUND" as const};
}
