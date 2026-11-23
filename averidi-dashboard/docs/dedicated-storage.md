# Checklist item 5 — complete independent storage infrastructure

Dashboard owns its file store and credentials. It does not fall back to website uploads, Analyst storage or their configuration. The application uses only DASHBOARD_STORAGE_ROOT for local files, or the separately configured DASHBOARD_OBJECT_* bucket identity for object storage. Runtime defaults remain local storage, release OFF and worker disabled.

## Owned namespaces and access

| Namespace | Purpose |
| --- | --- |
| uploads/{workspace}/{dataset}/{version}/source.bin | Immutable original version bytes |
| processed/{workspace}/{artifact}.bin | Processed data |
| snapshots/{workspace}/{artifact}.bin | Dataset snapshots |
| reports/{workspace}/{artifact}.bin | Stored report artifacts |
| exports/{workspace}/{artifact}.bin | Other exports |
| temporary/{workspace}/{artifact}.bin | Private temporary objects |

Request-facing operations use workspace-storage.ts to authorize membership and key scope before I/O. Workers use already authorized tenant-scoped jobs. Local storage requires private directories, validates real paths and rejects symlinks; writes are immutable, exclusive and synced. Remote writes are signed HTTPS requests with If-None-Match. No storage root is public static content.

Inventory supports both private local directories and authenticated S3 ListObjectsV2 pagination. It has strict prefix/key validation, bounded response bodies and entry/page counts, and rejects malformed XML, DTDs, repeated cursors or out-of-scope objects. It never follows symlinks or remote redirects. Known abandoned local atomic-write temporary files can be identified without allowing arbitrary paths to be deleted.

## Owner-controlled retention

No inactive-version or archived-dataset retention period is enabled automatically. An OWNER must explicitly save a policy. Storage ownership management does not require an active subscription; expired customers can still archive their data, set a hold or request cleanup.

Under /dashboard/app/api/workspaces/{workspaceId}:

- GET/PUT /storage/policy: owner-only policy management; writes require same-origin protection.
- GET /storage/lifecycle: the owner's latest 100 deletion plans/outcomes, with safe error codes.
- POST /storage/lifecycle: {"action":"PLAN"} or {"action":"APPLY"}, with Idempotency-Key; enqueues the real DATA_CLEANUP worker.
- DELETE /storage/lifecycle: {"id":"PLAN_ID"}; cancels a PLANNED candidate before deletion begins.
- POST /datasets/{datasetId}/archive: explicit owner-authorized archive, clears the active pointer and cancels unfinished dataset jobs. It does not immediately delete files.

Example policy (durations are explicit choices, not regulatory requirements):

```json
{"inactiveVersionDays":30,"archivedDatasetDays":90,"orphanGraceHours":168,"quarantineHours":24,"legalHold":false}
```

Both retention-day fields may be null to disable that expiry. Positive durations are bounded from 1 to 3650 days. The default orphan grace is seven days and the minimum grace/quarantine is 24 hours. The legalHold flag stops cleanup, including existing temporary/report cleanup; it is an application data-hold control, not a claim of legal compliance.

A plan records a workspace/key, observed object identity/size, reason and earliest deletion time. Applying waits through quarantine, then rechecks the current policy, ownership, active references, unfinished jobs and object fingerprint. Active versions are always protected. Inactive versions in an active dataset are protected while analyses or snapshots still use them. Archived datasets become eligible only after the policy duration since the archived dataset's last modification; their metadata/checksums remain for audit while version bytes are marked PURGED and snapshot bytes receive purgedAt.

Orphans are scoped to an existing workspace policy. Recent objects, pending processing and other workspaces are protected. New references discovered after planning cancel the candidate. Changed objects become CONFLICT rather than being deleted. Expired reports retain their separate existing expiry workflow.

## Publication fences and recovery

Metadata triggers and application writes share storage locks. Before physical retention deletion, a durable DELETING tombstone blocks new version/snapshot/report references and prevents a purged version from becoming active again. Policy locking serializes a committed hold with deletion. Local deletion rechecks file identity; remote deletion uses a signed If-Match ETag, and fails when the object changed.

