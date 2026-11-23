# Checklist item 4 development database acceptance

Completed against published baseline `59ae6adb057e74d79ba08cd6e1a595b4fbe0e600` on 2026-10-22. This is review checklist item 4, not roadmap Phase 4 ingestion.

| Check | Result |
| --- | --- |
| Complete database-domain persistence | 53 application models; 37 added models across the missing architecture domains |
| Clean migration deployment | All 12 migrations applied to a fresh, isolated PostgreSQL database |
| Existing development data upgrade | Prior 11 migrations plus source/dataset/version fixture upgraded; names, source link, active version, profile, size and checksum preserved |
| Schema drift | None after installation, upgrade or restoration |
| Tenant relationship integrity | Cross-workspace foreign-key changes rejected across new related domain models; foreign active dataset version rejected |
| Transaction and deletion behavior | Domain fixture rollback passed; workspace graph cascades while global identities/plans survive |
| Value integrity | Exact metric/invoice decimal round trips, invalid periods, incomplete READY export rejection and duplicate webhook rejection passed |
| Runtime role | CRUD passed with separate non-owner role; schema CREATE, ownership and migration-ledger writes denied |
| Regression | All 100 application/domain tests passed with no skips. The separate runtime-role test also passed |
| Build and source checks | TypeScript, isolation checker and optimized Next.js build passed |
| Backup recovery | PostgreSQL custom-format dump restored into another database; all 53 application tables and the migration ledger matched canonical row fingerprints; restored schema and migration checks passed |

Environment: Node 22.23.4, Prisma 6.19.0, native PostgreSQL 17.10 and PostgreSQL 17.6 dump/restore tools. Optional Prisma checkpoint and Next telemetry were disabled for the completed expanded run. PostgreSQL ran in a temporary, loopback-only local cluster. The root-only tool container required a local UID shim to start the native binaries; it is not part of this repository or the Docker gate.

Docker is unavailable in this execution container, so the Docker Compose orchestration command itself was not executed here. Its constituent SQL, migration, role, regression and recovery checks ran against native PostgreSQL. The maintained `verify:development-infrastructure` command provisions PostgreSQL 17 through Docker on development/CI hosts and runs these checks with generated destinations, role grants, a full-domain backup fixture and row-fingerprint comparison.

No production resources were accessed. The other Averidi products and `main` were not modified. The new persistence models do not complete the feature workflows covered by checklist items 5–13.
