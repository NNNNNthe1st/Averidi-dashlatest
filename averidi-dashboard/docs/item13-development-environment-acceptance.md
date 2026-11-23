# Review item 13 — independent development environment acceptance

2026-10-23: the development implementation and native local acceptance are complete. The combined gate passes the database, storage, worker, application build, authentication and browser workflows together. This is a local development acceptance, not a claim that GitHub-hosted runners or Docker provisioning ran successfully here.

## Executed results

| # | Requirement | Result |
|---|---|---|
| 1 | Dedicated development database and restricted runtime credentials | [x] Fresh native PostgreSQL 17 setup passed; all 17 migrations and 60 application tables checked |
| 2 | Private storage and repeatable secrets/configuration | [x] Storage write/read/immutability/cleanup passed; repeated setup retained identical credentials; 0600 files and 0700 directories checked |
| 3 | Development application and separate worker launch | [x] Actual `dev:serve` reached readiness with release OFF; graceful termination stopped both processes and marked the worker stopping |
| 4 | Combined complete verification | [x] All 21 stages passed; 169 root regression tests, no failures/skips/todos/cancellations |
| 5 | Actual HTTPS authentication and BI browsers | [x] Browser sign-in/session lifecycle and upload → worker profiling → confirmed meanings/rules → metrics → dashboard → edit/filter/export passed |
| 6 | Live dependency diagnostics and recovery | [x] Production-build app/database/storage/worker ready together; worker health CLI passed; readiness changed 200 → 503 after worker shutdown → 200 after restart |
| 7 | Accessibility, responsive and performance checks | [x] Three WCAG 2.1 A/AA scans with zero violations, keyboard/mobile workflow and 50,000-row accuracy/performance checks passed |
| 8 | Database backup and restoration | [x] Real PostgreSQL 17 client tools; 37-domain fixture; all 61 table fingerprints matched, including migration ledger; restored restricted-role reads passed |
| 9 | Clean build, types, contracts and source isolation | [x] TypeScript, optimized Next.js build, versioned contracts, preserved extraction history and product/source isolation passed |
| 10 | Docker provisioning runtime | [ ] Unverified here: Docker executable unavailable; the default acceptance command returned failure (`spawn docker ENOENT`) rather than silently substituting a result |
| 11 | GitHub-hosted acceptance | [ ] Remains separately required; the prior published run failed at startup. Local results do not close item 12's hosted requirement |

The authenticated browser adds one Node browser test beyond the 169 root regression tests. The BI workflow and accessibility scans are separate executed stages, not inflated unit-test counts. Exact run identifiers, source fingerprint, stage results and native-launch checks are in `item13-development-environment-results.json`.

## Implementation

- `dev:setup` provisions a dedicated persistent Docker development project, or explicitly accepts an already isolated native `dashboard_dev` database. It preserves existing developer settings, uses generated private credentials, migrates through the owner only, grants the restricted runtime role, and checks the database/storage.
- `dev:serve` launches the application and worker together, clears inherited product destinations/activation flags, prevents owner credentials from being loaded from `.env.local`, and shuts down both process groups if either fails. The default binds only to loopback and keeps release OFF. Optional local HTTPS identity fixture use is explicit.
- `verify:development-infrastructure` replaces the older selective checks with the full 21-stage gate, machine-readable evidence and failure-aware cleanup. Docker mode creates/removes only a unique disposable project; explicit native-test mode targets loopback `dashboard_test` only.
- The source fingerprint now includes Compose and development infrastructure files. CI invokes this same combined acceptance wrapper and retains both wrapper and complete-stage evidence.
- Actual browser acceptance now checks dependency readiness, the worker health CLI and shutdown/restart recovery alongside the existing business workflow. No application-domain behavior, subscription ownership or external connection was changed.

## Execution boundaries

Native acceptance used Node 22.23.4, PostgreSQL server 17.10, PostgreSQL client tools 17.11 and Chromium 153.0.8010.0. The root-only test container used an external UID shim and disabled autovacuum in its disposable native harness; these are not repository or deployment defaults. Both the test server and generated setup configuration were cleaned up by the harness. The optional container-hosted Keycloak/Caddy fixture and Docker provisioning are not certified by these native results.

Earlier failed attempts remain failed evidence: a missing native PostgreSQL client dependency, followed by a TypeScript declaration issue in the new development test helper. Both were corrected before the accepted complete run. Docker's separate unavailable-tool result remains a failure, not a pass.

Word section 17 explicitly permits progressive environment provisioning. Staging and production need separate future application/database/storage/worker/secrets/monitoring resources; they were not accessed or provisioned. No website, Analyst, main branch, production server, public routing or live cross-product integration was changed. Full acceptance across hosted/Docker environments must not be inferred from the completed local development acceptance.

See `development-environment.md` for reproducible commands, private setup, optional identity, diagnostics and cleanup.
