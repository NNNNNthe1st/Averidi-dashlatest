import {z} from 'zod';
import {definitionSchema} from '../features/views/validation';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const file=z.object({datasetId:id,versionId:id,format:z.enum(['csv','json','xlsx']),worksheetName:z.string().min(1).max(120).optional(),csvDelimiter:z.enum([',',';','\t']).optional(),preserveTextFields:z.array(z.string().min(1).max(120)).max(100).optional()}).strict().refine(p=>!p.worksheetName||p.format==='xlsx');
const version=z.object({datasetId:id,versionId:id}).strict();
const analysis=version.extend({semanticRevision:z.number().int().nonnegative(),template:definitionSchema.shape.template.optional()}).strict();
export const operation=z.discriminatedUnion('type',[
 z.object({type:z.literal('DROP_DUPLICATES')}).strict(),
 z.object({type:z.literal('FILL_EMPTY'),field:z.string().min(1).max(120),value:z.union([z.string().max(512),z.number().finite(),z.boolean()])}).strict(),
 z.object({type:z.literal('REPLACE_VALUE'),field:z.string().min(1).max(120),from:z.union([z.string().max(512),z.number().finite(),z.boolean(),z.null()]),value:z.union([z.string().max(512),z.number().finite(),z.boolean(),z.null()])}).strict(),
 z.object({type:z.literal('TRIM'),field:z.string().min(1).max(120)}).strict(),
 z.object({type:z.literal('RENAME'),field:z.string().min(1).max(120),to:z.string().trim().min(1).max(120)}).strict(),
 z.object({type:z.literal('FILTER_EQUALS'),field:z.string().min(1).max(120),value:z.union([z.string().max(512),z.number().finite(),z.boolean(),z.null()])}).strict(),
 z.object({type:z.literal('DROP_EMPTY'),field:z.string().min(1).max(120)}).strict(),
]);
export const workerPayloadSchemas={
 DATASET_PROFILE:file,DATASET_INGEST:file,DATASET_ANALYZE:analysis,METRICS_CALCULATE:analysis,
 DATASET_VALIDATE:version,
 DATASET_JOIN:z.object({relationshipId:id,expectedUpdatedAt:z.iso.datetime(),name:z.string().trim().min(1).max(120)}).strict(),
 DATASET_TRANSFORM:version.extend({operations:z.array(operation).min(1).max(20)}).strict(),
 DASHBOARD_GENERATE:z.object({datasetId:id,analysisId:id,template:definitionSchema.shape.template,name:z.string().trim().min(1).max(120).optional()}).strict(),
 SOURCE_REFRESH:z.union([z.object({datasetId:id,sourceId:id}).strict(),z.object({datasetId:id,versionId:id,format:z.enum(['csv','json','xlsx']),worksheetName:z.string().min(1).max(120).optional(),sourceId:id}).strict().refine(p=>!p.worksheetName||p.format==='xlsx')]),
 ALERTS_EVALUATE:z.object({ruleId:id,analysisId:id}).strict(),
 REPORT_GENERATE:z.object({reportId:id,scheduleId:id.optional()}).strict(),
 REPORT_DELIVER:z.object({deliveryId:id}).strict(),
 DATA_CLEANUP:z.object({temporaryKeys:z.array(z.string().max(512)).max(100).default([]),expiredReports:z.boolean().default(true),lifecycle:z.enum(['PLAN','APPLY']).optional()}).strict(),
} as const;
export type DashboardJobKind=keyof typeof workerPayloadSchemas;
export function normalizeWorkerPayload<K extends DashboardJobKind>(kind:K,payload:unknown):z.infer<(typeof workerPayloadSchemas)[K]>;
export function normalizeWorkerPayload(kind:string,payload:unknown):Record<string,unknown>;
export function normalizeWorkerPayload(kind:string,payload:unknown){
 const schema=Object.prototype.hasOwnProperty.call(workerPayloadSchemas,kind)?workerPayloadSchemas[kind as DashboardJobKind]:null;
 if(!schema)throw Error('UNSUPPORTED_JOB_KIND');
 const parsed=schema.safeParse(payload);if(!parsed.success)throw Error('INVALID_JOB_PAYLOAD');return parsed.data;
}
export const workerJobKinds=Object.keys(workerPayloadSchemas) as DashboardJobKind[];
export function requiredWorkerCapabilities(env:Partial<NodeJS.ProcessEnv>=process.env){return [...workerJobKinds,'SOURCE_MONITORING',...(env.DASHBOARD_ACCOUNT_ERASURE_ENABLED==='true'?['ACCOUNT_ERASURE']:[]),...(env.DASHBOARD_QUERY_CACHE_ENABLED==='true'?['QUERY_CACHE']:[])];}
export const deliveryRecipientsSchema=z.array(z.object({userId:id}).strict()).min(1).max(100).refine(v=>new Set(v.map(x=>x.userId)).size===v.length);
