# Complete independent Dashboard verification (review item 12)

`npm run verify:complete` is the required consolidated acceptance entry point. It replaces the previous CI chain of selected suites and repeated builds. Older feature-specific commands remain useful diagnostics; they do not replace this complete gate.

## Required isolated resources

Use Node 22, locked `npm ci` dependencies, OpenSSL, PostgreSQL 17 and its `pg_dump`, `pg_restore`, `createdb`, `dropdb` tools, and the locked Playwright Chromium installation (`npx playwright install --with-deps chromium`). `DASHBOARD_PG_BIN` may point to a PostgreSQL 17 client binary directory; otherwise tools resolve from PATH. The migration principal must be able to create the disposable restore database. No production resources are needed.

The gate accepts only the loopback database named **dashboard_test**, the public schema, and separate owner/runtime principals targeting that same host/port/database. Runtime role names must match `dashboard_*runtime`; the role is created without elevated permissions if absent. Existing elevated runtime roles are rejected, not altered. The migration role owns schema changes; all application, concurrency, billing, storage and browser tests run with the restricted runtime role. The application role cannot own tables, perform DDL or update the migration ledger.

Example environment for an already provisioned disposable test database:

```
DASHBOARD_DATABASE_URL=postgresql://dashboard_ci_runtime:verification-runtime-only@127.0.0.1:5434/dashboard_test?schema=public
DASHBOARD_MIGRATION_DATABASE_URL=postgresql://dashboard:verification-migrations-only@127.0.0.1:5434/dashboard_test?schema=public
DASHBOARD_PG_BIN=/usr/lib/postgresql/17/bin
```

Use the isolated database service in `infrastructure/development/compose.test.yaml` or an equivalent dedicated native PostgreSQL fixture. The ordinary development database (`dashboard_dev`) is deliberately refused by this command. Do not substitute website/Analyst credentials. The command never creates, deletes or migrates a non-loopback database. Its restore target is a new generated `dashboard_restore_<uuid>` database, removed afterward. The existing `verify:development-infrastructure` command remains the separate Docker resource/backup diagnostic; it is not the complete application acceptance gate.

Inherited Dashboard configuration is removed before executing tests. The gate supplies its own private storage directory, release OFF, worker false, billing false, data connectors false, bridge false and external integrations false. Individual fixture tests explicitly enable only their own isolated test flows. Customer provider credentials, shared sessions and other applications are not consulted. Global TLS verification cannot be disabled.

## The 23 required stages

1. Verify the unchanged extraction archive, source subtree, 270 preserved commits and 130 baseline files.
2. Check source/dependency isolation.
3. Validate the exact original 375 requirement identities, current evidence paths and generated traceability table.
4. Verify deterministic v1 contract artifacts.
5. Validate the Prisma schema.
6. Generate the Prisma client.
7. Apply the migration chain using the owner principal.
8. Check owner-side schema, migration checksums and dedicated database identity.
9. Upgrade the prior chain in a disposable schema and check preserved data/drift.
10. Create or validate the dedicated non-elevated runtime role.
11. Apply restricted runtime grants, excluding DDL/ownership and migration-ledger writes.
12. Check the schema and migration identity using the runtime role.
13. Discover and run **every non-browser `tests/**/*.test.ts` file**, including the runtime-role restriction test, sequentially with verified temporary HTTPS fixture trust. Emit TAP and JUnit.
14. Check live database/schema drift using the runtime data source.
15. Probe private local storage write/read/immutable-write rejection/temporary cleanup.
16. Seed the relational acceptance graph, execute real PostgreSQL 17 `pg_dump`/`pg_restore`, reapply restricted grants, and compare row-level fingerprints for all application tables and the migration ledger. Drop only the generated restore target and remove the source fixture graph.
17. Remove only generated `.next` output to guarantee a fresh acceptance build.
18. Generate current Next.js route types.
19. Check TypeScript.
20. Produce one optimized application build.
21. Run the actual HTTPS account-erasure browser workflow, including enabled-worker acceptance and accessibility scans.
22. Discover and run all `tests/browser/**/*.test.ts` files, currently the actual HTTPS OIDC/session browser workflow, with TAP and JUnit.
23. Run the full BI browser workflow, keyboard operation, desktop/mobile WCAG scans and rendering/responsive assertions.

