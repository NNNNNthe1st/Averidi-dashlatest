import {SALES_EXTENDED_DEFINITIONS} from "../../engines/metrics/sales-extended-metrics";
import {CUSTOMER_PRODUCT_METRICS} from "../../engines/metrics/customer-product-metrics";
import { z } from "zod";
import { METRIC_DEFINITIONS } from "../../engines/metrics/metric-engine";
import { MARKETING_METRIC_DEFINITIONS } from "../../engines/metrics/marketing-metrics";
import { OPERATIONS_METRIC_DEFINITIONS } from "../../engines/metrics/operations-metrics";
import { INVENTORY_METRIC_DEFINITIONS } from "../../engines/metrics/inventory-metrics";
import { DASHBOARD_SECTION_DEFAULTS } from "../../engines/generation/dashboard-templates";

const widgetKinds = ["KPI", "BAR", "LINE", "TABLE", "HORIZONTAL_BAR", "DONUT", "SALES_TREND"] as const;
const templateKeys = ["SALES","EXECUTIVE","CUSTOMER","FINANCIAL","PRODUCT","MARKETING","OPERATIONS","INVENTORY","CUSTOM"] as const;
const metricKeys = new Set([...METRIC_DEFINITIONS,...SALES_EXTENDED_DEFINITIONS,...CUSTOMER_PRODUCT_METRICS,...MARKETING_METRIC_DEFINITIONS,...INVENTORY_METRIC_DEFINITIONS,...OPERATIONS_METRIC_DEFINITIONS].map(x => x.key));
const widgetSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(widgetKinds),
  metricKey: z.string().refine(x => metricKeys.has(x as typeof METRIC_DEFINITIONS[number]["key"])),
  title: z.string().trim().min(1).max(80),
  secondaryMetricKey: z.string().refine(x => metricKeys.has(x as typeof METRIC_DEFINITIONS[number]["key"])).optional(),
  visible: z.boolean(),
  order: z.number().int().min(0).max(1000),
  dimensionField: z.string().min(1).max(120).optional(),
}).strict();
export const definitionSchema = z.object({
  schemaVersion: z.literal(1),
  template: z.enum(templateKeys),
  templateVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  sectionTitles: z.record(z.string(),z.string().trim().min(1).max(80)).optional(),
  widgets: z.array(widgetSchema).max(100),
}).strict().superRefine((data,ctx) => {
  if (data.sectionTitles) for (const key of Object.keys(data.sectionTitles)) {
    if (!(key in DASHBOARD_SECTION_DEFAULTS)) ctx.addIssue({code:"custom",message:"Unknown dashboard section."});
  }
  if (new Set(data.widgets.map(x=>x.id)).size !== data.widgets.length)
    ctx.addIssue({code:"custom",message:"Duplicate widget identifiers."});
  if (new Set(data.widgets.map(x=>x.order)).size !== data.widgets.length)
    ctx.addIssue({code:"custom",message:"Duplicate widget ordering."});
});
export const createViewSchema = z.object({
  datasetId: z.string().min(1).max(128),
  definition: definitionSchema,
}).strict();


/** Studio edits can change labels, visibility, ordering, and supported chart presentation,
 * but cannot invent a metric, change its chart semantics or grouping source, or switch template lineage. */
export function preservesViewMetricBindings(previous:unknown,next:unknown):boolean {
  const before=definitionSchema.safeParse(previous);
  const after=definitionSchema.safeParse(next);
  if(!before.success||!after.success)return false;
  if(before.data.template!==after.data.template||before.data.templateVersion!==after.data.templateVersion||
     before.data.widgets.length!==after.data.widgets.length)return false;
  const existing=new Map(before.data.widgets.map(widget=>[widget.id,widget]));
  return after.data.widgets.every(widget=>{
    const old=existing.get(widget.id);
    return Boolean(old&&old.metricKey===widget.metricKey&&old.secondaryMetricKey===widget.secondaryMetricKey&&old.kind===widget.kind&&old.dimensionField===widget.dimensionField);
  });
}
