# Independent Dashboard database

Review checklist item 4 covers the Dashboard-owned development database. The application uses only `DASHBOARD_DATABASE_URL` and its own Prisma schema. It does not read or modify any other Averidi product's database. All changes in the completion migration are additive; existing application calls remain compatible.

## Persistence coverage

The current schema contains 58 application models (including analysis, connector OAuth and storage lifecycle additions). These are relational persistence contracts for the Word architecture's database domains; their presence does not claim that the corresponding feature workflows, UI, payment provider or connectors are complete.

| Architecture domain | Persistence |
| --- | --- |
| Identity | Existing users, sessions and login attempts; explicit issuer/subject identities |
| Organizations | Organizations, organization memberships and hashed invitations |
| Workspaces and permissions | Existing memberships/invitations; roles and permission grants |
| Sources | Existing source registry; connector configuration, credential references and webhook receipts |
| Data | Datasets, versions, schema definitions and stored-object snapshot references |
| Quality | Checks, summaries and individual issues |
| Relationships | Business entities and confirmed field mappings between entities |
| Metrics | Definitions, measure/dimension/formula components and version-bound calculated results with lineage |
| Dashboards and customization | Existing JSON view definitions; pages, widgets, layouts, filters and saved views |
| Monitoring | Targets, alert rules and deduplicated alert events |
| Refresh | Existing jobs, schedules and heartbeat; source refresh execution records |
| Reporting | Definitions, export artifact references, schedules and idempotent deliveries |
| Collaboration | Expiring/revocable hashed shares, access grants and workspace audit events |
| Billing | Existing subscription entitlements; plans, customer references and invoices |
| Administration | Existing admin audit; operational events, support cases and product configuration |

Files and generated artifacts remain in independent storage. Database records hold references, sizes and checksums. Connector secrets are represented by secret-store references, not raw credentials. Existing auth mapping and JSON view definitions remain unchanged; new identity and structured-view records can be adopted by their owning features later.

## Tenant integrity and values

Every new workspace-owned table has a workspace foreign key. References between workspace-owned records include `workspaceId`, preventing cross-workspace relationships at the PostgreSQL layer. Dataset-bound records also bind their version to the same dataset. The active-version foreign key prevents a dataset from pointing at another dataset's version.

Request, worker and report services must still authorize the actor and filter reads by workspace. Foreign keys enforce relational ownership; they do not replace application authorization or implement row-level security.

Database checks reject negative sizes/counts/positions, reversed metric and invoice periods, READY metric results without values, READY exports without artifact metadata, invalid report intervals and negative delivery attempts. Monetary and metric values use fixed-precision decimals. Unique keys support idempotent webhook receipts, alert events and deliveries. Shares and invitations persist only token hashes.

Workspace deletion cascades the workspace-owned domain graph. Global identities and billing plans survive. Optional references to independently managed records use restrictive deletion rules. Integration tests verify that these policies work together with the active-version relationship.

## Development migration and checks

Use Node 22 and the existing standalone PostgreSQL 17 service:

```sh
npm ci
npm run verify:database
npm run verify:database:upgrade
```

`verify:database` validates and deploys the full migration chain, generates Prisma Client, exercises database relationships and rollback, verifies every model/table/column and migration checksum, and rejects schema drift. It targets the configured development database; it must not be run with live customer credentials.

`verify:database:upgrade` requires a loopback database and migration-owner permissions. It creates a uniquely named temporary schema, applies the prior eleven migrations, inserts representative existing dataset/source/version records, applies the completion migration, checks data preservation and drift, then removes only that temporary schema and its own scratch files. It does not downgrade or replace the selected database's existing schema.

The completion migration is transactional: invalid existing active-version relationships cause the migration to fail without partially adding the new domain tables. Investigate invalid records instead of using `db push` to bypass a failed migration.

`db:deploy` refuses non-Dashboard tables before migration. `db:check` verifies database identity, all generated model columns, completed migration names and SHA-256 checksums. `db:drift` verifies actual schema agreement. No existing migration was edited.

## Separate runtime and migration roles

`DASHBOARD_MIGRATION_DATABASE_URL` optionally supplies the schema-owner credential to `db:deploy`. Without it, the existing development URL remains supported. Keep the owner credential out of web and worker process environments.

For restricted runtime access, provision a non-owner LOGIN role without SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS. Set `DASHBOARD_DATABASE_URL` to this runtime role and `DASHBOARD_MIGRATION_DATABASE_URL` to the owner for CLI maintenance, then run:

```sh
npm run db:deploy
npm run db:grant
npm run db:check
npm run test:database-runtime-role
```

The grant command requires both URLs to target the same dedicated database/schema and refuses an elevated or table-owning runtime role. It grants application-table SELECT/INSERT/UPDATE/DELETE, migration-ledger SELECT, and schema USAGE. It revokes public schema CREATE and does not grant DDL, table ownership, ledger writes or role management. Re-run grants after adding tables. Runtime integration tests exercise CRUD and verify denied DDL and ledger writes.

## Disposable infrastructure acceptance

```sh
npm run verify:development-infrastructure
```

Docker Compose v2 creates a uniquely named PostgreSQL 17 container with tmpfs data and a loopback-only random port. The gate overrides both database URLs and storage settings, ignoring supplied resource destinations. Only that invocation's container, volume and temporary storage are removed.

The gate verifies clean migrations, legacy upgrade, restricted runtime permissions, domain CRUD and tenant rejection, existing auth/workspace/worker/storage integration, schema drift and real `pg_dump`/`pg_restore`. A fixture across all new domains is persisted before backup. Canonical per-table SHA-256 fingerprints compare every restored row, including the migration ledger. Fingerprint output contains counts and hashes rather than customer data or credentials.

## Environment boundary

This completes development database infrastructure. Staging and production databases, network/TLS policy, managed secrets, backup retention/RPO/RTO and deployment remain separate environment work. Production access is not required for these checks. Payment processing, remote connectors, BI workflow wiring and cross-product integration remain their own checklist items.
