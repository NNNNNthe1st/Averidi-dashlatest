# Account erasure and restore recovery

Audit reference 211 extends the existing account, ownership, billing, storage and worker services. It does not activate a release or contact a real provider by itself.

## Customer workflow

When explicitly enabled, account settings links to `/settings/erase`. The authenticated review lists every current membership and which solo-owned workspaces and organizations will be deleted. Sole Owners of shared resources must transfer ownership first. Legal holds, unresolved checkouts, subscriptions without terminal provider confirmation and financial retention block acceptance. Review is bound to current identity, profile, memberships, organization state and support scope. Submission requires the exact confirmation phrase and the reviewed revision, same-origin authentication and a transactional ownership recheck.

Acceptance marks the account unavailable, revokes all sessions, fences owned resources, disables connectors and schedules, revokes pending owned invitations and cancels queued work. Admission locks and database triggers prevent in-flight or subsequent writes from racing the reviewed scope. Other Owners cannot demote or remove the last active Owner while a departing account is being erased. Existing data and reads remain available to authorized remaining Owners.

The response returns a private receipt secret once. The UI stores it only in the link fragment, uses an `Authorization: Erasure …` header, omits session credentials and polls a minimal status endpoint. The database and recovery ledger retain its SHA-256 hash, never the secret. The receipt stays reachable while release is OFF; possession of a request ID alone grants no access. A retry requeues a blocked/failed request and cannot bypass holds, retention or ownership checks. Confirmed requests cannot be canceled through the customer interface.

## Actual cleanup

A dedicated, durable database queue survives workspace deletion. The independently running worker claims requests with `FOR UPDATE SKIP LOCKED`, a five-minute lease and a unique fencing token. Expired claims can be reclaimed; completion and progress require current ownership. Each invocation removes at most eight storage objects, across every supported area, using the existing local/object backend and fingerprint checks. Storage maintenance, per-workspace policy locks, billing state and legal holds are checked before each destructive transaction. I/O failure leaves a recoverable request; no completion is inferred from a profile flag.

An empty fresh inventory is required before the owned workspace and cascading metadata are removed. Solo organizations are removed only after their workspaces and all other memberships are absent. The final transaction removes the account, external sign-in mappings, sessions, personal state, memberships, authored invitations and support cases; clears accepted-by references; and redacts personal actor identifiers in retained audit records. Operation, resource reference, transaction correlation and timestamps remain. The mutation journal permits only this exact identifier redaction under an active erasure request; arbitrary edits and all deletes remain rejected.

Shared business data, reports, financial records and contextual audit details belonging to remaining Owners are retained. They may contain information supplied by customers, including local opaque resource references; this workflow is not arbitrary content discovery/redaction throughout other Owners’ datasets. External identity-provider and connected-provider accounts are unchanged. No claim is made that old encrypted backups have been physically destroyed. `COMPLETED` means the reviewed active account and solo-owned data have actually been removed, with these disclosed retention boundaries.

## Explicit configuration

Flags default inactive. Configure only in private Dashboard runtime configuration:

- `DASHBOARD_ACCOUNT_ERASURE_ENABLED=true`
- `DASHBOARD_ACCOUNT_ERASURE_KEY`: dedicated 32-byte random key encoded as 64 hex characters; preserve it across recovery.
- `DASHBOARD_ACCOUNT_ERASURE_LEDGER_ROOT`: absolute normalized private directory, outside and disjoint from source/object storage and storage backup directories. The runtime owns it with mode 0700; decisions have mode 0600. Symlinks are rejected.
- `DASHBOARD_WORKER_ENABLED=true`: readiness requires the additional `ACCOUNT_ERASURE` worker capability when enabled.
- `DASHBOARD_ACCOUNT_ERASURE_FINANCIAL_RETENTION_DAYS`: optional explicit approved integer from 1 to 36500. Unset/blank blocks financial erasure. No duration is inferred from the architecture or invented by this implementation.

Financial retention covers retained binding/customer/invoice/checkout/event dates. Subscription reconciliation stores the actual provider status separately from Dashboard plan entitlement. A retired or inactive plan cannot masquerade as provider-confirmed cancellation: a binding must have a reconciliation timestamp and terminal `canceled`/`incomplete_expired` status. Existing reconciliation and calculation logic remain authoritative. Provider cancellation must be completed before acceptance; erasure does not silently cancel a commercial relationship.

An independently authenticated administrator can list bounded request summaries at `GET /api/admin/v1/account-erasures` and reconcile stale/restored owned billing through `POST /api/admin/v1/account-erasures/{requestId}` with `{ "action": "RECONCILE_BILLING", "reason": "…" }`. Manage permission, a reason, lease exclusion and existing billing reconciliation are mandatory. This requeues the request; it does not waive retention or legal holds. Customer secret/hash and full decision payload are not exposed through administrative summaries. No new impersonation facility is introduced.

## Backup and restore

Before any destructive step, the worker durably writes an immutable, HMAC-signed decision with fsync and atomic creation. Decisions contain only the request ID, local scope references, keyed identity digest, receipt hash and request time. They remain outside normal workspace storage. A conflicting, tampered, missing-key or unsafe-path ledger fails closed. Retain this ledger independently of ordinary snapshots, protect the key separately and restore the latest authoritative ledger rather than an older database snapshot’s copy. Do not delete or roll back the ledger as part of a restore.

Keep customer release OFF and stop normal serving/workers during recovery. Restore the database and latest ledger/key first. Run:

```bash
DASHBOARD_RELEASE_MODE=OFF npm run account:erasure:reconcile
```

This validates all decisions, restores missing queue entries, revokes resurrected sessions and re-fences existing target scopes. It refuses identity mismatches and active claims. A completed request is deliberately reopened when reconciling old snapshots; the worker must inspect and clean the restored scope again. Storage backup restoration validates the authoritative ledger before I/O and automatically performs this reconciliation after its maintenance lease is released. Storage-only restores also requeue decisions whose account no longer exists so orphaned restored files are erased.

Worker startup checks sealed decisions against database fences, completed scopes and actual storage. It refuses known resurrection until reconciliation. Run the independent worker with release OFF until every reopened request completes, resolve holds/provider issues through authorized controls, and verify recovery state before reopening customer traffic. This mechanism cannot detect a ledger that an operator itself rolled back or lost; latest-ledger retention and restore discipline are operational requirements. It is not a substitute for the separate final database recovery/hosted deployment acceptance gate.

## Bounds and verification

Reviews support at most 1000 workspace and 1000 organization memberships. Existing backend inventory/backup limits remain enforced; an exceeded inventory or unavailable backend produces a failed/blocked request, never a false completion. The ledger limits individual signed files to 256 KiB and an inventory to 100000 decisions. No new provider activation, quota commercial policy, dependency or generic job kind is introduced.

`npm run verify:account-erasure` refuses non-disposable database configuration before fixture writes. It runs focused native PostgreSQL tests, schema validation/migrations/client generation, a fresh typed production build, dedicated HTTPS erasure browser acceptance, existing source and BI browser suites and separate HTTPS authentication. Clean acceptance builds explicitly disable persistent compiler caching; normal builds retain their defaults. The ordinary worker loads the optional erasure modules only when enabled. Root regression discovery also includes the erasure tests. The combined complete gate includes the dedicated erasure browser stage and checks all six accessibility scans; hosted CI retains its evidence. This addition does not itself certify a successful run of the entire combined gate or hosted CI. Browser fixtures use isolated storage, a private ledger and an ephemeral trusted certificate, with no live account or production host.
