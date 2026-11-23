# Item 5 — storage infrastructure acceptance

Date: 2026-10-23 (Japan). Baseline: independent Dashboard commit c9df7a5cf3856316e46b661e32f7a2e7745ff4e3. Scope: review checklist item 5 and Word architecture section 12, with the storage lifecycle/recovery work carried by the dedicated worker.

| Check | Executed result |
| --- | --- |
| Schema and upgrade | 58 application models, all 16 migrations, legacy fixture preservation and zero drift passed on native PostgreSQL 17 |
| Runtime permissions | Storage lifecycle/recovery tests passed with the separate non-owner runtime role |
| Owner controls | Editors cannot set policies or enqueue retained-data cleanup; owner policy bounds, archive and data holds passed |
| Retention | Inactive/archived eligibility, disabled defaults, quarantine and active-version/analysis/snapshot protection implemented |
| Orphans and races | Recent/foreign objects preserved; old owned orphans and abandoned writes removed; late references cancel deletion and changed bytes become CONFLICT |
| Database fences | Retired bytes cannot acquire new references or become an active version; maintenance rejects object/metadata publication |
| Local recovery | All six namespaces backed up and restored; private files, encrypted manifest/content, SHA-256/size and database-reference equality verified |
| Failure rejection | Wrong key, damaged ciphertext, changed references and conflicting destination rejected before overwriting data |
| Resumable restore | Identical partial restore resumed and every restored object read back |
| HTTPS S3 protocol | Actual HTTPS fixture independently verified SigV4, immutable PUT, paginated LIST, HEAD/GET and conditional DELETE |
| S3 recovery commands | Provider probe and backup/restore CLI ran against the HTTPS fixture; all eight fixture objects restored and another workspace remained unchanged |
| Interrupted deletion | Simulated provider failure retained DELETING state; retry deleted exactly once while preserving the active source |
| Regression | 126 application tests passed, zero failed/skipped; final focused storage checks reran after command/bounds refinements |
| Application acceptance | Typecheck, isolation, optimized build and both real Chromium authentication/BI workflows passed |

The fixture verifies protocol behavior over authenticated TLS with its own ephemeral test certificate; certificate verification remains enabled. The restricted role runs real SQL, transactions, storage files and child CLI processes. The native database ran in an isolated loopback cluster configured for Asia/Tokyo; no production or other product resource was accessed.

The additive migration adds workspace storage policies, durable deletion records, maintenance leases and reference/active-version triggers, plus snapshot purge state. Prior migrations were not edited. Policies and lifecycle APIs are scoped to Dashboard-owned workspaces. Default retention is disabled until explicitly configured; release OFF, worker disabled and inactive Averidi cross-product integrations remain unchanged.

Local and protocol-fixture acceptance are complete. A real cloud bucket, its IAM/at-rest encryption/replication policies and staging/production resources were not provisioned. The provider acceptance command is available for that later environment. Docker and successful hosted CI execution are not claimed. Database backup/restore remains the separately verified database workflow and must be paired with the file backup for operational recovery; storage restore refuses mismatched references.
