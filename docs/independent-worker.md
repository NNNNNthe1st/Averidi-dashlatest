# Review item 7 — independent Dashboard background processing

The separate Dashboard-owned Node worker uses only the dedicated Dashboard database, storage and entitlements. It imports no website or Analyst runtime. Worker execution remains disabled by default; release mode remains OFF and external integrations remain inactive.

## Implemented processors

| Job kind | Actual operation |
| --- | --- |
| DATASET_INGEST | Parse and profile an owned immutable CSV, JSON or XLSX import, then publish validated version state |
| DATASET_PROFILE | Verify source size/checksum and persist advisory profile and semantic results |
| DATASET_VALIDATE | Persist structural and confirmed business-quality checks and issues |
| DATASET_TRANSFORM | Apply explicit rename, trim, equality filter or empty-row removal; create a new immutable version and queue profiling |
| METRICS_CALCULATE | Run governed calculations and persist an immutable analysis |
| DATASET_ANALYZE | Existing application entry point to the same governed analysis pipeline |
| DASHBOARD_GENERATE | Persist a dashboard generated from current, confirmed analysis outcomes |
| SOURCE_REFRESH | Profile a staged FILE source version, or fetch a configured connector snapshot; persist refresh execution state |
| ALERTS_EVALUATE | Evaluate scoped enabled rules against real metric outcomes and persist deduplicated events |
| REPORT_GENERATE | Create a stored CSV metric report with source provenance and artifact checksum |
| REPORT_DELIVER | Publish an IN_APP delivery receipt to a current workspace member's protected inbox |
| DATA_CLEANUP | Delete explicitly selected temporary/expired reports; plan/apply owner-configured retention and orphan cleanup |

These are implemented handlers, not placeholder successes. Item 10 adds the eight remote connector refresh adapters documented in external-data-connectors.md. PDF generation and external email transports remain separate capabilities and are rejected when unsupported. Item 5 adds owner-controlled retention, quarantine and orphan/abandoned-write cleanup through DATA_CLEANUP lifecycle PLAN/APPLY. See dedicated-storage.md for protection and recovery rules.

## Durable execution

Enqueue validates strict payloads, workspace ownership and resource relationships. Request-facing writes require editor authorization, active entitlement and same-origin protection. A transaction advisory lock serializes each workspace/idempotency-key boundary; reusing a key for a different payload fails.

Claims use PostgreSQL FOR UPDATE SKIP LOCKED and atomic update, with UUID leases and bounded retries/backoff. An attempt has a configurable absolute deadline. A watchdog checks cancellation and ownership and renews the lease. Publication checks the live lease, cancellation, deadline and current dataset/revision inside the business transaction. Progress is monotonic within an attempt. Safe failure codes are returned without exposing raw errors or customer payloads.

Each business publication transaction records its result and effectCommittedAt receipt. Recovery acknowledges a committed receipt even if a process died before queue acknowledgement; it does not repeat committed side effects. Stable artifact IDs and immutable content checks support artifact replay. Cancellation cannot claim to undo committed work. Failed ingestion/refresh and report delivery states are reconciled durably. Cleanup uses recoverable intermediate artifact states.

SIGTERM/SIGINT stop claims, signal the active attempt and record a stopping heartbeat. Interrupted uncommitted jobs remain retryable or recoverable through lease expiry. A stale token cannot publish or acknowledge another process's job. One service process runs one active handler; multiple processes safely share the database queue.

## Schedules and protected APIs

Generic schedules and report schedules atomically enqueue an occurrence and advance its due time. Occurrence keys deduplicate concurrent dispatch. Missed intervals coalesce instead of generating a catch-up flood. Report schedules validate current member recipients, generate a real artifact, then atomically queue deliveries. Permanent invalid schedules are disabled with a safe lastErrorCode; transient database failures roll back.

Routes below are prefixed by /dashboard/app/api/workspaces/{workspaceId}:

- GET/POST /jobs: bounded job summaries or strict enqueue with Idempotency-Key. Summaries exclude payloads and internal errors.
- DELETE /jobs/{jobId}: editor-authorized scoped cancellation.
- GET/POST/DELETE /jobs/schedules: authorized generic/report schedule management; DELETE disables a scoped schedule.
- GET /reports/deliveries: only the signed-in member's delivered inbox.
- POST /reports/deliveries: authorized idempotent delivery to a current member.
- GET /reports/exports/{exportId}: protected, unexpired artifact download with canonical path, size and checksum verification.

## Development operation

Use Node 22 and dedicated disposable Dashboard resources. Migrate and generate Prisma Client before starting the web process and worker in separate terminals. Reapply runtime grants after migrations when using the restricted application role.

```sh
npm run db:deploy
npm run db:generate
DASHBOARD_WORKER_ENABLED=true npm run worker:start
npm run worker:health
```

worker:once supports one-shot execution. DASHBOARD_WORKER_POLL_MS accepts 100–60000 ms (default 1000). DASHBOARD_WORKER_JOB_TIMEOUT_MS accepts 1000–1800000 ms (default 600000). Worker health and enabled-worker readiness require a fresh, non-stopping version-2 heartbeat advertising all twelve supported kinds; a legacy worker cannot satisfy this check.

## Verification

```sh
npm run verify:worker
```

Run only against the dedicated disposable test database and separate test storage. test:worker-handlers exercises every registered handler, real reports, scheduling, tenant/recipient boundaries and cleanup. test:worker-processes uses independent Node processes, actual SIGKILL recovery, publication replay, deadlines and SIGTERM. The disposable development gate and CI include these tests.

Executed native PostgreSQL 17, restricted-runtime-role, full regression, build and Chromium acceptance evidence is recorded in [item7-worker-acceptance.md](item7-worker-acceptance.md). Docker and GitHub-hosted CI execution are not claimed by these local results. No production or other Averidi application was accessed or changed.
