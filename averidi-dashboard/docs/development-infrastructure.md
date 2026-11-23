# Review items 4 and 5 — historical database and storage acceptance

Current item 4 database completion and native PostgreSQL 17 acceptance are recorded in `docs/item4-database-acceptance.md`. The earlier results below are historical; they do not describe the expanded current schema. Current item 5 storage completion and recovery acceptance are recorded in `docs/item5-storage-acceptance.md`; the older results below are historical.

Current combined development setup and verification supersede the commands and limited gate described below: see `development-environment.md` and `item13-development-environment-acceptance.md`. `verify:development-infrastructure` now executes all 21 complete stages, rather than the older partial suite.

## Historical implementation

- Dashboard-only PostgreSQL 17 development service, database and volume; no other application services.
- Fresh acceptance database with a loopback-only random port, tmpfs data and unique Compose project per run.
- Eight additive migrations; Prisma worker lease fields match their existing SQL migration.
- Composite dataset/workspace foreign key rejects cross-workspace saved views in PostgreSQL.
- Database identity and non-Dashboard-table preflight before migrations; all Dashboard application tables and lease columns checked afterward.
- Prisma schema drift gate and automated pg_dump/pg_restore acceptance into a second disposable database, including a persisted fixture.
- Dedicated local storage with private permissions, validated workspace namespaces, immutable writes and symlink defenses.
- Upload, processed, snapshot, report, export and temporary namespaces; temporary-only deletion.
- Request-facing storage operations require workspace membership and appropriate read/write roles before access.
- Dedicated S3-compatible configuration and SigV4 GET/PUT/HEAD/temporary DELETE; signed conditional writes, timeout, permission-error propagation and bounded streaming reads.
- Real local storage write/read/no-overwrite/cleanup probe; object configuration checks do not require a local root.
- Locked dependencies and CI jobs for database, worker, tenant/storage workflows, schema drift and disposable-resource acceptance.

Run with Node 22 and Docker Compose v2:

```sh
npm ci
npm run verify:development-infrastructure
```

The acceptance command never uses configured customer database or storage destinations. It creates and removes only its own resources. The ordinary persistent development database remains separate and is not deleted by this check.

## Verification on 2026-10-22

- Prisma schema validation and generation: passed.
- TypeScript type checking and Next.js optimized build: passed on Node 22.
- Source/dependency isolation: passed.
- Storage unit/transport tests and real private-local-store probe: passed.
- All eight SQL migrations, tenant foreign-key rejection, worker columns, rollback and database snapshot restoration: passed using PostgreSQL WASM (PGlite 0.5.11 / PostgreSQL 18.6).
- Prisma database integration tests run through the PGlite socket adapter, with single connection and statement caching disabled for adapter compatibility: passed. This is supplementary evidence, not native PostgreSQL concurrency certification.
- Native PostgreSQL 17 Docker/pg_dump/pg_restore acceptance: **not executed here; Docker is unavailable**. The complete gate is committed for a Docker-enabled development machine or CI.
- GitHub-hosted CI has an existing account billing/spending-limit startup restriction. No passing hosted CI result is claimed.

The infrastructure implementation is present. Native development acceptance must pass before calling item 4 fully verified. No production service, remote bucket, shared product resource or customer data was accessed. Remaining application-domain features and legacy customer-record migration are separate roadmap work.

