# Backlog 1.1 — Marketing KPIs, source attribution and campaign ROI

## Implementation
- Standalone Dashboard-owned marketing calculation extension: `src/engines/metrics/marketing-metrics.ts`; the existing nine-metric calculation function remains untouched.
- Added governed: MARKETING_SPEND, ATTRIBUTED_CONVERSIONS, ATTRIBUTED_REVENUE, MARKETING_CONVERSION_RATE, MARKETING_ROAS and MARKETING_ROI (revenue-based).
- ROI definition: `(source-attributed revenue - marketing spend) / marketing spend`. This is *not profit ROI*: COGS, personnel and overhead are not deducted. ROAS = attributed revenue / spend.
- No attribution is inferred from a channel label. Requires `marketingAttribution=SOURCE_REPORTED` confirmed by the user. Marketing spend requires `marketingSpendDeduplicated=true`: otherwise it is unavailable. Duplicate grain/row rules from the existing pipeline remain in force.
- Reject incomplete, negative, nonfinite monetary data, fractional counts, impossible conversions exceeding leads, missing/ambiguous confirmed mappings, missing/mixed currency and zero denominators.
- Source fields and dataset version are recorded in lineage. Governed marketing definitions use explicit version suffix; `ANALYSIS_ENGINE_VERSION` is bumped to 2 so pre-existing version 1 persisted analysis results are not silently reused.
- Existing sources and profiles are unchanged. Studio offers optional marketing confirmations; legacy non-marketing confirmations default to UNCONFIRMED and false, so they remain savable and the old nine metrics continue working.
- Grouping into separately calculated campaign ROI uses the existing confirmed-dimension chart engine rather than summing/averaging ratios. The MARKETING template becomes eligible only when spend, attributed revenue and ROI are READY.

## Verification status
**Implementation committed, execution not yet observed.** Remote GitHub file review verifies presence of code, not typechecking/runtime success. No production or other application was accessed.

### Focused verification
Run from the independent Dashboard Codespace at `feature/independent-dashboard` after fast-forwarding the branch:

```bash
npm ci
npm run verify:marketing
```

### Complete acceptance
With a **dedicated disposable** `dashboard_test` database and separate restricted runtime/migration roles configured according to `docs/complete-verification.md`:

```bash
npm run verify:complete
```

This discovers the new `tests/marketing-metrics.test.ts` together with legacy tests, runs source isolation, migration/roles, full browser, accessibility, backup/recovery and build gates. Do not point at `dashboard_dev`, any production resource or other product's database. Do not merge to main.

Completion claim requires actual passing focused verification **and** the full gate. Tests cover exact money/count arithmetic, zero/negative/ambiguous refusal, explicit attribution, source lineage, campaign breakdown, template eligibility and compatibility with the old metric catalog. Real advertising-provider attribution is accepted as source-reported input, not independently certified without provider data.
# Governed marketing customer acquisition cost

`MARKETING_CAC` adds confirmed marketing spend divided by source-attributed unique new customers. It is marketing acquisition cost; the application does not label it fully loaded sales-and-marketing cost.

Prerequisites are an explicitly mapped acquisition-count field, source-reported attribution, confirmed non-repeated spend, a single confirmed currency and the new confirmation that new-customer counts do not overlap across rows. A conversion count or repeat-customer total is never substituted for new acquisitions. Existing datasets do not acquire this confirmation automatically and existing financial/ROI definitions are unchanged. Customers review and save the new rule, calculate the current analysis and can add the supported CAC metric to their dashboard.

Counts must be nonnegative safe whole numbers. Zero acquisitions, mixed/unspecified currency, ambiguous mappings, unsafe totals, repeated spend or unconfirmed attribution refuse calculation. Zero spend with positive confirmed acquisitions produces zero CAC. Grouped charts recalculate spend/acquisitions from records instead of averaging group ratios. The fixture has spend 150 and five acquisitions, yielding 30; the two groups yield 25 and 50, whose unweighted average would be wrong.

Custom formulas retain the currency-per-acquired-customer unit. Adding CAC to total spend fails the existing unit compatibility guard. Definitions, source fields, current filters, currency, calculation provenance and CSV output remain traceable. Native worker/view/preset acceptance and an actual HTTPS JSON-upload-to-CAC-chart workflow are included in the combined verification gate.
