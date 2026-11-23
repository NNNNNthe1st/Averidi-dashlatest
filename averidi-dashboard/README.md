# Averidi Dashboard

This independent development repository contains the Dashboard-owned project extracted from `sales_solutions/dashboard-standalone/`. Its 270 relevant source commits are preserved in `docs/history/averidi-dashboard.bundle` as Dashboard-only history, with original authors, committers, timestamps and source-commit references. The GitHub development branch starts with a verified snapshot import; the bundle contains the complete extracted ancestry. See [repository extraction](docs/repository-extraction.md) for provenance and verification.

The full Dashboard feature migration remains incomplete. Existing features still in the sales repository must be transferred and verified separately.

- Independent Next.js package with isolated routing at `/dashboard/app` (for future canonical-domain reverse proxy).
- Dashboard-only Prisma schema via `DASHBOARD_DATABASE_URL`, with no foreign keys to other applications.
- Dashboard-owned local and S3-compatible storage adapters with independent configuration.
- OIDC and browser-session code, administrative APIs, subscription entitlements and independent background-worker infrastructure.
- External Averidi integrations remain inactive; no website or Analyst source or runtime is required by this repository.

This extraction does not certify application release readiness. Complete the remaining feature migration, schema consistency, independent billing, integration and browser acceptance before release. The original extraction preserved its source baseline. Subsequent development infrastructure fixes align worker lease fields with the existing migration.

Run all commands from this repository's root. Use Node 22 for application development and CI.

```bash
node scripts/verify-repository-history.mjs
node scripts/check-isolation.mjs
```

## Independent local database

From this repository's root, start only this application's PostgreSQL container:

```bash
docker compose up -d dashboard-postgres
cp .env.example .env.local
npm install
npm run db:validate
npm run db:generate
```

The standalone app database defaults to `dashboard_dev` at `127.0.0.1:5434`. The Compose database password defaults to a local-development value only; override `DASHBOARD_DEV_DB_PASSWORD` and match the connection string in `.env.local` for any shared development environment. Do **not** use the website or Analyst credentials, databases or volumes.

This creates an isolated development database container, not a deployed Dashboard or a production-ready migration. Dashboard-owned migrations and database acceptance are implemented; see `docs/item4-database-acceptance.md`. Identity-provider acceptance and the remaining product workflows have their own completion gates.

## Item 2: independent PostgreSQL verification

The architecture document requires a **separate PostgreSQL database** for Dashboard-owned operational records and tenant-scoped access. The development database lives in its own `dashboard-postgres` Docker Compose service and named volume. It must never point at website or Analyst database credentials.

With Docker and Node 22 available from this repository's root:

```bash
docker compose up -d dashboard-postgres
npm install
npm run verify:item2
```

The item-2 gate validates Prisma schema, applies the **Dashboard-only** additive migrations to the configured database, generates Prisma Client, and performs a live rollback/foreign-key transaction test. It is destructive **only in the sense that migrations change the database indicated by `DASHBOARD_DATABASE_URL`**; run solely against a dedicated disposable Dashboard development/staging database. No production connection is required or permitted.

The GitHub workflow provisions a separate temporary PostgreSQL service for this test. The CI status must be **green** before treating this verification as passed; an existing job-startup failure is not evidence the database succeeded.

**Deployment boundary:** a Compose dev database and ephemeral CI database do not constitute a provisioned external staging environment. Staging needs its own dedicated PostgreSQL instance, unique credentials, restricted network access, backups, and migration verification before release. Neither the website nor Analyst is altered by these files.

## Item 3 — isolated Dashboard storage

The Dashboard architecture's storage requirement uses **Dashboard-only** storage, with workspace-scoped paths. Uploads use `uploads/{workspace}/{dataset}/{version}/source.bin`, and separately reserved `processed/`, `snapshots/`, `reports/` and `exports/` prefixes are independently scoped by workspace. Temporary objects must never be served directly to customers.

For local development, `DASHBOARD_STORAGE_ROOT=./.local/dashboard-storage` resolves inside this application's ignored local directory. Staging must configure a **different dedicated storage resource** with permissions available only to the Dashboard staging identity; do not reuse website or Analyst storage and do not share the development storage path. The storage functions forbid path traversal, immutable object overwrite and symlinked data objects or root directories. File download APIs must authorize the workspace before reading a storage key.

Run `npm run test:storage` to execute path, immutability and symlink checks. These are local filesystem checks, not a substitute for staging-object-store IAM and tenant tests. A dedicated staging storage resource has not been provisioned by this commit.

