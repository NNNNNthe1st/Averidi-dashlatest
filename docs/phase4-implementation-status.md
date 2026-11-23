# Phase 4 — Data Sources, Ingestion & Dataset Versioning (40–73)

Last code review: 2026-10-22. Branch: `feature/independent-dashboard`.
The user's authoritative master plan is `Averidi_Dashboard_Complete_Architecture.docx` together with the numbered 1–375 product requirements. **Implemented code must be distinguished from executed acceptance.**

| # | Requirement | Evidence / status |
|---|---|---|
| 40 | Unified source abstraction | Coded — `DashboardDataSource` tenant-bound Prisma entity, FILE source and disabled provider catalog |
| 41 | CSV | Coded — ingestion engine, preview, persistent upload and profiling job |
| 42 | XLSX | Coded — sheet selection preserved through worker |
| 43 | JSON | Coded — safe row validation |
| 44–47 | Google Sheets, Shopify, Stripe, QuickBooks | Provider kinds are declared, **live connectors not implemented** |
| 48–51 | WooCommerce, HubSpot, Square, Xero | Provider kinds declared as future connectors, **not implemented** |
| 52 | Additional connectors | Future demand-driven work; intentionally inactive |
| 53 | Source health | Coded — source status model and worker success/failure timestamps |
| 54 | Secure credentials | Encryption/decryption primitives and tenant/source AAD coded; live provider credential lifecycle not wired |
| 55–56 | Token renewal and disconnect | **Not implemented**; depends on genuine connector/provider integrations |
| 57 | Persistent datasets | Coded — independent database + isolated storage |
| 58 | File preview | Coded — protected, non-persistent preview API and Studio preview |
| 59 | Schema profiling | Coded — profile worker with validation and provenance |
| 60 | File-size controls | Coded — ingestion/file size validation and bounded body header |
| 61 | Safe parsing | Coded — strict CSV, JSON and Excel pipelines |
| 62 | Atomic imports | Coded — staged version, worker lease and transactional active-version update |
| 63 | Dataset versions | Coded — immutable per-version object and history API |
| 64 | Replace mode | Coded — uploaded replacements preserve active data until verification |
| 65 | Append mode | Coded — explicit identity, deduplication and conflict rejection |
| 66 | Synchronize mode | Coded for explicit complete snapshots; provider-based recurring sync not implemented |
| 67 | Record identity | Coded — required for append/synchronize |
| 68 | Duplicate detection | Coded — file profile and identity-based import |
| 69 | Overlap detection | Coded — overlap stats and conflicting identity rejection |
| 70 | Rollback | Coded — tenant-authorized verified version restore; verifies stored object checksum |
| 71 | Refresh history | Coded — versions include processing state and timestamps, job lifecycle recorded |
| 72 | Late-arriving records | Coded in identity merge/complete-snapshot semantics |
| 73 | Historical backfill | Coded for files via append/synchronize and late-record acceptance; provider historical imports pending |

## Acceptance commands (isolated development only)

```bash
cd /workspaces/averidi-dashboard
nvm use 22
set -a
source .env.local
set +a
npm run verify:phase4
npm run verify:item1
npm run db:check
```

`verify:phase4` validates and deploys migrations to the configured **Dashboard-only** database, then runs test suites including identity append, complete-snapshot synchronization, isolated source models, worker lifecycle, failure preservation and build.

Do not run this on a production database. Do not run from `sales_solutions` or merge to `main`.

**Not yet certified:** Current new Phase 4 commits have not received an executed, green Codespace acceptance run. Repository-hosted Actions are failing before test jobs begin, so build/test execution cannot be inferred from commits.

**No scope creep:** Live external business connectors, renewal/revocation integrations, external SSO and website/Analyst integration remain inactive. They must not be represented as working capabilities.

## Superseding connector infrastructure (item 10, 2026-10-23)

The historical PLANNED statements for providers 44–51 are superseded by `docs/external-data-connectors.md`: eight provider-specific OAuth/API readers, credentials and remote refresh are implemented and fixture/native-database tested. Live account activation and additional resources are not claimed. Point 52 remains demand-driven.
