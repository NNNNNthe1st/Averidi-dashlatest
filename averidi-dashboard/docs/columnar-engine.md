# Independent Dashboard — columnar frame execution

Implementation scope: original 59-item roadmap, item 1. This remains entirely within the standalone Dashboard repository. The approved Sales UI, Analyst, website, and external databases are not modified.

## Runtime configuration

Set `DASHBOARD_COLUMNAR_ENGINE=enabled` on the worker **and** on the Dashboard web application to activate the new path. It is intentionally opt-in until deployment acceptance. With the flag disabled, legacy reads and jobs behave exactly as before.

DuckDB Node API and its prebuilt native bindings are pinned at 1.4.5-r.1 in package.json and the lockfile, and marked external for Next.js server bundling. Run with Node.js 22 using npm ci to install the locked artifacts.

## Frame lifecycle

- The existing DATASET_ANALYZE worker publishes a SOURCE frame from confirmed mappings and normalized units. The Sales interpretation service also publishes a SALES_PROJECTED frame after calculating the independent Sales engine-version fingerprint; that frame stores the already-interpreted Sales population and is never projected twice on read. Canonical numeric concepts are stored as DECIMAL(38,12); original source columns are stored separately as strings so identifiers retain leading zeroes.
- Business-day values are precomputed per confirmed TIME dimension, in the confirmed business timezone, with invalid-date counts.
- DuckDB writes ZSTD Parquet into the Dashboard-owned `processed/<workspaceId>/` storage scope. The v3 object key hashes workspace, dataset, version, semantic revision, engine version and source checksum. A stable ordinal preserves row order; independent typed JSON cells preserve both normalized processed values and original raw values, including blank strings and leading-zero identifiers, without coercing them to zero. The frame also includes a canonical row-content hash based on column order and row position, checked after reading.
- The analysis-run JSON stores the immutable frame identity, source checksum and artifact checksum; the object itself is checked for Parquet framing and checksum on read. Frame object keys are not returned in the viewer-facing analysis response.
- The existing version/revision checks stay authoritative. A superseded worker cannot publish a frame pointer into the analysis run.
- Readers with a current analysis run read source records from the verified Parquet frame. Analyses written before activation continue using source storage until backfilled.
- A SQL compiler uses the governed SUM/DISTINCT/REF/SUBTRACT/DIVIDE plan. DuckDB calculates exact DECIMAL aggregations and null-counts; Prisma.Decimal evaluates ratios and plan dependencies to avoid implicit DOUBLE division.
- Direct queries, saved interactive views and the REPORT_GENERATE worker use the shared governed widget computation. They use the common SQL compilation path for READY core metrics on governed single-currency analyses. Comparisons use the same compiled queries for both reporting periods. When cancellation rules require excluding rows, SQL applies the confirmed status exclusion. The compiler emits the full SUM / DISTINCT / REF / SUBTRACT / DIVIDE expression tree; DuckDB returns decimal aggregates as strings, and Prisma.Decimal evaluates dependent expressions so native DOUBLE division never changes authoritative monetary values. A per-metric parity guard compares columnar values to the existing calculation engine and fails closed on discrepancy. Non-core metrics and existing per-group charts retain the reference execution path until the separate grouped-query item 3. Existing UI markup is unchanged.
- Worker cancellation is checked during frame generation and before publication.

## Migration for existing analyses

With the columnar flag enabled, execute `node --import tsx scripts/backfill-columnar-frames.ts` inside the isolated Dashboard runtime. This attaches verified frames to **current** READY analysis runs without modifying analysis ids, dashboards or Sales presentation. The operation is resumable and never backfills stale source versions.

## Release prerequisites

The implementation alone does not establish parity or a production signoff. The roadmap's item 1 acceptance still requires executing decimal/null parity, tenant scope, cancellation, dependency audit, install/build and full regression checks. The user has explicitly postponed testing for this implementation pass. Do not mark item 1 verified before those gates run.

Item 2 (streaming ingest and raised row/column caps), item 3 (single grouped SQL query per chart), and item 4 (Top-N and Other) remain separate. The existing small-file size guards are retained intentionally.

