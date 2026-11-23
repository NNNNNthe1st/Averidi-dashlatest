# Requirements 342 and 251–258 — implementation and acceptance handoff

Original 375-roadmap numbering. Baseline `abf5b256749fb935bef7196b6dfd86b4526e223c`; independent development branch. No production/server/SSH access, deployment, main merge or other-product activation.

## Status

All nine scoped code paths are implemented and integrated. **Full acceptance is not complete.** Do not treat this checkpoint as production approval or an all-green verification result. The final full gate passed 23 stages, including all 366 regression tests, but failed its last BI browser stage at the existing data-management source-profile table. A diagnostic rerun was started; the execution environment became unavailable before its result could be recovered.

The roadmap retains these nine requirements as Partial until that failure is resolved and complete verification passes. Its original numbers, titles and acceptance descriptions are unchanged. The related stale-warning requirement 202 now describes the added source-age functionality without claiming full acceptance.

| # | Implemented integration | Acceptance still required |
|---:|---|---|
| 342 | Weekly npm/actions Dependabot; scheduled/manual/change-triggered audit; retained reports; high/critical and unavailable-scan blocking in complete verification and release build; compatible dependency remediation | Final full gate; hosted workflow run; scheduled activation after separately approved default-branch release |
| 251 | Safe structured request/job diagnostics, controlled error codes and correlation; real Next root request spans; authenticated operational metrics | Final full gate |
| 252 | Durable terminal import/sync incidents; worker maintenance and operator probes; retries do not falsely clear an existing incident | Final full gate |
| 253 | Current version/revision-bound failed or blocked calculation incidents, cleared only after successful current calculation | Final full gate |
| 254 | Canonical route and job duration/outcome buckets, error and latency probes, bounded admin results and 24-hour retention | Final full gate |
| 255 | Database/storage/worker/queue/lease probes, CPU/cgroup-aware memory/filesystem metrics, monitoring readiness and independent watchdog | Final full gate; production installation and actual-host checks |
| 256 | Durable deduplicated FIRING/RECOVERY delivery; independent authenticated persistent heartbeat watchdog, replay rejection and delivery retries | Final full gate; actual owned sink and separate host/TLS deployment/delivery acceptance |
| 257 | Permission-scoped in-app source-failure inbox, navigation badge, preferences, generation-safe acknowledgement and verified recovery | Final full gate |
| 258 | Customer-selected source age, stale-source incident/inbox/badge and successful-refresh recovery; no invented business deadline | Final full gate |

## Implemented behavior

The new migration creates source monitoring policies, durable source incidents and anonymous operational aggregates. Policy and incident mutations retain atomic audit evidence. Observation buckets are explicitly excluded operational counters, like existing liveness/request counters; they contain controlled labels, counts and durations, not customer source values or identities.

Source reconciliation serializes on the source row. Initial queued/running retries are suppressed; existing failure incidents remain active during retry/reconnect until successful refresh. Metric failure remains review-required until a compatible current READY calculation and successful matching job. Incident acknowledgement checks the current generation under lock; recurrence cannot be accidentally acknowledged using an older generation. Preferences can mute notifications without claiming repair.

Freshness is configured explicitly per source. Leaving maximum age blank disables elapsed-time warnings. Never-refreshed sources start the configured grace interval when policy is saved. Bounded worker sweeps run independently of long jobs, avoid overlap and remove the SOURCE_MONITORING readiness capability if stale or failing. Customer lists and admin metric responses disclose bounds/truncation.

Next instrumentation uses a local custom span processor without external exporters, inbound propagation or request payload capture. Static canonical route names prevent raw IDs/query strings entering aggregates. Job finalization retains its existing outcome if observation recording fails. UTC bucket writes are independent of database session timezone.

Operator probes add source/calculation failures, recent request errors and request/job latency to existing durable delivery. Resource metrics measure the host where the monitor is installed; install it beside the app to measure that host. The watchdog is designed for a separate host behind TLS ingress, binds loopback, authenticates heartbeats, rejects stale/replayed timestamps and persists alert state privately across restart. Configure real destinations/secrets before deployment; examples contain no production credentials.

Dependencies remain on the existing Prisma major. Targeted updates include Prisma 6.19.3, Zod 4.6.7, exceljs-hardened 5.1.0 and tsx 4.23.15; scoped Prisma configuration overrides use deepmerge-ts 8.0.2 and effect 3.20.0. The spreadsheet package is server-external to avoid bundling its unused optional AWS adapter. Actual initial audit reported eight findings; the post-patch audit and full-gate security stage reported zero. No blanket advisory exceptions were added. The audit scans runtime and development dependencies and fails closed on unavailable/malformed scans.

## Executed evidence and unresolved failure

Final completed gate attempt:
`.local/verification/2026-10-26T01-43-41.177Z-348a36d1-749d-48fb-82d8-e1a5bc92d99f/summary.json`

Runtime source SHA-256:
`810bbff96753dfff796a9b062e9eeec7a52c1b367749a26da7c52bdf8b097827`
across 590 selected files. Narrative documentation is excluded from that fingerprint.

Passed: all 366 regressions without failures/skips; dependency scan; history/isolation/contracts/traceability; schema/client/migrations/upgrade; owner and restricted-role checks; schema drift; storage probe; real backup/restore; TypeScript; clean production build; account-erasure browser; authentication browser.

The BI stage passed the new actual terminal worker failure → customer acknowledgement → blocked calculation → explicit stale warning → corrected-data calculation → resolved workflow, including real canonical Next request counter growth and four desktop/mobile accessibility scans. It also passed the preceding demo, billing, rate protection, comparison, Studio, presentation, account/collaboration/sharing, layout, permissions, custom metrics, data-model, quota and audit workflows.

It then failed at `tests/fixtures/monitoring-browser.ts:19`, waiting 25 seconds for `getByRole('table', {name:'Source field profile', exact:true})` after selecting Browser orders on Data management. The underlying cause is not established. Do not silently weaken the locator, remove the workflow or claim the failure is unrelated without evidence.

Resume in a disposable local database with Node 22 and browser dependencies. Add safe response/status diagnostics for this failure, inspect the dataset's selected version and profile response, resolve the actual cause, then rerun `npm run verify:complete` from a fresh isolated database. Run supplemental custom-source HTTPS acceptance afterward. Update this handoff, progress document and roadmap only with actual successful results. Production alert destinations, independent watchdog deployment and default-branch schedule activation remain separately authorized operational acceptance.

This checkpoint preserves the tested source snapshot; the uncompleted diagnostic rerun and its temporary diagnostics are not included.