## Dedicated development database and storage verification

With Node 22, Docker and Docker Compose v2 installed:

```sh
npm ci
npm run verify:development-infrastructure
```

This creates fresh Dashboard-only PostgreSQL 17 and local storage resources, runs database/storage/tenant/worker checks and schema-drift detection, verifies database backup restoration, then removes only those disposable resources. Existing product databases and storage are not used. See `docs/dedicated-database.md` and `docs/dedicated-storage.md`.

## Development authentication and worker

See `docs/authentication-development.md` for the isolated HTTPS OIDC fixture, session lifecycle and discovery check. See `docs/independent-worker.md` for `worker:start`, `worker:health`, the durable queue, schedules and cancellation. Both remain independent from other Averidi applications. `npm run verify:auth-worker` exercises their infrastructure against a disposable Dashboard test database.


## Governed BI workflow

Studio now connects uploads, explicit field/business-rule confirmation, the independent analysis worker, calculated KPIs, generated dashboards, chart editing, filters/comparisons and metric CSV export. Start the separate worker with `DASHBOARD_WORKER_ENABLED=true` against the isolated development resources. See `docs/independent-dashboard-engine.md` for usage, bounds and `verify:bi`; executed checks are recorded in `docs/item8-bi-acceptance.md`.

Item 7 completes twelve worker processor entry points, durable schedules, publication receipts and crash recovery, plus stored CSV reports and protected in-app delivery. Run `npm run verify:worker` against disposable Dashboard resources; see [worker acceptance](docs/item7-worker-acceptance.md) for the executed native PostgreSQL and 109-test results.

Item 6 authentication acceptance now covers real HTTPS OIDC browser sign-in, isolated cookies, replay rejection, session rotation/revocation/expiry and BETA/OFF logout. Run `npm run verify:authentication` on disposable resources; see [authentication acceptance](docs/item6-authentication-acceptance.md). Real-provider and website SSO activation remain a later integration.

Item 10 adds eight external data connector adapters with protected configuration, OAuth/API credential lifecycle, encrypted secrets, bounded pagination, rate handling and durable refresh. See [connector infrastructure](docs/external-data-connectors.md) and [acceptance](docs/item10-connector-acceptance.md); run `npm run verify:connectors` against disposable resources. They remain disabled until Dashboard-only provider settings and consent are configured.

Item 5 completes owner-controlled storage retention, quarantine, orphan cleanup and encrypted backup/restore with reference and checksum verification. See [storage infrastructure](docs/dedicated-storage.md) and [storage acceptance](docs/item5-storage-acceptance.md); run `npm run verify:storage` against disposable Dashboard resources. Retention remains disabled until an owner sets a policy.

Item 9 adds the independent plan catalog, verified billing receipts, subscription/invoice reconciliation and protected administration/support/configuration APIs. See [subscriptions](docs/subscriptions.md), [administration](docs/central-administration.md) and [acceptance evidence](docs/item9-subscriptions-administration-acceptance.md). Run `npm run verify:subscriptions` against isolated Dashboard resources. Billing remains disabled by default; live provider and central website checkout/UI integration are separate work.


Item 11 completes the prepared, inactive Averidi connection contracts: versioned identity/admin/subscription/event schemas, real-route navigation, protected read handlers and verified HTTPS conformance tests. See [future contracts](docs/future-averidi-contracts.md) and [acceptance](docs/item11-integration-contract-acceptance.md). Run `npm run contracts:check` or `npm run verify:ecosystem`. Environment flags cannot override the false source-level integration lock; no other application is connected or modified.


Item 12's required acceptance entry point is `npm run verify:complete`. It runs the full discovered suite under a restricted test role, upgrade/drift/recovery checks, one clean production build, both browser workflows, keyboard/WCAG and performance checks, and retains structured evidence. See [complete verification](docs/complete-verification.md) and [executed acceptance](docs/item12-verification-acceptance.md). It requires an isolated loopback `dashboard_test` database, separate runtime/migration roles, Node 22, PostgreSQL 17 client tools and Chromium. Passing local acceptance is distinct from a successful hosted CI run.

## Combined independent development environment

Run `npm run dev:setup` to prepare dedicated persistent development resources, then `npm run dev:serve` to start the web application and separate worker with restricted credentials. `npm run verify:development-infrastructure` now runs the entire 21-stage gate against disposable resources. Native PostgreSQL modes are also supported. See [development environment](docs/development-environment.md) and [item 13 results](docs/item13-development-environment-acceptance.md) for setup, isolation, diagnostics and actual acceptance boundaries.
