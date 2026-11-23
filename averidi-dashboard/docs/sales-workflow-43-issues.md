# Sales workflow corrections

Scope: Sales setup and Sales analysis snapshots. The approved HTML/CSS and fixed
dashboard layout are retained. Other templates continue using their existing
confirmation, calculation and generation paths.

Entry points: choose Sales performance in Studio, select Studio in a finished
Sales dashboard, or select Update Sales data on a saved Sales dashboard card.
The URL retains `?sales=1`. The existing general Studio remains available for
other dashboard types.

## Issue coverage

| # | Implemented response | Code |
|---|---|---|
| 1 | Dedicated Sales upload entry remains available independently of saved views. | `SalesSetup.tsx` |
| 2 | Keep-original creates a separate dataset; only an explicitly selected Sales view can replace its source. Failed transfers reuse the registered destination. | `upload-intent.ts; SalesSetup.tsx` |
| 3 | Selecting a file clears unrelated results; only that upload's results appear. | `SalesSetup.tsx` |
| 4 | File preview explicitly says not uploaded; upload, processing and calculation stages are distinct. | `SalesSetup.tsx` |
| 5 | Results identify filename where recorded, dataset, version, rows, coverage and calculation time. | `preparation.ts` |
| 6 | Saved data choices include filename, row count, active source version, upload time, processing state and a disambiguating reference. Failed newer attempts do not relabel the active source; preparation is disabled while replacement is pending. | `sources.ts; sales-sources/route.ts` |
| 7 | Processing, failed/no processed upload and ready states have refresh, processing-details and retry actions. | `SalesSetup.tsx` |
| 8 | Upload and prepare is one primary action; publishing follows supported results. | `SalesSetup.tsx` |
| 9 | Staged Sales screens replace the long general-purpose setup page. | `SalesSetup.tsx` |
| 10 | No row-grain/accounting enum form; only unresolved business questions appear. | `interpret.ts` |
| 11 | Compositional industry vocabulary, multilingual aliases, name normalization and full-column value validation identify roles. Arbitrary numeric columns are not guessed as revenue. Explicit corrections are reused for compatible columns on later versions of the same source, while accounting answers are re-established. | `interpret.ts; preparation.ts` |
| 12 | Net sales and separate gross, discount, refund, tax and delivery amounts are distinct. A confirmed adjustment formula derives net sales without deducting the same adjustment twice. | `interpret.ts; contracts.ts` |
| 13 | IDs and names are paired only when the relationship is consistent in both directions; geography fields remain distinct. | `interpret.ts` |
| 14 | Order, invoice and transaction identities remain distinct. Invoice items use their parent and line identity; repeated documents require per-line amount confirmation. Repeated transactions and incomplete identities do not establish safe monetary totals. Recognized detail/subtotal mixtures block calculations until the user approves excluding summary rows; original records remain intact. | `interpret.ts; custom-measures.ts` |
| 15 | Normal setup and optional corrections use readable business labels. | `contracts.ts; SalesSetup.tsx` |
| 16 | Profit is a recognised field; cost is derived only when its gross-profit meaning is established. | `interpret.ts` |
| 17 | Each independent metric uses its available dependencies; unanswered finance questions do not suppress counts. | `availability.ts; interpret.ts` |
| 18 | Each blocked result is classified using structured dependencies and diagnostics, not matching engine explanation text, by its own missing/ambiguous field, business detail, source quality, empty selection or unsupported input. Unrelated unresolved fields cannot suppress independent revenue. | `availability.ts` |
| 19 | Recovery actions open the relevant field, source-quality, saved-answer, reporting-date or business-question section. Previously saved No answers remain editable. Detailed insights link to the same destinations. | `SalesSetup.tsx; SalesInsights.tsx` |
| 20 | Sales results exclude marketing, inventory and operations metric families. | `contracts.ts; SalesInsights.tsx` |
| 21 | Calculated additional insights and optional prerequisites are collapsed under More Sales insights. | `SalesSetup.tsx; SalesInsights.tsx` |
| 22 | File checks and number of calculated Sales results are reported separately. | `SalesSetup.tsx` |
| 23 | Partial dashboards are labelled as available results and explain missing cards; no values are invented. | `SalesSetup.tsx` |
| 24 | Percentages, currencies and quantities use locale-aware formatting. Currency precision follows the currency. | `contracts.ts; sales-model.ts` |
| 25 | Calendar dates support ISO, year-first slashes/dots, unambiguous dotted day-first, localized named months and digits (including grammatical month forms) and Japanese calendar notation. Written-month locale can be corrected; Gregorian dates are validated. Ambiguous day/month conventions ask once; timestamp timezone entry has searchable IANA suggestions. | `source-values.ts; SalesSetup.tsx` |
| 26 | Sales setup uses a single title without repeating the outer product branding. | `SalesSetup.tsx` |
| 27 | File labels, format help, selected filename and preview are separated and responsive. | `SalesSetup.module.css` |
| 28 | Sales preparation is bound to its requested source; old general analysis jobs cannot redirect it. | `preparation.ts` |
| 29 | Registration has a durable actor/workspace/request key and a workspace lock. A lost registration receipt reuses the original source; transfer retries retain their destination. | `sources.ts; upload-intent.ts` |
| 30 | Transfer errors persist; uploading does not automatically restart inspection and erase them. | `SalesSetup.tsx` |
| 31 | Sales requests use Dashboard session renewal, preserving input and avoiding automatic write replay. | `dashboard-authenticated-fetch.ts` |
| 32 | File/source changes clear measure drafts, column searches, progress and unrelated result/view references; saved answers are tied to immutable version-bound Sales snapshots. | `preparation.ts; service.ts` |
| 33 | Upload, analysis and generation actions enforce their respective UI and server permissions. | `Sales routes; workspace permissions` |
| 34 | The Sales path has no ineffective generic widget-customization controls. | `DashboardCanvas.tsx` |
| 35 | Dedicated Sales unit/integration commands complement the corrected generation command and approved-design checks. | `package.json; sales tests` |
| 36 | Core, customer/product, period, forecasting, CRM, comparison, planning, cohort, refund/return and concentration rules receive their supported mapped fields and explicit business prerequisites. Additional measures use explicit aggregations. Results still require the actual input population/history and relevant reporting selection. | `interpret.ts; metric-rules.ts` |
| 37 | Shipping dates/methods, names, prices, profit and additional fields remain recognised even when not metric inputs. | `interpret.ts` |
| 38 | Optional corrections offer a short likely-meanings group, original-value examples, column search and all remaining supported meanings. Numeric-looking text can still be corrected to a numeric role. | `SalesSetup.tsx; interpret.ts` |
| 39 | Field recognition metadata is separate from the mappings actually consumed by calculations. | `contracts.ts; interpret.ts` |
| 40 | Source identity, display names, date roles and monetary roles remain separate; original identifier strings are preserved. | `source-values.ts; interpret.ts` |
| 41 | Existing dashboard filters select confirmed geographic/category levels. All source rows must validate each child-to-parent relationship before chart marks drill along an edge; equivalent State/Province levels never create an arbitrary chain; moving up clears lower-level filters, and the filter menu can clear the breakdown. Parent context avoids merging duplicate child names. | `hierarchy.ts; sales-dashboard-dom.ts; views.ts` |
| 42 | Users define additional measures with Sum, Average, Min, Max, Distinct count or Record count. Record count includes blank selected values and returns zero on an empty filtered population. Measures are saved in the Sales snapshot, respect dashboard filters, appear in detailed insights and exports, and block incomplete/invalid input rather than silently ignoring it. | `custom-measures.ts; SalesInsights.tsx; metric-report.ts` |
| 43 | A short detected-fields summary is visible; detailed evidence, warnings and corrections are optional. | `SalesSetup.tsx` |

