# Checklist item 8 acceptance

Completed from baseline `f6278bf7ab742c9d8a0184faa1fce673025616f4` on 2026-10-22. This is review checklist item 8, not roadmap Phase 8.

| Check | Result |
| --- | --- |
| Independent source and resource boundaries | Source isolation passed; no other Averidi application or production resource modified |
| Source-to-dashboard flow | Real upload route, profile worker, confirmation, analysis worker, generated dashboard, edits, query and export passed against native PostgreSQL |
| Numerical accuracy and identity | Known revenue/cost/profit/margin/order totals, grouped totals, previous-period comparisons and preserved `001` identifiers passed |
| Confirmation and data quality | Unconfirmed/ambiguous inputs refuse metrics; duplicates and invalid grain fail quality checks |
| Tenant and permission boundaries | Viewer generation denied; foreign-workspace access denied; unauthenticated/cross-origin route requests rejected |
| Worker trust and recovery | Analysis requests deduplicate; stale revisions, cancelled publication and corrupted source objects rejected without publishing new runs |
| Refresh and layout | Existing dashboard attaches the latest compatible analysis and retains its grouped widget |
| Database acceptance | All 13 migrations applied; legacy upgrade preserved existing records; schema drift absent; restricted runtime permissions passed |
| Regression | All 105 application/domain tests passed, with no failures or skips; separate runtime-role test passed |
| Build | TypeScript and optimized Next.js build passed |
| Browser | Actual Chromium UI upload, profiling, field/rule confirmation, calculation, generation, chart creation/save, filtering and downloaded metric CSV passed |
| Responsive presentation | Browser workflow checked a 390×844 mobile viewport; rendered mobile results inspected |

Environment: Node 22.23.4, native PostgreSQL 17.10, Prisma 6.19.0, Next.js 16.4.0 and Playwright 1.64.1. Browser acceptance used an explicitly selected local Chromium binary. PostgreSQL ran in a temporary local cluster with the root-only container UID shim described in item 4's record. All legacy migration files used their published byte content; none was changed. Optional Prisma/Next telemetry was disabled.

The GitHub workflow includes the new unit/integration checks and Chromium browser gate. Hosted CI completion is separate from these executed local checks. Default release and external-integration settings remain inactive. This acceptance covers the implemented BI catalog and pipeline; specialist domain metrics, external source adapters, scheduled report delivery and the remaining roadmap features retain their own completion gates.
