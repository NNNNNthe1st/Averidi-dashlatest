# Review item 12 — complete automated verification

2026-10-23: verification implementation is complete and the entire consolidated **local** gate passed. Hosted acceptance remains a separately observed condition; it is not inferred from local success.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | One complete, discoverable automated gate | [x] Implemented and passed | `npm run verify:complete`, all 21 stages in one run |
| 2 | Unit, integration, accuracy, tenant/security and regression tests | [x] Passed | 166 tests under the restricted non-owner runtime role; zero failures/skips/todos/cancellations |
| 3 | Native database migration/upgrade and permissions | [x] Passed | PostgreSQL 17.10, 17 migrations, 60 models, owner/runtime separation and live drift check |
| 4 | Storage and worker failure/recovery coverage | [x] Passed | Complete discovered storage/HTTPS S3/lifecycle/worker crash-replay suites plus private-storage probe |
| 5 | Real database backup/restore verification | [x] Passed | PostgreSQL 17.10 pg_dump/pg_restore, 37-domain fixture graph, fingerprints of all 61 tables including migration ledger, restored reads through restricted grants |
| 6 | Actual browser and accessible/responsive workflows | [x] Passed | HTTPS OIDC browser; BI upload/profile/confirm/calculate/generate/edit/filter/export; keyboard opening/scrolling and three WCAG scans with zero violations |
| 7 | Implemented-limit performance checks | [x] Passed | 50,000 rows processed accurately through ingestion/analysis/filter/chart preparation in 520 ms, about 37 MiB measured heap growth in the accepted run; bounded fixture rendering |
| 8 | Reproducible source/build checks | [x] Passed | Extraction archive/independence, contract drift, source fingerprint, clean output, route types, TypeScript and production build |
| 9 | Honest evidence/failure handling | [x] Implemented and passed | TAP/JUnit, stage logs, JSON summaries/recovery/accessibility; guard tests reject skipped, failed and incomplete results and unsafe preflight targets |
| 10 | Consolidated hosted workflow and retained artifacts | [x] Implemented | Same complete gate, isolated PostgreSQL service, official client tools, Chromium and explicit report artifact upload |
| 11 | Successful GitHub-hosted execution | [ ] Not yet accepted | Published run 39880991691 failed before its first step on both attempts, including one explicit retry; no job logs were available. |

Accepted local evidence: run `2026-10-23T00-48-52.806Z-2fa28822-cbe0-4adc-9adb-67e232da4e12`, source SHA-256 `31bcb18663a77bdc349140b60cada64d9ed3721b16ca129e7b2d1d1dac3452cf` covering 301 source/configuration files. All 21 required stages report PASSED. The authenticated browser contributes one additional Node browser test; the BI workflow/three axe scans are separately executed stages rather than inflated root test counts.

The new accessibility test identified an actual mobile keyboard defect in a horizontally scrollable metric table. Metric results, upload previews and version-history scroll containers now have labelled regions and keyboard focus. The mobile browser verifies ArrowRight scrolling. No business logic, subscription behavior or other application was changed to resolve it.

An initial build encountered persistence data from an older `.next` cache. The gate now removes only generated build output before route types/build; the subsequent complete accepted run built cleanly. Earlier failed runs remain failed evidence, not counted as acceptance.

## Runtime and hosted limitations

Local execution used Node 22.23.4, native PostgreSQL/server and client tools 17.10, a dedicated loopback test database, temporary trusted HTTPS fixture certificates and Chromium 153.0.8010.0. The root-only container's PostgreSQL UID/ownership shim remains outside the repository; autovacuum is disabled only in that disposable native harness. Hosted CI uses a normal PostgreSQL 17 service and Playwright's own locked Chromium installation. Local acceptance therefore does not certify hosted provisioning.

The published implementation at commit `9c1ab57a61ef17bdf3afd7ddbfb5b61dadb3f264` triggered [hosted run 39880991691](https://github.com/NNNNNthe1st/averidi-dashboard/actions/runs/39880991691). Its single verification job failed before any step on attempt 1 (job `120178051512`) and again after one explicit retry on attempt 2 (job `120178159656`). Both attempts returned empty step lists and no log URL; fetching the second job's logs returned NOT_FOUND. The earlier run 39869643953 at the preceding feature head showed the same pre-step failure pattern.

The connector does not expose the startup annotation endpoint, so this inspection does **not** independently establish an exact current account/billing cause. Prior infrastructure notes describe an existing account runner/startup restriction. Hosted acceptance is blocked until the runner can start and execute the gate successfully. These are startup failures, not observed test failures; no hosted green result or retained hosted test artifacts are claimed. This documentation-only follow-up records the examined implementation run; it does not replace that run with local evidence.

No production/server, main, website, Analyst, account billing setting or external integration was accessed or changed. Item 13 covers combined independent development-environment acceptance. Real staging and production provisioning remain separate future work. A successful hosted run is still required before calling the whole of item 12's hosted acceptance complete.

See `docs/complete-verification.md` for required tooling, isolated URLs, quality mapping, report formats and operational commands.
