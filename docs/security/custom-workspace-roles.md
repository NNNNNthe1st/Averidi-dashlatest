# Custom workspace roles

Audit reference 40 extends the existing Owner, Editor and Viewer membership roles with optional workspace permission profiles. Existing members retain their current behavior until an Owner explicitly assigns a profile. Existing base authorization, view-specific sharing ACLs, subscriptions, CSRF, release controls and provider flags still apply.

## Administration

Owners open **Roles and permissions** in workspace navigation. They can create, edit, assign, unassign and delete profiles. Profiles restrict a member's built-in role; they cannot elevate it. Owners retain full control and cannot receive a profile. Promoting a member to Owner removes active custom grants in the same transaction and records an audit event.

The editor offers 20 permissions:

| Area | Permissions |
|---|---|
| Workspace | workspace.read |
| Datasets | datasets.read, datasets.write |
| Analysis | analysis.read, analysis.manage |
| Dashboards | views.read, views.manage, views.export |
| Reports | reports.read, reports.manage, reports.export |
| Jobs | jobs.read, jobs.manage |
| Monitoring | monitoring.read, monitoring.manage |
| Connections | connectors.read, connectors.manage |
| Support | support.read, support.create |
| Teams | teams.read |

Editor-only operations remain unavailable to Viewers. Billing, storage administration, membership, role administration, team mutations, sharing mutations and dataset archival remain reserved by their existing Owner policies. Custom profiles cannot delegate those operations.

Every profile includes workspace.read. Studio uses dataset, analysis and dashboard reads together, so selecting one includes all three. Write/export capabilities require the corresponding reads; report management also requires job management. The UI selects dependencies together and removes dependent capabilities when a prerequisite is removed. The server validates the same constraints. Owners cannot edit a profile to exceed the ceiling of an assigned member.

Up to 100 role definitions are supported per workspace. The administration screen explicitly limits its membership list to the first 200 members, ordered by membership ID. Member IDs match the existing membership interface. A profile with active assignments cannot be deleted; unassign it first. Removing a profile restores the member's built-in permissions and requires confirmation.

## Enforcement and concurrency

All 76 explicit workspace HTTP operations check effective permissions before invoking their existing handlers. Navigation and controls reflect those permissions; direct API requests receive the same restriction. Generic job submissions and schedules also check the permission for the underlying job kind, so job administration cannot bypass dataset, report, analysis or connection restrictions. Unknown/internal cleanup job kinds cannot be delegated through a custom profile. OAuth completion checks connection permission again before saving credentials.

A profile is evaluated against the member's current built-in role on each request. Changes affect subsequent requests. Already accepted workspace-owned jobs and schedules continue under their existing lifecycle until explicitly canceled or disabled; this change does not invent ownership metadata for older work. Requests already in progress retain the application's existing transaction boundaries.

Role mutations serialize on the workspace row. Assignments additionally lock the target membership and require both its current assignment revision and the reviewed role definition timestamp. Edits and deletion require the reviewed role timestamp. Stale changes return a conflict. All mutations create workspace audit records containing the actor and change. The API has bounded JSON input and rejects extra fields and unknown permissions.

Assignments bind to the exact membership ID, user ID and workspace ID with a composite foreign key and cascade on membership deletion. Removing and rejoining a workspace cannot resurrect a prior grant. Existing unbound grant records remain inactive until an Owner makes an explicit current-membership assignment. An invalid active profile denies access instead of restoring base access. The API writes one active profile per member; anomalous multiple valid records are intersected with the current base ceiling, and an explicit reassignment repairs them.

## Migration and verification

Apply migration `20261024040000_custom_permissions` through the existing protected development setup before starting the application. It adds a role revision timestamp, nullable membership binding and composite membership constraint. It creates no new table, does not delete existing rows and does not activate legacy grants. The complete chain contains 24 migrations and 65 application tables.

Run `npm run test:permissions` for focused PostgreSQL cases or `npm run verify:permissions` for the focused production-build/browser gate. Use the existing documented disposable loopback `dashboard_test` database, separate runtime and migration roles, and private temporary storage. The gate refuses a non-disposable URL before migrations or fixture writes. Browser verification uses real HTTPS Owner and separate Editor sessions with normal TLS validation and local certificate trust; it covers CRUD, assignment, direct denial, read-only controls, base restoration and accessibility alongside the existing workflows.

This is development source implementation. Hosted CI, actual provider accounts, production activation, deployed monitoring and final full recovery acceptance remain separately tracked in the completion checklist.
