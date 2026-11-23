# Item 7 — worker acceptance

Date: 2026-10-22. Baseline: independent Dashboard branch commit 60651d2ce2c8bc44e55a23b1eec699107e573a3c. This acceptance covers the Word architecture section 13 background-processing infrastructure and the twelve implemented processor entry points documented in independent-worker.md.

## Executed checks

| Check | Result |
| --- | --- |
| Native PostgreSQL 17 clean database | All 14 migrations applied; 54 Prisma models validated |
| Existing database upgrade | Additive upgrade passed with zero schema drift; prior migrations unchanged |
| Restricted runtime database role | Permissions/domain checks and actual worker-handler workflow passed without migration-owner privileges |
| Full regression | 109 tests passed, zero failed or skipped |
| Concurrent native claims | Eight independent Node processes claimed four jobs exactly once |
| Process loss | Actual SIGKILL owner termination, lease recovery and stale-token publication rejection passed |
| Commit/acknowledgement interruption | Committed receipt recovered without repeating effects, including exhausted-attempt recovery |
| Cancellation/deadline/shutdown | Uncommitted publication fenced; timeout retried; actual SIGTERM service shutdown and stopping heartbeat passed |
| Handler workflow | Ingest/profile, validation, immutable transformation, both calculation kinds, generation, alert deduplication, staged FILE refresh and execution record passed |
| Reporting/delivery | Real stored CSV, checksum-verified download, member-only inbox, scheduled generation/delivery, foreign-recipient rejection and unsupported external-transport rejection passed |
| Cleanup | Expired reports and explicit workspace temporary objects deleted; foreign workspace rejected; cleanup allowed after entitlement expiry |
| Build and source boundaries | Type checking, source isolation and optimized Next.js build passed |
| Chromium application acceptance | Actual upload, profile, confirm, calculate, generate, edit chart, filter, CSV download and mobile viewport passed |

The execution used disposable native PostgreSQL 17, local test storage, Node 22 and Chromium. Docker was unavailable; no Docker-hosted acceptance is claimed. CI gates were updated but a successful GitHub-hosted workflow run is not claimed. The isolated browser fixture enabled BETA only in its child process for its generated workspace. Repository defaults remain release OFF, worker disabled and external integrations false.

## Completion boundary

Item 7 now includes executable processors, durable queue and schedules, tenant/authorization checks, progress, retries, cancellation, attempt deadlines, multi-process exclusion, crash recovery, publication receipts, delivery reconciliation and capability-aware worker health. CSV reports and IN_APP delivery are real implemented providers. FILE refresh is supported; remote business connectors, email/PDF delivery, general object-retention policy and external staging/production provisioning remain their separate workstreams. These results do not certify the entire 375-point product roadmap or production release.

Only feature/independent-dashboard in NNNNNthe1st/averidi-dashboard is changed. Main, sales, website, Analyst, production resources, public routing and external recipients are outside this change.
