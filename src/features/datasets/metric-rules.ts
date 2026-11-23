import {unitRulesSchema} from '../../engines/metrics/units';
import {rowGrains} from "../../engines/understanding/row-grain";
import { z } from "zod";
import { UNKNOWN_METRIC_SEMANTICS } from "../../engines/metrics/metric-catalog";

// Independent, version-bound confirmation of business calculation assumptions.
// Never infer consent from profile confidence or a field-name suggestion.
const confirmedCalendarDate=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;};
export const metricRulesSchema = z.object({
  versionId: z.string().min(1).max(128),
  timezone: z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat("en-US",{timeZone:value});return true;}catch{return false;}},"Invalid business timezone").nullable().optional(),
  grain: z.enum(rowGrains),
  rowAmountsConfirmed:z.boolean().optional(),
  units:unitRulesSchema.optional(),
  customerHistoryConfirmed:z.boolean().optional(),
  salesHistoryConfirmed:z.boolean().optional(),
  salesTargetAmount:z.number().finite().positive().optional(),
  salesBudgetAmount:z.number().finite().min(0).optional(),
  salesEligibleSellingDays:z.number().int().min(1).max(366).optional(),
  salesPlanningPeriodStart:z.string().refine(confirmedCalendarDate,'Invalid calendar start date').optional(),
  salesPlanningPeriodEnd:z.string().refine(confirmedCalendarDate,'Invalid calendar end date').optional(),
  salesPlanningBasisConfirmed:z.boolean().optional(),
  salesRepresentativeAttributionConfirmed:z.boolean().optional(),
  salesOpportunityCohortConfirmed:z.boolean().optional(),
  salesPipelineSnapshotConfirmed:z.boolean().optional(),
  salesCycleBasisConfirmed:z.boolean().optional(),
  salesPriceVolumeBasisConfirmed:z.boolean().optional(),
  salesForecastBasisConfirmed:z.boolean().optional(),
  salesForecastSeasonDays:z.number().int().min(1).max(366).optional(),
  salesForecastHorizonDays:z.number().int().min(1).max(366).optional(),
  salesCohortMonth:z.string().refine(value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||/^\\d{4}-(0[1-9]|1[0-2])$/.test(value),'Use YYYY-MM').optional(),
  salesVolatilityPeriodConfirmed:z.boolean().optional(),
  salesGrowthContributionBasisConfirmed:z.boolean().optional(),
  salesTopN:z.number().int().min(1).max(100).optional(),
  salesConcentrationConcept:z.enum(['CUSTOMER','PRODUCT','CHANNEL','GEOGRAPHY','CATEGORY']).optional(),
  salesRefundBasisConfirmed:z.boolean().optional(),
  salesReturnBasisConfirmed:z.boolean().optional(),
  salesDiscountBasisConfirmed:z.boolean().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  currencyMode: z.enum(["SINGLE","MULTI","UNSPECIFIED"]),
  revenueBasis: z.enum(["NET","GROSS","UNKNOWN"]),
  costBasis: z.enum(["COGS","UNKNOWN"]),
  refundsIncluded: z.boolean().nullable(),
  discountsIncluded: z.boolean().nullable(),
  taxIncluded: z.boolean().nullable(),
  shippingIncluded: z.boolean().nullable(),
  cancellationTreatment: z.enum(["UNKNOWN","ALREADY_EXCLUDED","EXCLUDE_ROWS"]),
  returnTreatment: z.enum(["UNKNOWN","ALREADY_NETTED","DEDUCT_RETURNED_UNITS"]),
  marketingAttribution:z.enum(["UNCONFIRMED","SOURCE_REPORTED"]).optional(),
  marketingSpendDeduplicated:z.boolean().optional(),
  marketingAcquisitionsConfirmed:z.boolean().optional(),
  inventorySnapshotConfirmed:z.boolean().optional(),
  inventorySnapshotUniqueProducts:z.boolean().optional(),
  inventoryDemandPeriodDays:z.number().int().min(1).max(366).optional(),
  inventoryLeadTimeDays:z.number().positive().max(365).optional(),
  inventorySafetyDays:z.number().min(0).max(365).optional(),
  inventoryTurnoverPeriodConfirmed:z.boolean().optional(),
  operationsPeriodConfirmed:z.boolean().optional(),
  operationsHoursBasisConfirmed:z.boolean().optional(),
  operationsCycleTimeBasisConfirmed:z.boolean().optional(),
  operationsErrorsAreDefectiveUnits:z.boolean().optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.salesPlanningPeriodStart&&value.salesPlanningPeriodEnd&&value.salesPlanningPeriodStart>value.salesPlanningPeriodEnd)ctx.addIssue({code:'custom',message:'Sales planning end must not precede start.'});
  if(value.currencyMode==="SINGLE"&&!value.currency)ctx.addIssue({code:"custom",message:"A single-currency dataset requires a currency."});
  if(value.currencyMode!=="SINGLE"&&value.currency)ctx.addIssue({code:"custom",message:"Currency may only be set for confirmed single-currency data."});
});

export type DashboardMetricRules=z.infer<typeof metricRulesSchema>;
export function metricRulesToEngineSemantics(input:DashboardMetricRules) {
  return {...UNKNOWN_METRIC_SEMANTICS,...(input.units&&Object.keys(input.units).length?{units:input.units}:{}),revenueBasis:input.revenueBasis,
    costBasis:input.costBasis,refundsIncluded:input.refundsIncluded,
    discountsIncluded:input.discountsIncluded,taxIncluded:input.taxIncluded,
    shippingIncluded:input.shippingIncluded,
    cancellationTreatment:input.cancellationTreatment,
    returnTreatment:input.returnTreatment,
    ...(["ORDER_ITEM","INVOICE_ITEM","INVOICE","DAY"].includes(input.grain)?{rowGrain:input.grain,rowAmountsConfirmed:input.rowAmountsConfirmed===true}:{})};
}
