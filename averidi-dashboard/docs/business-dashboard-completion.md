# Requirements 100, 143, 149, 151 and 181

Original 375-roadmap numbers. Development is isolated to Dashboard; no production/server access, main merge or active inter-product connection.

| # | Implemented functionality |
|---:|---|
| 100 | Version-bound explicit measurement units, physical conversions, optional case packaging, compatible returned/stock/demand units, canonical lineage, labels/CSV and dimensional custom-formula safeguards. |
| 143 | Explicit higher/lower direction and optional uniform calendar-day pace, persisted target policy, on-track/ahead/behind and final met/missed status on matching KPI targets. |
| 149 | Confirmed-history acquisition, actual repeat-order counts/rates, adjacent equal-period active-customer retention, observed historical customer value, date-dependent customer dashboard widgets. |
| 151 | Product volume, governed net revenue/gross profit/margin and full-denominator revenue/profit contribution, with native product breakdown charts. |
| 181 | Debounced automatic dashboard configuration and page/layout persistence, serial writes, retained drafts on failure, explicit retry, revision conflicts and monotonic transaction-bound save tokens. |

## Units

Business-rule confirmation explicitly assigns a homogeneous unit to a source measure. kg/g/lb/oz convert to kg, litres/ml to litres, hours/minutes/seconds to hours and metres/cm to metres. Cases stay cases unless the customer supplies items per case. Original source bytes stay unchanged. Units are optional, preserving existing arithmetic and legacy governance identities when absent. Invalid/negative/nonfinite measures, incompatible related quantities and unit choices on non-measure fields are refused. Returned units and inventory stock/demand must resolve to compatible units. Physical inventory quantities preserve fractions rather than rounding to whole items. Unit labels reach calculation results, chart values, lineage and metric CSV. Custom formulas cannot add kilograms to order counts; per-unit monetary formulas retain their denominator dimension.

This workflow does not infer a packaging size or silently combine row-level mixed-unit values. Customers must normalize mixed-unit fields first. The explanatory unit editor says this explicitly.

## Customer dashboard

Repeat behavior counts distinct order identities per customer, not line rows. Conflicting order/customer/date ownership is refused. Acquisition means first purchase in the customer's confirmed complete loaded history. Retention is the intersection of current and previous equal-length active-customer sets divided by the previous set; no prior active population means unavailable. History-dependent metrics require explicit complete-history confirmation; acquisition and retention also need one confirmed valid business date/timezone and a selected period. Customer templates retain clear period-required widgets rather than falsely showing a zero. Filters and native calculations supply values after a date range is selected.

Observed customer value is historical net revenue over loaded history for the currently selected active customers divided by those customers. It is labeled as observed historical value, not a predicted future lifetime value. Existing refund/discount/cancellation/currency and monetary-grain rules remain authoritative. No external completeness or retention policy is guessed.

## Product dashboard

Product templates add native breakdowns by a confirmed product field where eligible. Revenue and gross-profit contribution use the same period and non-product filters with the full represented-product denominator; product selection/grouping does not turn every contribution into 100%. Gross-profit contribution preserves negative contributions and refuses a zero denominator. Product revenue, cost and margin still use the existing governed formulas and customer-confirmed monetary basis. Existing templates and saved configurations remain valid.

## Target pacing

Existing targets keep no direction and no pace by default. Customers explicitly choose direction and, for additive metrics only, uniform calendar-day accumulation. The chosen policy is persisted with the target and included in revision checks. It neither changes alert thresholds nor invents direction from the metric name.

KPI pace requires the exact existing dataset/metric/currency/full-period match and an explicitly supplied data-complete observed-through date in More comparison options. It does not infer elapsed coverage from the latest record or wall clock. Partial periods compare actual values to the customer's selected daily pace; completed observations give met/missed. Ratios and nonadditive metrics do not receive linear accumulation. Floating-point equality uses a numerical tolerance, not a business tolerance. Source completeness remains the customer's explicit observation claim, not a forecast.

## Autosave

Valid dashboard name, widget visibility/order/title, section labels and widget additions use the existing governed PATCH endpoint after a 900 ms pause. Pages/layout use the existing layout endpoint after the same pause. Explicit Save remains available. Saves serialize and preserve edits while in flight; invalid empty names wait for correction. Failed saves retain dirty local state, pause automatic retries and show an error. Explicit retry remains available; conflicts require reloading the authoritative revision. Existing unload/discard guards remain active.

View updates return the revision read inside the mutation transaction, with a monotonic timestamp, preventing an acknowledgement from adopting a later writer's token. Read-only/tenant/entitlement/analysis guards and layout ownership validation remain enforced. Business-rule confirmation, uploads, billing and other consent-requiring operations are not silently autosaved.

## Verification

Eight new regression cases exercise exact conversion, case size, unit refusal, formula dimensions, customer cohorts/value, period-required configuration, full product denominators, target pacing, native worker storage/generation/tenant access and concurrent stale-write refusal. The HTTPS fixture exercises automatic configuration persistence/reload, failed-save retained draft, paused retry and restoration. Existing layout acceptance now waits for automatic persistence and still verifies reload, drag, resize, pages and mobile accessibility.

Final executed evidence is recorded in the architecture progress document. Local acceptance does not constitute production deployment approval.