All required stages must pass in the same run. A nonzero command, missing/zero/incomplete test totals, skipped/todo/canceled/failed tests, missing JUnit evidence, missing browser evidence or source changes during execution causes failure. Test subprocesses have bounded deadlines and process-group termination on timeout. No failing command is replaced with a skip or reported as acceptance.

The runner records a SHA-256 fingerprint over the tested application, scripts, tests, schema/migrations, contracts, package/lockfile and CI configuration, and checks it again before declaring success. Generated `.next`, private storage and reports are excluded. A changing source tree cannot produce a passing report.

## Quality coverage from Word section 18

| Quality area | Executable evidence |
|---|---|
| Unit/business logic and data accuracy | All engine/ingestion/confirmation/analysis/view/report suites, including exact metric and lineage assertions |
| Database integration | Full application suites using native PostgreSQL and a restricted runtime principal |
| End-to-end customer flows | Actual HTTPS OIDC browser login/session lifecycle and upload-to-export BI browser flow |
| Tenant isolation | Workspace, membership, dataset, connector, billing, storage, job and contract negative cases |
| Security | Signed access tokens, cookies/session rotation, role/permission checks, strict schemas, unsafe inputs, object-path and credential boundaries |
| Accessibility | Keyboard opening of field confirmation; keyboard scrolling of labelled tables; axe-core WCAG 2.1 A/AA scans on empty, populated and mobile Studio |
| Responsive rendering | Real calculated charts/results at desktop and 390px mobile width, no document-wide horizontal overflow |
| Performance | Maximum implemented 50,000-row ingestion/analysis/filter/grouped-chart pipeline with exact expected totals; 30-second and 512-MiB development regression budgets; fixture dashboard rendering under 15 seconds |
| Recovery | Worker process crash/replay, leases, retries, committed-effect receipts, storage quarantine/encrypted restore and real database dump/restore fingerprints |
| Contract compatibility | HTTPS mock/JWKS servers, versioned schemas, full administrative operation inventory, inactive production gate checks |
| Architectural isolation | Source/history checks, restricted dedicated resources and source-locked cross-application contracts |
| Regression | Dynamic test inventory; new nested suites cannot silently escape discovery |

Automated WCAG scanning supplements keyboard/semantic checks; it is not a claim of a human assistive-technology audit. Fixture timings are development regression limits, not production capacity certification or a customer SLA. Additional unimplemented features in the 375-point roadmap still require their own tests when built.

## Retained evidence and CI

Each run creates `.local/verification/<timestamp-uuid>/summary.json`, per-stage logs, regression/browser JUnit XML, database recovery JSON and accessibility JSON. Summary states distinguish RUNNING, FAILED, PASSED and unexecuted stages. Failed preflight writes failed evidence and exits nonzero. Database URLs are redacted from retained command output. Reports do not dump environment configuration. Raw storage objects and database dump archives are not uploaded.

The GitHub workflow uses one Ubuntu 24.04 verification job, an isolated PostgreSQL 17 service, Node 22, locked dependencies, official PostgreSQL 17 client installation and Playwright's bundled Chromium. It runs this same command once and uploads the specific reports/logs on success or failure, retained for 14 days. Artifact absence fails rather than silently succeeding. The job has read-only repository permissions and cannot deploy or merge. Newer branch runs cancel obsolete runs.

`npm run test:regression` runs the discovered non-browser suite against the same explicitly isolated runtime/owner configuration. Feature-specific scripts remain available. Local and hosted acceptance are reported separately: source presence or passing developer-run acceptance must never be presented as a successful GitHub-hosted run. See `docs/item12-verification-acceptance.md` for the latest executed result and hosted boundary.