Paths in the table resolve to `src/components/sales/`, `src/engines/sales/`,
`src/features/sales/`, and the existing analysis/reporting integrations.

### Completion criteria

These implementations cover the 43 observed workflow issues, not a promise to
infer every possible business definition from a header. A blocked result remains
correct when the source lacks its required records, currency basis, business
facts or complete observation period. Setup shows those requirements instead of
creating false values. Marketing, inventory and operations stay outside Sales.

The only added shared validation behavior accepts normal `YYYY-MM` cohort
months; the previously accepted legacy pattern remains accepted for compatibility.
Other templates retain their original inference and calculations. Additional CSV
rows are emitted only when the result contains Sales custom measures.

## Isolation and integrity

`src/engines/sales/` contains the Sales-only recognition/projection contracts.
`features/sales/preparation.ts` verifies source checksum, size and active version,
then stores an immutable Sales analysis snapshot in `DashboardAnalysisRun`.
A Sales-only selection pointer in import metadata remembers the currently chosen
snapshot, including a deliberate return to a previously saved choice. Reopening
the same version restores its answers; a new version reuses only compatible
explicit field corrections. Refresh uses this pointer and reconstructs the Sales
configuration for the new supported fields, including partial results.
It does not overwrite version semantics or increment shared confirmation
revisions. Snapshots carry their own interpretation, customer answers and
projection. Their version IDs, revisions and source checksums are checked on read.

