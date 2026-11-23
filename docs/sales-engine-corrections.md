# Sales engine corrections — 31 October 2026

This change addresses the eight failures reproduced against `bb60b850d695130f61747586a80c9ddeb0da6cc9`. It does not certify every enterprise BI capability or every external production service.

| Reproduced failure | Result after correction |
| --- | --- |
| Running totals / averages were inferred as additive sales | Non-additive headers are retained as additional fields and are excluded from automatic transaction-amount mappings. Two cumulative values of 100 and 150 are not summed into 250 of sales. Opening balances, resets and reporting partitions are not invented. Explicit customer field corrections remain possible. |
| Replacing the revenue field reused its old accounting answers | Changes to relevant monetary roles clear legacy and individual accounting facts from both retained answers and the submitted draft. New facts must be established for the selected fields. The database regression verifies this even when the client submits the previous entire answer draft. |
| Quantity and unit price could not produce sales | A complete quantity and unit-price pair derives a recorded amount with decimal multiplication. Accounting treatment is established separately. Quantity 2 × price 20 produces 40; quantity 2 × unit cost 8 produces cost 16. |
| Undeducted discounts had no calculation path | Individual answers connect complete, nonnegative discount/refund/tax/delivery amount fields to an explicit net-sales projection. Included adjustments are not deducted again. Missing required adjustment values remain blocked with an explanation. Sales 100 less an undeducted discount of 10 produces 90. |
| Cancelled/pending orders had no usable Sales decision | Setup asks whether to calculate completed/paid sales only. A confirmed selection excludes recognized cancelled, void, open, pending and processing rows consistently before metrics and custom measures. Unknown statuses remain blocked for review. Original records are preserved. |
| Single-currency recovery was not usable | Setup offers the available currencies; the chosen population is saved in the Sales snapshot. Currency is also a query dimension. History, comparisons, custom formatting and chart calculations use the selected currency. No exchange rates are assumed or currencies combined. |
| Group limits ignored the selection and could break the whole dashboard | Group budgets use current selected members, while their matching prior rows remain available for comparison. Oversized Sales charts explain how to narrow the selection; headline totals and filter controls remain usable. Other templates retain their existing limit behavior. |
| Core and period totals disagreed numerically | Sales daily series retain exact decimal lineage; month/quarter/year-to-date, rolling totals, cumulative totals and moving daily averages consume those decimal amounts. The reproduced large-credit case now returns 0.01 in both core and period totals. Statistical/forecast routines are not all rewritten by this change. |

The reference HTML and generated reference stylesheet are unchanged. Changes to setup add required business selections; they do not replace the approved Sales presentation. No schema migration, production deployment or main-branch change is included.

## Validation

- 130 Sales/workflow checks pass, including ten new regression tests covering the failures, missing/unknown inputs, currency-isolated comparisons, chart limits and retained prior-period groups.
- 17 checks pass in fresh migrated SQL fixtures with a restricted runtime role. These include actual upload/worker/preparation, remapping, snapshot reopen, query-dependent chart availability, currency selection, view refresh and CSV export, plus source quality, cache boundaries and general BI workflow.
- 25 Marketing, Inventory, Operations, field-confirmation and metric-rule checks pass.
- Production webpack build, TypeScript checks, and source-boundary checks pass.
- Nine production-build upload/worker/dashboard cases completed 82 HTTP requests without a failed response. Cases include the original 1,000-row CSV, service and line-item sources, summary rows, mixed currencies, unit pricing with cancelled orders, undeducted discounts, running totals and 101 categories.
- Browser acceptance confirms the actual currency choice and saved-dashboard update. A mixed-format, mixed-currency source produces EUR 1234.50 from its selected EUR row and retains both original source records. The 101-category dashboard retains its totals and controls, and category selection produces the expected filtered result.

## Baseline test findings

A separately executed `custom-metrics.test.ts` has two existing failing assertions on both the previous commit and this implementation. One expects 60 for a date range that returns 120 under the fixture's existing UTC-to-America/New_York behavior; the other expects `DATASET_UNAVAILABLE` where the existing foreign-analysis guard returns `STALE_ANALYSIS`. A separate source copy restored to the previous commit reproduces both. Those tests and shared behaviors are not changed or counted as passing here.

External email delivery, real payment-provider acceptance and production infrastructure remain outside these local engine checks.
