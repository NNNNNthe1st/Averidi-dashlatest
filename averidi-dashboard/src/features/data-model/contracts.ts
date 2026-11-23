import {z} from 'zod';
import {mappingSchema,joinTypeSchema} from './engine';
export const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const bindingSchema=z.object({version:z.literal(1),leftDatasetId:id,rightDatasetId:id,leftVersionId:id,rightVersionId:id,leftChecksum:z.string().regex(/^[a-f0-9]{64}$/),rightChecksum:z.string().regex(/^[a-f0-9]{64}$/),mappings:mappingSchema,joinType:joinTypeSchema}).strict();