The engine-version namespace for these runs is separate from the existing
general analysis engine. Generation from a Sales snapshot is restricted to Sales.
Sales refresh can select a current Sales snapshot; other template refreshes keep
their original analysis selection. The Sales upload endpoint refuses replacement
of sources referenced by a non-Sales view, including a second check inside the
upload-registration transaction. Source files remain unchanged.

Sales chart groups use the existing governed core metric formulas without
recalculating forecasts/CRM history for every customer/month. Comparison results
are verified against full analysis. The default analysis scope remains unchanged.
A bounded cache reuses equivalent timezone formatters without changing calendar
rules. Non-US source data is displayed as location bars rather than colouring an
unrelated US map; US mapping requires explicit US country evidence.

## Verification

Completion tests additionally cover gross-to-net deductions, invoice and
transaction grain, explicit custom aggregation, filtered custom results,
spreadsheet-safe custom exports, multiple calendar conventions, independent
metric availability, hierarchy edge validation, planning/cohort contracts,
registration receipt retries and compatible correction reuse on a new version.
The actual approved renderer is browser-tested for location-level selection and
the detailed-insights dialog; the setup browser test uses the actual component
with isolated HTTP fixtures. No production account or database is modified.


- Exact supplied 1,000-row CSV: 1,000 orders, 120 customers, 4,237 quantity,
  revenue 949,294.07 USD, cost 692,555.30 USD, gross profit 256,738.77 USD.
- Unit cases cover line items, gross-profit derivation, mixed/missing currencies,
  date/number ambiguity, non-Latin aliases, leading-zero identifiers, parent/child
  disambiguation, source immutability, formatting and core/chart comparison parity.
- Isolated migrated database test covers upload, worker profiling, preparation,
  dashboard generation, filtered chart data, refresh, unchanged shared semantics,
  tenant/role/auth restrictions, refusal to replace shared sources and checksum failure.
- Existing generic BI integration is run separately against a fresh database.
- Browser QA uses the actual SalesSetup component and actual engine-generated CSV
  results with isolated HTTP/XHR fixtures; it covers preview/source separation,
  failed transfer/retry, source row count, business answers, financial results and
  creation handoff. It does not use the user's Codespace session.
- Production webpack build, TypeScript, approved Sales source/design tests and
  focused regression tests are required before commit.

## Deliberate limits

Missing currency conversions, tax/refund definitions, history completeness,
opportunity populations and business goals are not fabricated. Forecasts and
other advanced calculations remain conditional on their real inputs and business
prerequisites. Recognition supports a growing explicit vocabulary and value
checks; it is not a claim to understand every language or industry automatically.
Customers can correct additional roles without changing original column names.

## Final acceptance results — 30 October 2026

- Production webpack build and standalone TypeScript check: **passed**. Approved HTML SHA-256 remains `16a259c0f2f8e257e2448d7fe31687ffc1629dba00f161ad603e02f577db5cc8`.
- `test:sales-workflow`: **107 passed, 0 failed**. Includes advanced Sales families, CRM, approved design, authentication renewal, source isolation and generic analysis regression.
- Six database suites: **16 passed, 0 failed**, using fresh migrated, isolated PostgreSQL-compatible fixtures with SQL runtime privileges enforced. Covers runtime-role denial of DDL/migration writes, source quality, query cache and independent worker process, comparisons, Sales upload-to-view and generic BI workflow. This is not production database certification.
- `check:isolation`: **627 scanned, zero violations**. The TypeScript AST scanner distinguishes real imports from quoted repair-script templates; tests retain detection of real forbidden imports.
- Browser checks: actual Sales setup and actual approved renderer at **320, 768 and 1280px**; all six report zero horizontal overflow and zero axe WCAG A/AA violations in the checked state. Dashboard scans use the opt-in higher-contrast mode. Original default colors are preserved and are **not claimed to meet AA contrast**. The higher-contrast preference is keyboard accessible and browser-local.
- Browser recovery acceptance: saved revenue answer No can be changed to Yes without remapping columns; recalculation displays **$949,294.07**, 1,000 orders and 120 customers from the supplied fixture.
- Legacy shared ingestion timestamp behavior is unchanged. Three old test expectations/fixtures were corrected to reflect existing UTC timestamp semantics and actual comparison-period boundaries; independent Sales tests verify calendar-day preservation.
- Warm Sales query-cache results reuse persisted Sales diagnostics/hierarchy metadata without reopening the source file. Actor identity is fetched after authorization checks, never included in shared cached metadata.
- Rolling twelve-month Sales calculations include the complete intended window, including month-end and leap-year boundaries.

Reproduce pure checks with `npm run test:sales-workflow`, `npm run check:isolation`, `npm run typecheck` and `npm run build`. Use `npm run test:sales-database` only with dedicated isolated owner/runtime test database URLs; its guard refuses a normal development database. No production account, database, deployment or main-branch change is part of this work.
