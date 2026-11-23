import { z } from "zod";

// A field-name choice is not confirmation of grain, revenue treatment, currency,
// data quality or any other precondition of the governed metric engine.
export const confirmedConcepts = [
  "REVENUE","COST","QUANTITY","ORDER","SALES_REPRESENTATIVE","SALES_OPPORTUNITY_OPENED","SALES_OPPORTUNITY_CLOSED","SALES_OPPORTUNITY_ID","SALES_OPPORTUNITY_STAGE","SALES_OPPORTUNITY_QUALIFIED","SALES_OPEN_PIPELINE_VALUE","INVOICE","LINE_ITEM","CUSTOMER","PRODUCT","TIME",
  "CATEGORY","SUBCATEGORY","CHANNEL","CUSTOMER_SEGMENT","GEOGRAPHY","STATUS","PRE_DISCOUNT_SALES","REFUND_ELIGIBLE_SALES","GROSS_SOLD_QUANTITY","MARKETING_SPEND","MARKETING_LEADS","MARKETING_CONVERSIONS","MARKETING_ACQUISITIONS","ATTRIBUTED_REVENUE","INVENTORY_ON_HAND","INVENTORY_DEMAND","INVENTORY_STOCKOUT","INVENTORY_COGS","INVENTORY_AVG_VALUE","INVENTORY_VALUE","OPERATIONS_COMPLETED","OPERATIONS_HOURS","OPERATIONS_CYCLE_HOURS","OPERATIONS_ERRORS","OPERATIONS_INSPECTED","REFUND","DISCOUNT","RETURN_QUANTITY","IDENTIFIER","IGNORE",
] as const;

export const fieldConfirmationSchema = z.object({
  versionId: z.string().min(1).max(128),
  mappings: z.array(z.object({
    sourceField: z.string().min(1).max(120),
    canonicalConcept: z.enum(confirmedConcepts),
  }).strict()).min(1).max(100),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.mappings.map(item => item.sourceField)).size !== data.mappings.length) {
    ctx.addIssue({code:"custom",message:"Each source field may be confirmed once."});
  }
});

export function validateFieldConfirmations(input: unknown, suggestedFields: string[]) {
  const parsed = fieldConfirmationSchema.safeParse(input);
  if (!parsed.success) return null;
  const allowed = new Set(suggestedFields);
  if (!parsed.data.mappings.every(mapping => allowed.has(mapping.sourceField))) return null;
  return parsed.data;
}
