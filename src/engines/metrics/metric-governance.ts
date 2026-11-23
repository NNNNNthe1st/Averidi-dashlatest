import {createHash} from "node:crypto";
import type {MetricDefinition,MetricSemantics} from "./metric-engine";

/** Stable, deterministic identity for a governed metric contract.
 * Version changes whenever the definition or its confirmed commercial
 * semantics change. Used by dashboards, chart service and exported reports.
 * This is not a replacement for a historical governance audit ledger. */
export function dashboardMetricGovernanceVersion(definition:MetricDefinition,policy:MetricSemantics):string{
 const canonical={
  key:definition.key,formula:definition.formula,requires:definition.requires,
  format:definition.format,revenueBasis:policy.revenueBasis,costBasis:policy.costBasis,
  refundsIncluded:policy.refundsIncluded,discountsIncluded:policy.discountsIncluded,
  taxIncluded:policy.taxIncluded,shippingIncluded:policy.shippingIncluded,
  cancellationTreatment:policy.cancellationTreatment??"UNKNOWN",
  returnTreatment:policy.returnTreatment??"UNKNOWN",
  ...(policy.units?{units:policy.units}:{}),
  ...(policy.rowGrain?{rowGrain:policy.rowGrain,rowAmountsConfirmed:policy.rowAmountsConfirmed===true}:{}),
 };
 return "v1-"+createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0,20);
}