Deletion outcomes persist as PLANNED, DELETING, DELETED, CANCELLED or CONFLICT. The job lease and cancellation state are checked at publication boundaries. If a process dies after physical removal but before acknowledgement, retry recognizes the missing object and finishes the record without duplicating publication. Missing, denied or unsupported remote operations never become fake success. Files still referenced by an active dataset are not removed to satisfy an age policy. Cancellation stops subsequent work; completed deletions cannot be undone.

## Encrypted backup and restore

Backups use a separate 32-byte hex DASHBOARD_STORAGE_BACKUP_KEY. Keep it outside the backup and retain the key needed for recovery. Every object and the manifest use authenticated AES-256-GCM envelopes. The manifest records canonical keys, SHA-256 checksums, sizes and exact database references. The private backup directory and files require 0700/0600 permissions. No application/provider credentials or database dump are stored in the manifest.

A renewable database maintenance lease temporarily fences storage publications and cleanup. The command refuses to start while jobs are running, deletion is in progress or an expired report is awaiting cleanup. Stop the separate worker and drain writes before an operational backup. A crash leaves only a bounded lease; a stale owner cannot resume publication or clear another owner's lease.

From the repository root, with Node 22, dedicated Dashboard settings and a private backup destination outside the active storage root:

```sh
DASHBOARD_WORKER_ENABLED=false npm run storage:backup -- .local/dashboard-backups/restore-point WORKSPACE_ID
DASHBOARD_WORKER_ENABLED=false npm run storage:restore -- .local/dashboard-backups/restore-point
```

Omit WORKSPACE_ID for a full-store backup. Backups must use a new empty directory. Partial backup attempts have no completed manifest and are not valid recovery points. Restore accepts an empty destination or an identical partial restore; it never overwrites conflicting objects or deletes unrelated files. It validates every encrypted source and destination before copying, then reads back and verifies every restored object. Wrong keys, corrupt bytes, changed database references, symlinks and conflicting destinations fail closed.

The database and file store are separate recovery components. Retain the matching Dashboard database backup from the existing database recovery workflow. For coordinated operational snapshots, stop web/worker writes, capture the dedicated database and file store together, then restart only after verification. Restore the matching database first and point the recovery process at its dedicated destination. Reference comparison intentionally refuses to silently attach files to a different/newer database state. This storage command does not replace or mutate the database on the operator's behalf.

Backups support at most 100,000 objects, 50 MiB per object, 50 GiB total and a 32 MiB encrypted-manifest payload. Inventory and cleanup are bounded; one cleanup attempt plans/applies at most 100 objects. Cleanup cancellation also aborts long inventory requests.

## Remote provider acceptance

Use a dedicated private test bucket and Dashboard-only credentials. A local HTTPS S3-compatible fixture verifies protocol behavior; this does not provision or certify a real cloud account's IAM, encryption-at-rest or provider retention configuration.

```sh
DASHBOARD_STORAGE_BACKEND=object DASHBOARD_STORAGE_WRITE_CHECK=true npm run storage:provider-check
```

The probe creates a unique temporary prefix, verifies immutable writes, read-back, inventory and rejection of a wrong ETag delete, then conditionally removes only its own object. A provider that ignores conditional deletion is not accepted. Provider IAM, private access, encryption-at-rest, versioning/backup replication and operational retention must be configured independently when deploying that environment. No website or Analyst storage may be reused.

## Development verification

```sh
npm run verify:storage
```

Run only against disposable Dashboard resources. The gate includes path/namespace/symlink checks, native database-backed retention, holds and reference protection, encrypted local recovery, authenticated HTTPS S3 pagination/conditional deletion, provider-probe and backup/restore CLI execution, corruption/conflict rejection and interrupted-delete recovery. CI and the disposable development-resource gate include these tests. Executed evidence is in item5-storage-acceptance.md. This completes development storage infrastructure, without claiming remote staging/production provisioning or a passing hosted CI run.
