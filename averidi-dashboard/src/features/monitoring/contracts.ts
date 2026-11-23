import {PACE_METRICS} from '../../engines/metrics/target-pace';
import {CUSTOMER_PRODUCT_METRICS} from "../../engines/metrics/customer-product-metrics";
import {z} from 'zod';
import {METRIC_DEFINITIONS} from '../../engines/metrics/metric-engine';
import {MARKETING_METRIC_DEFINITIONS} from '../../engines/metrics/marketing-metrics';
import {INVENTORY_METRIC_DEFINITIONS} from '../../engines/metrics/inventory-metrics';
import {OPERATIONS_METRIC_DEFINITIONS} from '../../engines/metrics/operations-metrics';
export const monitoringMetrics=[...METRIC_DEFINITIONS,...CUSTOMER_PRODUCT_METRICS,...MARKETING_METRIC_DEFINITIONS,...INVENTORY_METRIC_DEFINITIONS,...OPERATIONS_METRIC_DEFINITIONS];
const metric=z.enum(monitoringMetrics.map(item=>item.key) as [string,...string[]]),id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),name=z.string().trim().min(1).max(120);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;});
export const targetSchema=z.object({direction:z.enum(["HIGHER","LOWER"]).nullable().optional(),pacing:z.enum(["NONE","LINEAR"]).default("NONE"),name,metricKey:metric,datasetId:id,value:z.number().finite().min(-1e18).max(1e18),start:day,through:day}).strict().refine(value=>value.pacing!=="LINEAR"||Boolean(value.direction&&value.value>0&&PACE_METRICS.has(value.metricKey))).refine(value=>value.start<=value.through&&value.through<'9999-12-31'&&Date.parse(value.through)-Date.parse(value.start)<=3660*86400000);
export const alertConditionSchema=z.object({operator:z.enum(['GT','GTE','LT','LTE']),threshold:z.number().finite().optional(),datasetId:id.optional(),currency:z.string().regex(/^[A-Z]{3}$/).nullable().optional(),definitionVersion:z.string().min(1).max(128).optional()}).strict();
export const alertSchema=z.object({name,metricKey:metric,datasetId:id,operator:z.enum(['GT','GTE','LT','LTE']),threshold:z.number().finite().min(-1e18).max(1e18).optional(),targetId:id.nullable().default(null),enabled:z.boolean().default(true)}).strict().refine(value=>(value.threshold!==undefined)!==(value.targetId!==null));
export const mutationSchema=z.object({id,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();

export type DashboardTargetAnnotations={items:{id:string;name:string;metricKey:string;value:string;currency:string|null;start:string;through:string;observedThrough:string;pace?:ReturnType<typeof import("../../engines/metrics/target-pace").targetPace>}[];hasMore:boolean};
