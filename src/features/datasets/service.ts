import {normalizeBusinessUnits} from '../../engines/metrics/units';
import {grainSuggestionSchema} from "../../engines/understanding/row-grain";
import {setAuditActor} from '../audit/context';
import {ANALYSIS_ENGINE_VERSION} from "../../engines/analysis/pipeline";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { validateFieldConfirmations } from "./field-confirmation";
import { metricRulesSchema } from "./metric-rules";
import { dashboardDb } from "../../server/db";
import { requireWorkspaceRole, type VerifiedDashboardActor } from "../../server/workspace-access";

export const datasetNameSchema = z.string().trim().min(1).max(120);

export async function listWorkspaceDatasets(actor: VerifiedDashboardActor, workspaceId: string) {
  const access = await requireWorkspaceRole(actor, workspaceId, "VIEWER");
  if (!access) return null;
  const datasets = await dashboardDb.dashboardDataset.findMany({
    where: { workspaceId },
    select: { id: true, name: true, status: true, activeVersionId: true, createdAt: true, updatedAt: true,
      source:{select:{kind:true,status:true,lastSyncedAt:true,lastErrorCode:true}},
      versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, status: true, semantics: true, profiledAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const activeVersions=await dashboardDb.dashboardDatasetVersion.findMany({
    where:{id:{in:datasets.flatMap(item=>item.activeVersionId?[item.activeVersionId]:[])}},
    select:{id:true,version:true,semantics:true,profiledAt:true,semanticRevision:true},
  });
  const analyses=await dashboardDb.dashboardAnalysisRun.findMany({where:{workspaceId,versionId:{in:activeVersions.map(v=>v.id)},engineVersion:ANALYSIS_ENGINE_VERSION},select:{versionId:true,semanticRevision:true,status:true}});
  const activeById=new Map(activeVersions.map(version=>[version.id,version]));
  return datasets.map(({versions,activeVersionId,...dataset})=>{
    const latest=activeById.get(activeVersionId??"");
    const newest=versions[0];
    const semantics=latest?.semantics;
    const confirmed=Boolean(semantics&&typeof semantics==="object"&&!Array.isArray(semantics)&&"confirmationRequired" in semantics&&semantics.confirmationRequired===false);
    const rawFields=semantics&&typeof semantics==="object"&&!Array.isArray(semantics)&&"fields" in semantics&&Array.isArray(semantics.fields)?semantics.fields:[];
    // Return only proposed field names and business concepts, never row values or raw metadata.
    // Suggestions remain advisory regardless of their inference confidence.
    const suggestedMappings=rawFields.slice(0,100).flatMap((field:unknown)=>{
      if(!field||typeof field!=="object"||Array.isArray(field))return [];
      const entry=field as Record<string,unknown>;
      if(typeof entry.sourceName!=="string"||typeof entry.businessConcept!=="string")return [];
      return [{sourceField:entry.sourceName,proposedConcept:entry.businessConcept}];
    });
    const recorded=semantics&&typeof semantics==="object"&&!Array.isArray(semantics)&&"confirmedMappings" in semantics&&Array.isArray(semantics.confirmedMappings)?semantics.confirmedMappings:[];
    const confirmedMappings=recorded.flatMap((entry:unknown)=>{
      if(!entry||typeof entry!=="object"||Array.isArray(entry))return [];
      const row=entry as Record<string,unknown>;
      return typeof row.sourceField==="string"&&typeof row.canonicalConcept==="string"?[{sourceField:row.sourceField,canonicalConcept:row.canonicalConcept}]:[];
    });
    const metricRules=semantics&&typeof semantics==="object"&&!Array.isArray(semantics)&&"metricRules" in semantics?metricRulesSchema.safeParse(semantics.metricRules):null;
    const ontology=semantics&&typeof semantics==="object"&&!Array.isArray(semantics)&&"ontology" in semantics?semantics.ontology:null;
    const suggestion=grainSuggestionSchema.safeParse(ontology&&typeof ontology==="object"&&!Array.isArray(ontology)&&"datasetGrain" in ontology?ontology.datasetGrain:null);
    const analysis=analyses.find(a=>a.versionId===latest?.id&&a.semanticRevision===latest?.semanticRevision);
    return {...dataset,analysisStatus:analysis?.status??null,latestVersionId:latest?.id??null,metricConfirmationRequired:!confirmed,grainSuggestion:suggestion.success?suggestion.data:null,pendingVersionId:newest?.status==="PENDING"?newest.id:null,suggestedMappings,confirmedMappings,metricRules:metricRules?.success?metricRules.data:null};
  });
}

export async function createWorkspaceDataset(actor: VerifiedDashboardActor, workspaceId: string, input: unknown) {
  const access = await requireWorkspaceRole(actor, workspaceId, "EDITOR");
  if (!access) return { ok: false as const, error: "FORBIDDEN" as const };
  const parsed = datasetNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "INVALID_NAME" as const };
  const dataset = await dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
    const membership=await tx.dashboardMembership.findUnique({
      where:{userId_workspaceId:{userId:actor.userId,workspaceId}},select:{role:true},
    });
    if(!membership||!["OWNER","EDITOR"].includes(membership.role))return null;
    const source=await tx.dashboardDataSource.create({
      data:{workspaceId,name:parsed.data,kind:"FILE",status:"CONNECTED"},
      select:{id:true},
    });
    return tx.dashboardDataset.create({
      data:{workspaceId,name:parsed.data,sourceId:source.id},
      select:{id:true,name:true,status:true},
    });
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  if(!dataset)return {ok:false as const,error:"FORBIDDEN" as const};
  return { ok: true as const, dataset };
}

/**
 * Persist explicit field choices on the immutable dataset version's metadata.
 * Confirmation of field meaning alone must not activate business metrics:
 * row grain, quality, currency and financial treatment remain unconfirmed.
 */
export async function confirmWorkspaceDatasetFields(
  actor: VerifiedDashboardActor, workspaceId: string, datasetId: string, input: unknown,
) {
  if (!await requireWorkspaceRole(actor,workspaceId,"EDITOR"))
    return {ok:false as const,error:"FORBIDDEN" as const};
  // Validate the input shape before any query; field membership is checked below.
  if (!input||typeof input!=="object"||Array.isArray(input))
    return {ok:false as const,error:"INVALID_CONFIRMATION" as const};
  const {fieldConfirmationSchema}=await import("./field-confirmation");
  const parsed=fieldConfirmationSchema.safeParse(input);
  if(!parsed.success)return {ok:false as const,error:"INVALID_CONFIRMATION" as const};
  return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
    const dataset=await tx.dashboardDataset.findFirst({
      where:{id:datasetId,workspaceId,status:"READY"},
      select:{activeVersionId:true,versions:{where:{id:parsed.data.versionId},take:1,select:{id:true,semantics:true,profiledAt:true}}},
    });
    if(!dataset)return {ok:false as const,error:"DATASET_UNAVAILABLE" as const};
    const latest=dataset.versions[0];
    if(!latest||dataset.activeVersionId!==parsed.data.versionId||!latest.profiledAt)
      return {ok:false as const,error:"VERSION_CONFLICT" as const};
    const semantics=latest.semantics;
    if(!semantics||typeof semantics!=="object"||Array.isArray(semantics))
      return {ok:false as const,error:"PROFILE_UNAVAILABLE" as const};
    const original=semantics as Record<string,unknown>;
    const names=Array.isArray(original.fields)?original.fields.flatMap(field=>{
      if(!field||typeof field!=="object"||Array.isArray(field))return [];
      const name=(field as Record<string,unknown>).sourceName;
      return typeof name==="string"?[name]:[];
    }):[];
    const validated=validateFieldConfirmations(parsed.data,names);
    if(!validated)return {ok:false as const,error:"INVALID_CONFIRMATION" as const};
    const retained={...original,confirmedMappings:validated.mappings.map(mapping=>({
      sourceField:mapping.sourceField,canonicalConcept:mapping.canonicalConcept,
      status:"CONFIRMED",role:mapping.canonicalConcept==="IGNORE"?"IGNORE":"DIMENSION",
    })),confirmationRequired:true};
    await tx.dashboardDatasetVersion.update({
      where:{id:latest.id},data:{semantics:retained as Prisma.InputJsonValue,semanticRevision:{increment:1}},
    });
    return {ok:true as const,versionId:latest.id,mappingCount:validated.mappings.length,metricConfirmationRequired:true as const};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}

/** Confirm explicit business rules without treating advisory mappings as calculated metrics. */
export async function confirmWorkspaceDatasetMetricRules(
  actor: VerifiedDashboardActor, workspaceId: string, datasetId: string, input: unknown,
) {
  if(!await requireWorkspaceRole(actor,workspaceId,"EDITOR"))
    return {ok:false as const,error:"FORBIDDEN" as const};
  const parsed=metricRulesSchema.safeParse(input);
  if(!parsed.success)return {ok:false as const,error:"INVALID_RULES" as const};
  return dashboardDb.$transaction(async tx=>{await setAuditActor(tx,actor,'APPLICATION');
    const dataset=await tx.dashboardDataset.findFirst({
      where:{id:datasetId,workspaceId,status:"READY"},
      select:{activeVersionId:true,versions:{where:{id:parsed.data.versionId},take:1,select:{id:true,semantics:true,profiledAt:true}}},
    });
    if(!dataset)return {ok:false as const,error:"DATASET_UNAVAILABLE" as const};
    const latest=dataset.versions[0];
    if(!latest||dataset.activeVersionId!==parsed.data.versionId||!latest.profiledAt)
      return {ok:false as const,error:"VERSION_CONFLICT" as const};
    const semantics=latest.semantics;
    if(!semantics||typeof semantics!=="object"||Array.isArray(semantics))
      return {ok:false as const,error:"PROFILE_UNAVAILABLE" as const};
    try{const mappings=(semantics as {confirmedMappings?:{sourceField:string;canonicalConcept:string}[]}).confirmedMappings??[];normalizeBusinessUnits([],mappings,parsed.data.units);}catch{return {ok:false as const,error:'INVALID_RULES' as const};}
    const retained={...(semantics as Record<string,unknown>),metricRules:parsed.data,confirmationRequired:true};
    await tx.dashboardDatasetVersion.update({
      where:{id:latest.id},data:{semantics:retained as Prisma.InputJsonValue,semanticRevision:{increment:1}},
    });
    // Independent quality verification and version-bound calculation are still necessary.
    return {ok:true as const,versionId:latest.id,metricConfirmationRequired:true as const};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
