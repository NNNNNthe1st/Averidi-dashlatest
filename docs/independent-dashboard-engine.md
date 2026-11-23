# Independent Dashboard BI pipeline

Review checklist item 8 connects the Dashboard-owned engines to the independent application's worker, API and Studio. The working path is upload → profile → confirm fields and business rules → validate and calculate → generate → customize and query → export calculated metrics. Dashboard owns every source file, database record and stored object in this path.

## Engine and application responsibilities

| Stage | Implementation |
| --- | --- |
| Ingestion and profiling | Existing CSV/JSON/XLSX parser, preview, immutable stored versions and profiling worker |
| Semantic understanding | Advisory field/concept/period suggestions; explicit field and business-rule confirmation |
| Validation and calculation | `src/engines/analysis/pipeline.ts`; duplicate/grain checks and the governed nine-metric engine |
| Analysis processing | `DATASET_ANALYZE` processor, independent queue/lease/cancellation lifecycle and immutable `DashboardAnalysisRun` records |
| Generation | Server-owned template eligibility and generation from actual READY outcomes; no client-supplied metric values |
| Studio and visualization | Live KPI, bar, horizontal bar, line and table data; approved grouping fields, category/date filters and previous-period comparisons |
| Reporting | CSV metric reports containing calculated values, reasons, source fields/version/checksum, formula, definition version, filters and analysis ID |
| Refresh | An editor can attach a compatible latest analysis to an existing dashboard without replacing its layout; optimistic concurrency guards prevent overwriting edits |

The engine registry contains ingestion, understanding, metrics, generation, analysis, visualization and reporting capabilities. Bump the analysis engine version when changing persisted calculation semantics.

## Confirmation and trust

Field suggestions never count as approval. Studio saves field choices and version-bound business rules separately. Currency, revenue/cost treatment, row grain, refunds/discounts/returns and a business timezone remain explicit choices. Unknown or ambiguous inputs yield unavailable outcomes with explanations. Auxiliary refund, discount, returned-unit and transaction identity mappings are available in the confirmation form.

The analysis parser preserves confirmed identifier, date and categorical source fields as text. Numeric-looking IDs such as `001` do not silently become `1`; date-only values retain their business calendar day. The same source checksum and size are verified before calculation and queries. Older profiled versions without a recorded source format require a new import rather than a guessed format.

Duplicate rows and invalid confirmed row grain block calculation. The selected grain's identity must be complete and unique. Each metric also enforces its own required mappings, currency and business semantics. A missing or unsupported outcome is never substituted with zero. Empty filters return unavailable metrics, not fabricated zero totals.

Every confirmation write increments the version's semantic revision. Analyses bind workspace, dataset, version, revision, engine version and source checksum. Generation, customization, queries, reports and refresh validate that binding. Changing confirmations or activating another dataset version invalidates prior results. Studio clears stale displayed results, preserves unsaved edits during background updates, and asks for a newly calculated compatible analysis.

The worker checks cancellation, a live lease and the current version/revision at publication inside a transaction. Retry deduplication does not create multiple runs for the same version/revision/engine. Corrupt source objects, cancelled jobs and stale work cannot publish new runs.

## Authorization and request boundaries

All analysis, generated-view, query, report and refresh routes authenticate independent Dashboard sessions, check workspace membership and enforce Dashboard-owned entitlements. Writes and query/report POST requests enforce same-origin protection. Request JSON is streamed with a 16 KiB cap. Editors generate, refresh and customize; viewers can read authorized results. Workspace-qualified foreign keys prevent cross-tenant view/analysis bindings.

The original direct-definition view API retains its rejection of client-created metric widgets. Governed views are created through `/views/generate`; subsequent widget choices are validated against that view's current server-owned analysis. Empty legacy definitions remain compatible.

## Query and presentation limits

Calculations retain the existing 50,000-row, 100-column and 12-filter bounds. Charts support at most 100 distinct groups; exceeding that bound returns an error and requires a narrower filter. No financial totals or chart groups are silently truncated. Ratios and distinct counts are recalculated from the grouped records. Date grouping requires a confirmed timezone, and invalid dates are rejected. Line charts do not connect across unavailable points. Tables expose exact values alongside visual presentations.

Current generation uses the governed nine-metric catalog. Marketing, inventory and operations templates retain their explicit domain-specific eligibility requirements. Their specialist metric catalogs, additional connector resources and PDF/external-transport delivery and other 375-point product features are separate roadmap work. This item completes the engine/application pipeline for implemented capabilities, not every business feature in the roadmap.

## Development use

Use isolated Dashboard resources and Node 22. Apply the additive migration and generate Prisma Client. Run the application normally and start a separate worker with `DASHBOARD_WORKER_ENABLED=true`. In Studio, upload a dataset, review its field meanings, save business rules, select Calculate metrics, and choose an eligible dashboard template. Add approved widgets, save edits, filter results, inspect calculation details or download the metric report.

The web and worker processes do not need a migration-owner credential. Apply runtime table grants again after deploying the new analysis table when using the restricted application role.

## Acceptance commands

On a disposable loopback PostgreSQL database named `dashboard_test` with separate test storage:

```sh
npm ci
npx playwright install --with-deps chromium
npm run verify:bi
```

`verify:bi` deploys migrations, generates Prisma Client, runs the analysis and full workflow tests, checks types/build and executes the real browser workflow. The browser script creates its own fixture user/workspace/subscription, HTTPS proxy and application/worker processes, uses an independent signed session, exercises the UI and download, then removes its fixtures. It does not use a real identity provider or other Averidi product. `DASHBOARD_BROWSER_EXECUTABLE` optionally selects an already installed Chromium binary.

The browser acceptance enables BETA only inside its isolated child application and allowlists only its generated fixture workspace. Normal release defaults remain OFF. No production, website, Analyst or canonical-domain routing changes are part of this work.

Item 7 adds the remaining worker handlers, scheduled stored CSV generation and protected in-app delivery. See `docs/independent-worker.md` and `docs/item7-worker-acceptance.md` for supported providers and executed recovery checks.

Item 10 adds provider-owned snapshot readers and remote refresh through the same isolated version/profile pipeline. Imported fields and units still require explicit business confirmation. See `docs/external-data-connectors.md`.
