# Phase 4 (40–73) — implementation and acceptance ledger

Source of truth: Averidi Dashboard 375-point master plan and the Phase 4 implementation-phase instructions. Date: 2026-10-22.
Scope: **independent** `averidi-dashboard` repository, `feature/independent-dashboard`. No production, website, Analyst changes or cross-app runtime dependency.

**Evidence levels:** `CODED` means code is present but latest acceptance has not yet executed in a working Codespace; `TESTED BEFORE` means an earlier test passed prior to this set of commits; `CONTRACT ONLY` means future providers are advertised as unavailable, not connected.

| # | Original requirement | Status | Evidence / limitation |
|---|---|---|---|
| 40 | Unified data-source abstraction | CODED | Prisma DashboardDataSource, workspace-bound source service, isolated dataset relation |
| 41 | CSV | TESTED BEFORE; expanded CODED | Dedicated file engine, uploader, profiling worker |
| 42 | XLSX | CODED, acceptance pending | Worksheet selection preserved from upload to worker; multisheet tests |
| 43 | JSON | TESTED BEFORE; expanded CODED | Bounded structured parser; file upload and tests |
| 44 | Google Sheets | CONTRACT ONLY | Catalog disabled pending approved OAuth/provider integration |
| 45 | Shopify | CONTRACT ONLY | Catalog disabled |
| 46 | Stripe | CONTRACT ONLY | Catalog disabled |
| 47 | QuickBooks | CONTRACT ONLY | Catalog disabled |
| 48 | WooCommerce | CONTRACT ONLY | Expansion only |
| 49 | HubSpot | CONTRACT ONLY | Expansion only |
| 50 | Square | CONTRACT ONLY | Expansion only |
| 51 | Xero | CONTRACT ONLY | Expansion only |
| 52 | Additional connectors | CONTRACT ONLY | Future demand-driven plugin/adaptor extension |
| 53 | Connector health | CODED for FILE | Health states, last sync/checked/error, worker result update; provider health inactive |
| 54 | Secure credentials | CODED contract | AES-256-GCM authenticated, tenant/source-bound envelope, no provider tokens stored |
| 55 | Token renewal | Not active | Requires real provider implementation; never fabricate refresh success |
| 56 | Disconnect/revoke | Not active | Requires real provider tokens; do not pretend to revoke remote credentials |
| 57 | Persistent datasets | CODED | Prisma dataset, immutable version metadata, workspace file storage |
| 58 | File preview | CODED | Authorized POST preview, no persistence until import |
| 59 | Schema profiling | CODED | Existing engine and worker profile, data types/field statistics |
| 60 | File-size controls | CODED | Multipart Content-Length and parsed upload byte constraints |
| 61 | Safe parsing | CODED | CSV/XLSX/JSON engine rejects bad inputs |
| 62 | Import transactions | CODED | Staged immutable object, serialized metadata+job insert, worker activation; orphan object reconciliation still needed |
| 63 | Dataset versions | CODED | Version table, status/provenance, history API |
| 64 | Replace mode | CODED | New version becomes active only after worker verification |
| 65 | Append mode | CODED | Deterministic identity-aware append, duplicate skip/conflict refusal |
| 66 | Synchronize mode | CODED internal and file snapshot flow | Explicit complete-snapshot requirement; external provider execution disabled |
| 67 | Record identity | CODED | Explicit per-upload identity, stored per version |
| 68 | Duplicate detection | CODED | Parser warnings, identity and exact overlap suppression |
| 69 | Overlap detection | CODED | Conflicting same-identity rows rejected in APPEND |
| 70 | Rollback | CODED | Authorized previous READY version and checksum verification; cancellation of pending profile |
| 71 | Refresh history | CODED | Version history, import mode, jobs status/timing; version display |
| 72 | Late-arriving records | CODED | Identity-aware append and complete-snapshot synchronization |
| 73 | Historical backfill | CODED | Earlier-period rows accepted in append/snapshot without period truncation |

## Safety invariants

1. A dataset's `activeVersionId` changes only after verified processing or an authorized checksum-verified rollback.
2. The upload-owned job `profile_<versionId>` alone governs that import's terminal state; ordinary reprofile jobs cannot cancel its version.
3. A failed import leaves the previous active version unchanged. Terminal cancellation, expired-job recovery and failed first import reconcile statuses.
4. Overlapping changed identities never silently double-count: APPEND rejects them; SYNCHRONIZE requires a complete authoritative snapshot.
5. Source metadata, objects, versions, jobs and API access belong to one Dashboard workspace.
6. External provider integrations remain inactive. Their future contracts do not establish real OAuth or production availability.

## Verification

Previously passed, before this phase's new commits: `verify:item2`, `verify:phase3`, `verify:item1` in the user's dedicated Codespace.

Latest Phase 4 source changes require a fresh Codespace run:
```bash
cd /workspaces/averidi-dashboard
nvm use 22
git fetch origin feature/independent-dashboard
git pull --ff-only origin feature/independent-dashboard
set -a; source .env.local; set +a
docker compose up -d dashboard-postgres
npm run verify:phase4
npm run verify:item2
npm run verify:item1
git status --short
```

**No completion certificate is justified until the above suites pass** and an actual upload, version change and rollback are exercised via the running dev app. GitHub Actions on this repository has currently failed before runner allocation (no job steps); this is an infrastructure verification blocker independent of test results.

## Future infrastructure, not Phase 4 first-party file acceptance

- External connectors 44–51 need provider credentials/OAuth, refresh, revocation, source-specific tests and customer approval when those integrations are brought into scope.
- Stage production-like storage, migrations and recoverable orphan-object garbage collection before public rollout.
- Verify application-level race isolation and upload size limits with browser/network acceptance.