## Verification command (not executed during coding)

`npm run verify:columnar` runs the native DuckDB and Parquet compatibility smoke check, the item 1 scope/parity/raw-cell/null/cancellation tests, the dependency audit, type checking and Next.js packaging. The global `npm run verify:complete` remains the final regression gate. This commit contains implementation and tests but no executed acceptance evidence because the owner requested code completion before testing.

Version-1 and version-2 frames created by the earlier partial implementation are not activated; readers use the original authenticated source route until version-3 backfill is completed. Backfill treats version-1 frames as needing regeneration and can be resumed.

## Source-code integration boundaries

- `src/features/sales/preparation.ts`: publishes Sales-projected frames for each persisted Sales analysis fingerprint, using the guarded `DashboardAnalysisRun` transaction.
- `src/features/analysis/service.ts`: selects SOURCE or SALES_PROJECTED on read and verifies the run engine-version identity and source checksum. Legacy runs without a v3 frame read the original source file.
- `src/features/analysis/governed-widgets.ts`: one governed metric overlay for saved dashboards and scheduled report generation. Current per-group chart series calculation is deliberately unchanged; its replacement is roadmap item 3.
- `src/worker/handlers/reports.ts`: uses this shared calculation so PDF, PNG and CSV export headlining metrics cannot bypass the SQL execution path.
- `src/features/analysis/views.ts`: cache scope also binds the active frame checksum and flag state, preventing a legacy response from being reused after frame adoption.
- `scripts/backfill-columnar-frames.ts`: migrates both active standard and Sales-specific runs, without modifying the identity of existing analyses or connecting another application.

The in-process DuckDB writer and aggregate query use the documented pending-task API. They check the AbortSignal between short native tasks, close the pending result on cancellation, and retain the existing worker lease and publication guard. Native cancellation remains subject to runtime acceptance under the pinned dependency.

## Frame-first unfiltered KPI reads

For unfiltered READY analysis runs, the stored governed result already contains source-quality, semantic eligibility, lineage, and all non-core outcomes for the current version and semantic revision. `calculateAnalysisQuery` reuses this immutable result instead of rerunning `analyzeDashboardData` before the SQL overlay. The persisted analysis identity must still be validated by `currentAnalysis`.

For a saved non-Sales KPI-only view or a KPI-only report, `canUseUnfilteredKpiFrame` skips even reconstructing row arrays from Parquet. The shared governed widget service returns the original outcome schema and obtains numeric core measures through the DuckDB columnar plan. If the request contains filters, comparisons, charts, or needs Sales context or drilldown records, the existing frame-backed row path remains available. Grouped SQL chart execution is item 3 in the chronological roadmap, and is not silently added to item 1.

This is a source-level change only. The owner's instruction not to execute tests remains in force; release and dependency acceptance are not asserted here.

## Original item 1 completion boundary

The original item is the immutable, source-version-bound canonical frame plus the SQL execution of the existing governed Sales expression tree. It does not require migrating every non-core forecast, cohort or chart-series calculation to DuckDB: grouped chart execution is original item 3. Frame-backed row reconstruction is retained for those separately planned calculations, drilldowns and presentation compatibility, but no source-object reparse occurs when a current frame is available. The direct unfiltered core calculation and unfiltered KPI-only view/report paths avoid repeating the row-based metric engine; filtered/other-metric reads retain the governed reference as a safety guard while core values are sourced from SQL. SQL DATE_RANGE filters validate invalid source business days in the selected pre-date population, retaining the selection order semantics.

DuckDB's runtime and object-store packaging, byte-for-byte DECIMAL parity and the dependency audit are acceptance gates, not claims made from source code. The pinned 1.4.5-r.1 DuckDB package-lock entries now include SHA512 integrity digests cross-checked against multiple independent npm-generated public lockfiles; the 1.4.5 platform list is also aligned with those lockfiles. A real Node 22 npm ci, native smoke run, release artifact build and audit must still execute before accepting runtime compatibility. The original CLI can be invoked with `npm run verify:columnar` after installation.
