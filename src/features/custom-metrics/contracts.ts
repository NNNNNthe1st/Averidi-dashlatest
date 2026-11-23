import {z} from 'zod';
import {analysisQuerySchema,analysisConfirmationSchema} from '../../engines/analysis/query-contracts';
import {id} from '../data-model/contracts';
export const formulaDefinitionSchema=z.object({datasetId:id,analysisId:id,name:z.string().trim().min(1).max(120),description:z.string().trim().min(10).max(1000),expression:z.string().trim().min(1).max(512),format:z.enum(['NUMBER','CURRENCY','PERCENT']),query:analysisQuerySchema.refine(q=>q.compare===false),confirmed:z.literal(true)}).strict();
export const storedFormulaSchema=z.object({kind:z.literal('CUSTOM_FORMULA'),version:z.literal(1),definition:formulaDefinitionSchema,basis:analysisConfirmationSchema.pick({confirmedMappings:true,metricRules:true}),source:z.object({versionId:id,checksum:z.string().regex(/^[a-f0-9]{64}$/),semanticRevision:z.number().int().nonnegative(),engineVersion:z.number().int().positive()}),preview:z.object({value:z.string(),units:z.record(z.string(),z.number()),currency:z.string().nullable(),inputs:z.array(z.unknown()),references:z.array(z.string())}),reviewToken:z.string().regex(/^[a-f0-9]{64}$/),calculatedAt:z.iso.datetime()}).strict();
export const formulaCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('PREVIEW'),definition:formulaDefinitionSchema}).strict(),
 z.object({action:z.literal('CREATE'),definition:formulaDefinitionSchema,expectedPreview:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('UPDATE'),id,expectedUpdatedAt:z.iso.datetime(),definition:formulaDefinitionSchema,expectedPreview:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('DELETE'),id,expectedUpdatedAt:z.iso.datetime()}).strict(),
]);
