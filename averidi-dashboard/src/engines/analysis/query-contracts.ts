import {z} from "zod";
import {comparisonOptionsSchema} from "../metrics/comparison-periods";
export const analysisQuerySchema=z.object({
 filters:z.array(z.object({type:z.enum(['CATEGORY','DATE_RANGE','MISSING']),field:z.string().min(1).max(120),value:z.string().max(512),end:z.string().max(512).optional()}).strict().refine(filter=>filter.type!=='MISSING'||filter.value===''&&filter.end===undefined,'Missing-value filters cannot specify a category or end date.')).max(12).default([]),
 compare:z.boolean().default(false),
 comparison:comparisonOptionsSchema.optional(),
}).strict().superRefine((value,ctx)=>{if(value.comparison&&!value.compare)ctx.addIssue({code:'custom',message:'Enable comparison before choosing comparison options.'});});
export type AnalysisQuery=z.infer<typeof analysisQuerySchema>;

import {metricRulesSchema} from "../../features/datasets/metric-rules";
import {fieldConfirmationSchema,confirmedConcepts} from "../../features/datasets/field-confirmation";
import {resolveComparisonPeriods} from "../metrics/comparison-periods";
export const ANALYSIS_ENGINE_VERSION=8;
export const analysisConfirmationSchema=z.object({salesEngine:z.object({version:z.union([z.literal(2),z.literal(3)]),arithmetic:z.literal('DECIMAL')}).strict().optional(),confirmedMappings:z.array(fieldConfirmationSchema.shape.mappings.element.extend({canonicalConcept:z.enum([...confirmedConcepts,'CURRENCY']),status:z.literal("CONFIRMED").optional(),role:z.enum(["DIMENSION","MEASURE","IGNORE"]).optional()})).min(1).max(100),metricRules:metricRulesSchema}).passthrough();
export type AnalysisConfirmation=z.infer<typeof analysisConfirmationSchema>;
export function analysisComparisonPeriods(query:AnalysisQuery){
 if(!query.compare)return null;
 const dates=query.filters.filter(filter=>filter.type==='DATE_RANGE');if(dates.length!==1||!dates[0].end)throw Error('COMPARISON_REQUIRES_ONE_DATE_RANGE');
 return resolveComparisonPeriods(dates[0].value,dates[0].end,query.comparison);
}
export function effectiveAnalysisFilters(query:AnalysisQuery,periods=analysisComparisonPeriods(query)){
 return periods?query.filters.map(filter=>filter.type==='DATE_RANGE'?{...filter,value:periods.current.start,end:periods.current.end}:filter):query.filters;
}
