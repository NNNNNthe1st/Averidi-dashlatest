# Architecture completion — customer workspace workflows

This progress record uses the 230 audit reference numbers from the architecture comparison. These are not the original 375 roadmap requirement numbers. The source baseline is `cad90fc884c42f383207c7fc5dbc0df3d2133b8a` on `feature/independent-dashboard`.

## Completed in the first customer-workflow change

| Audit reference | Result | Implementation |
|---|---|---|
| 12 | Working application entry | `/dashboard/app` opens the existing workspace chooser instead of the development placeholder. |
| 13 | Working generic Studio entry | `/dashboard/app/studio` opens workspace selection instead of stale migration messaging. |
| 138 | Customer jobs and refresh schedule console | Workspace jobs page shows the latest 100 jobs, progress, attempts, safe error codes and cancellation; connected-source refresh schedules can be created and disabled. Report schedules are managed on Reports. |
| 147 | Report authoring | Tenant-scoped list/create/edit APIs and customer form; CSV reports bind to an existing current governed dashboard. Authorization, bounded input, current-source checks, optimistic concurrency and audit records are enforced. |
| 151 | Customer report workflow | Create/edit, queue generation, download generated files, schedule recurring in-app delivery to the signed-in member, disable schedules and open the report inbox. Formats remain CSV and transport remains IN_APP. |
| 167 | Existing connector setup and management UI | All eight existing adapters have configuration forms, optional import-field mapping, OAuth or WooCommerce credential setup, reconnect, manual refresh, status and disconnect controls. Provider credentials remain server-owned; deployment flags are not activated. |
| 180 | Customer subscription/invoice screen | Owners can inspect the existing Dashboard subscription, period, cancellation state, hold and paginated invoices. This does not implement checkout or self-service subscription mutations (178–179). |
| 195 | Customer support UI | Submit workspace support cases, inspect own request status/history and paginate results through the existing protected APIs. |

## Completed in the monitoring and exploration change

Baseline: `5fe5850dc9712d9e9ca7387a017db90c29b99ce9`, same independent development branch.

| Audit reference | Result | Implementation |
|---|---|---|
| 66 | Customer transformation editor | Profile-guided, ordered rename/trim/remove-empty/exact-text filtering steps queue the existing transformation worker and produce a separately profiled version. New meanings and business rules must be confirmed again. |
| 72 | Archive and retention interface | Owners can archive a dataset, save retention/legal-hold policies, plan cleanup, review/cancel deletion candidates and apply eligible cleanup. Existing lifecycle authorization, quarantine and reference protections remain authoritative. |
| 122 | Private saved filter presets | Save, list, apply and remove validated presets scoped to user, workspace and dashboard. Saving never grants additional data access. |
| 123 | Interactive source-record drilldown | Accessible chart-group controls narrow current filters and expose authorized, paginated source records. Existing metrics are recalculated by the governed engine. Missing-value groups are not guessed; source-record detail is explicitly distinguished from metric-specific contribution rules. |
| 139 | Target authoring and management | Create/edit/remove targets with period, source dataset, currency and definition-version binding, tenant constraints, audit records and stale-edit protection. Targets referenced by rules cannot be removed or rebound unsafely. |
| 141 | Alert-rule authoring | Create/edit/enable/disable dataset-bound rules using ready metrics and either an explicit threshold or matching target; manual evaluation uses the current confirmed analysis. |
| 142 | In-app alert notifications | A new ready analysis atomically queues evaluations for enabled rules bound to its dataset. Real worker events appear in a refreshing workspace inbox with editor acknowledgement and audit history. Transport scope is in-app; external email/SMS delivery is not implemented. |

The new nullable target binding migration preserves existing records. Legacy unbound rules retain their explicit evaluation behavior and are not silently added to automatic dispatch. New authoring requires explicit source binding. Changes in currency or governed metric definition refuse evaluation until the customer reviews the target/rule.

The existing CSV-report browser fixture now explicitly awaits network readiness; the installed browser polling implementation treated a returned Promise as truthy before its predicate completed. This is a test fix, not a replacement of working report generation.

Verification for the monitoring/exploration batch: 18 migrations, a prior-chain upgrade with preserved dataset contents and no schema drift, 197 passing regression tests, TypeScript, a clean production build, real Studio/workspace/monitoring/cleaning HTTPS browser workflows, 13 desktop/mobile accessibility scans without violations, and the separate HTTPS OIDC browser regression case. The focused monitoring gate refuses development/customer databases before migrations or fixture writes.

Run `npm run verify:monitoring` using the documented disposable loopback `dashboard_test` environment and distinct runtime/migration roles. For local development, apply the additive migration through the existing protected development setup before starting this revision. No production provisioning or external-product activation is implied.

## Completed in the onboarding and collaboration change

Baseline: `b11451284085c56bda72a40f9e34343954279b81`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 36 | ☑ Implemented | A six-step Studio guide follows actual saved data, confirmed meanings, saved rules, current governed analysis and its generated dashboard. It links to the existing forms and jobs, survives reloads, and invalidates completion for a changed version, failed quality or stale dashboard. Viewers receive read-only guidance. |
| 37 | ☑ Implemented | Customer organization create/list/read/rename/delete and explicit workspace link/unlink workflows. Renames reject stale revisions, deletion refuses linked workspaces, and linking requires ownership of both resources. BETA still hides and refuses unlisted workspaces. |
| 38 | ☑ Implemented | Organization member/owner administration, last-owner protection, hashed seven-day single-use invitations, private token display, acceptance, revocation and recent organization audit activity. Concurrent invitation claims and owner demotions are serialized. Organization membership never substitutes for workspace authorization. |
| 39 | ☑ Implemented | Workspace team create/list/rename/delete and member selection, owner-managed with stale-edit protection and audit events. Composite database constraints restrict each team to current members of its own workspace; revoking workspace access cascades team membership removal. Teams group people and do not assign custom permissions (40). |
| 41 | ☑ Implemented | Dashboard-specific display name and active session settings, individual owned-session revocation, current/all-device sign-out, and existing owner workspace naming. Profile updates reject stale values; current-session revocation expires the browser cookie. Identity/email/password/recovery remain with the trusted identity provider. |

This change extends the existing Studio, membership and session systems. It does not replace their working calculation, upload, billing, connector or authorization behavior. Organization member removal explicitly leaves independently assigned workspace access unchanged; workspace owners continue to manage that access on Members. Custom roles and granular permission administration remain audit 40.

The additive migration introduces three new tables and a nullable Dashboard display name. Existing organizations, memberships, invitations and workspaces are preserved. It contains no destructive schema changes or new dependencies. Lists disclose their bounds (200 organizations/teams/members, recent 200 invitations/100 audit events, 100 active sessions).

Verification observed for this change: all 19 migrations applied, 63 tables checked during a prior-chain upgrade with preserved data and no schema drift, 203 passing regression tests without skips, TypeScript and a clean production build. Six new acceptance tests exercise actual PostgreSQL constraints, tenant boundaries, CSRF, forged actor fields, invitation replay/races/expiry/revocation, concurrent last-owner changes, team membership cascades, Unicode profile values and owned-session invalidation. The focused verification entry point refuses non-disposable databases before migrations or fixture writes. `npm run verify:collaboration` passed, including six focused tests, a fresh production build, actual HTTPS Studio/collaboration/workspace/worker workflows, 17 desktop/mobile WCAG 2.1 A/AA scans with no violations, and the separate real HTTPS OIDC browser case. Source isolation passed across 338 files. The restored isolated Chromium 153 test executable needed a valid local font configuration; no application TLS or authentication checks were disabled.

Run `npm run verify:collaboration` with the documented disposable loopback `dashboard_test` database and separate runtime/migration roles. Apply the new migration through the existing protected development setup before running this application revision locally.


## Completed in the dashboard pages and layout change

Baseline: `19ae49da335f81fb38feacc8388434e24d755622`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 118 | ☑ Implemented | Saved widget positioning and resizing on a 12-column grid, card dragging, pointer-based resize handles and keyboard/touch position/size controls. Bounds, overlaps, widget ownership and stale revisions are enforced on the server. Custom layouts stack into a readable single column on narrow screens. Existing dashboards keep their automatic grid until explicitly customized. |
| 124 | ☑ Implemented | Customer dashboard page creation, renaming, reordering and deletion; page selection and widget transfers. Deleting a page moves its widgets to the first remaining page, preserving their sizes; the last page cannot be deleted. Pages persist through the existing tenant-scoped `DashboardPage` model. |

Page layout is presentation metadata, not a second source of metric definitions or a new access boundary. Every current widget belongs to exactly one page, including hidden widgets. New governed widgets receive a free position without moving existing cards. Page saves use the parent view's revision and a transaction, so concurrent layout/content edits cannot silently overwrite one another. Dataset/version/analysis bindings and calculated values remain authoritative in the existing pipeline. Filters apply across pages; CSV metric reports retain their dashboard-wide scope.

The editor supports up to 12 pages, positions within 12 columns and rows starting at 1–1000, with sizes of 2–12 columns/rows. A layout draft locks conflicting dashboard content edits, prompts before dashboard switching/reloading, and has an explicit discard action. Source/analysis reloads do not erase a layout draft. Page saves write a workspace audit event. This change uses existing schema and dependencies.

Verification: 207 passing regressions, four focused layout/tenant/revision/security acceptance cases, a prior migration-chain upgrade with preserved data and no schema drift, TypeScript and a clean production build. Real HTTPS browser checks exercise saved positions/sizes, card drag, pointer resize, page create/rename/reorder/transfer/delete, reload persistence, responsive layouts and the original Studio/workspace/monitoring workflows. `npm run verify:layout` passed, including the separate real HTTPS OIDC browser case and 19 desktop/mobile WCAG 2.1 A/AA scans without violations. Clicking a resize handle preserves the current size, and keyboard activation focuses its width control. Source isolation passed across 345 files. The gate refuses non-disposable databases before migrations or fixture writes; it requires a disposable loopback `dashboard_test` database with separate migration/runtime roles.

All workspace pages receive a shared navigation shell. The shell verifies the existing Dashboard identity and workspace membership before rendering children. Every API continues to enforce its own authorization. BETA allows the two workspace-selection entry pages without releasing additional workspaces. OFF behavior is unchanged.

## Completed in the dashboard sharing change

Baseline: `c5724e4e513f01605fae064dbc78642f775384f7`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 153 | ☑ Implemented | Owner-managed, dashboard-specific VIEW/EDIT grants and explicit WORKSPACE/RESTRICTED access mode. Restricted dashboards require a current same-workspace membership and active grant; Owners retain control. EDIT also requires the workspace Editor role. Grant replacement, revocation, expiry, stale-edit protection and audit records are enforced. |
| 154 | ☑ Implemented | Owner-created view-only links with one-time token display, server-side token hashing, expiry within 30 days, signed-in same-workspace redemption and revocation. Revoking a link invalidates its derived grants; a revoked individual grant cannot be restored by replaying the same link. Tokens travel in URL fragments and are removed from browser history before explicit redemption. |

Existing dashboards retain WORKSPACE access until an Owner explicitly restricts them. Sharing never creates workspace memberships, raises a workspace role or changes source-dataset permissions. These are authenticated workspace sharing links; anonymous/public access is not enabled. Removing workspace membership deletes its bound grants, so rejoining does not restore earlier grants. Preexisting grants without a current membership binding remain preserved but do not authorize restricted views.

The same policy protects dashboard reads/edits, layouts, filters, drilldown, refresh, CSV exports, report definitions, export downloads, inboxes, jobs, schedules and delivery. Report delivery rechecks current recipients. Each new report export binds its original source dashboard, so moving the report to another dashboard cannot expose an old restricted export. Legacy standalone reports retain their workspace boundary. Studio reflects per-dashboard read-only access and accepts a shared dashboard selection.

Two additive migrations preserve existing rows, default dashboard visibility to WORKSPACE and bind existing view-backed report exports to their currently recorded dashboard. Historical source bindings that were never recorded cannot be reconstructed. No new models or dependencies are introduced. Management lists disclose bounds: up to 200 current members, 100 active links, 200 active grants and 40 recent expired/revoked links per dashboard.

Verification: 213 passing regressions without failures/skips, including six focused PostgreSQL sharing cases; all 21 migrations applied, 63 tables checked in a prior-chain upgrade with preserved data and no schema drift; TypeScript and a clean production build passed. `npm run verify:sharing` passed on the final source, including a fresh production build, actual HTTPS Owner and separate Editor sessions, read-only Studio controls, direct/link revocation, fragment-only redemption, all existing Studio/workspace/layout/monitoring flows, 22 desktop/mobile WCAG 2.1 A/AA scans without violations, worker stop/recovery and the separate HTTPS OIDC login case. Source isolation passed across 354 files. A non-disposable database URL was rejected before database access. The test browser uses normal separate processes for independent contexts; application TLS/authentication checks remain enabled.

Run `npm run verify:sharing` with the documented disposable loopback `dashboard_test` database and separate runtime/migration roles. The gate refuses non-disposable databases before migrations or fixture writes. Apply both additive migrations through the existing protected development setup before running this revision locally.

## Completed in the request protection change

Baseline: `1bad78c8878037c60554b0f3509f37758dfa45ee`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 209 | ☑ Implemented | Shared PostgreSQL request-frequency limits at the existing API boundary: separate authentication/general API budgets, atomic cross-process counters, database-clock UTC windows, safe 429/retry responses, fail-closed store/configuration errors, explicit trusted-proxy configuration, normalized network attribution and expired-counter cleanup. |

Default limits are 30 authentication and 600 general API requests per network per minute. Client-supplied forwarding headers are ignored by default; unattributed requests share a budget. An optional dedicated address header requires explicit trust configuration and an ingress that overwrites it and excludes direct web access. IPv6 /64 grouping prevents privacy-address rotation from creating new budgets. Health checks and sign-out stay reachable. Existing release denials and endpoint authorization/CSRF behavior are preserved. These are API frequency limits; deployment automation (9), subscription quotas (181) and deployed monitoring (220) remain separate.

One additive migration introduces a short-lived counter table without changing existing rows; no dependencies are added. The existing authentication maintenance removes expired counters through both the worker and cleanup command. An independent Caddy configuration example is included for review and is not activated. See `docs/security/request-rate-limits.md` for defaults, attribution, operational requirements and bounded scope.

Verification: all 218 regressions passed without failures/skips, including five new focused cases. The 22-migration upgrade preserved data across 64 tables with no schema drift. TypeScript and a clean production build passed. `npm run verify:request-limits` passed on the final source: five focused PostgreSQL cases, fresh production build, actual Next request-boundary 429/retry/no-store checks, all existing HTTPS BI browser workflows, 22 desktop/mobile accessibility scans without violations, worker stop/recovery and the separate HTTPS OIDC browser case. Source isolation passed across 358 files. A non-disposable database URL was refused before database access.

## Customer subscription self-service change

Baseline: `b0ac9523c7c2b33ac1024fd8548c03c019dc56d1`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 178 | ☑ Development implemented | Owner plan selection and hosted purchase using the existing approved Dashboard catalog; current provider price validation, durable one-checkout reservation, idempotent retry/resume, explicit expiration, duplicate/legacy purchase protection, signed current-state completion, delayed-payment reconciliation and verified operator recovery. Browser return alone never grants access. |
| 179 | ☑ Development implemented | Owner hosted subscription management with an explicit dedicated-account configuration: approved plan upgrades/downgrades, period-end cancellation, payment methods and invoice history; current-state refresh reuses existing subscription/invoice reconciliation and preserves access holds. |

The existing owner subscription/invoice display, immutable financial mappings, entitlement policy, signed webhook boundary and provider reconciliation remain in use. Manual binding or legacy assignment cannot compete with a pending checkout. One additive migration creates durable checkout attempts without modifying existing rows. No dependencies, commercial prices, quota limits or external-product connections are introduced. Customer self-service is OFF by default. See `docs/billing/customer-self-service.md` for configuration, recovery, verification and acceptance boundaries. The administrative contract gains the strictly validated recovery operation; external integration remains inactive.

Verification on the final development source: all 232 regression tests passed without failures/skips, including 14 focused customer-billing cases. The 23-migration prior-chain upgrade preserved existing data across 65 tables with no schema drift. TypeScript, generated contract consistency, source isolation and clean production builds passed. `npm run verify:customer-billing` passed: focused PostgreSQL tests, fresh build, actual production HTTPS checkout/portal/activation/cancellation workflows, existing request-boundary and BI/collaboration/sharing/layout/monitoring/worker checks, 27 desktop/mobile accessibility scans without violations, and the separate HTTPS OIDC browser case. The gate refused a non-disposable database before access. No live provider account was used.

Live provider/account/charge acceptance remains 182, and comprehensive quotas remain 181. This development change does not certify the full final recovery gate, hosted CI or original 375-item traceability (228–230).

## Completed in the independent release change

Baseline: `f27a3b3fbc9668e71e1132eb948a8daaa3557502`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 9 | ☑ Development infrastructure complete | Committed-source isolated builds; self-contained, content-addressed release artifacts with complete file/mode/link/migration verification; private installation and authenticated local supervision; real web/worker readiness before activation; previous-release retention; same-schema promotion/rollback and failed-candidate restoration; durable forward-migration fencing, repair and restart. A manual, read-only GitHub artifact workflow and a separate systemd example are supplied without provisioning or activating a host. |

The existing Next configuration, customer routes, calculation/billing code and worker lease/processing behavior remain unchanged. The worker receives only an optional ready callback after its first committed heartbeat for release supervision. No application migration, dependency, commercial policy or cross-product connection is introduced. The default customer release remains OFF. See `docs/releases/independent-release.md` for build provenance, private configuration, operational commands, safe migration/rollback boundaries and actual-host acceptance requirements.

Verification: all 237 regression tests passed without failures/skips, including five release cases covering integrity/mode drift, secrets and link rejection, private/idempotent installation, runtime environment/role-setting isolation, actual kernel lock exclusion and rejection of unauthenticated loopback control. TypeScript and source isolation passed. The 23-migration upgrade preserved existing data across 65 tables without schema drift. `npm run verify:releases` built the real committed source in a clean temporary context with runtime credentials excluded, relocated it, then exercised real Next and worker activation, OFF preservation, promotion/rollback, stale-operation rejection, unhealthy-candidate recovery, forward-only migration maintenance/repair, a maintenance-fenced supervisor restart, a healthy supervisor restart and retained database/storage fixtures. Its additional disposable migration executes only `SELECT 1` and its receipt is removed after fixture shutdown.

Final verification used a newly initialized disposable PostgreSQL 17 cluster after the reused fixture cluster reported a PostgreSQL datafile EOF error. No application code was changed to work around that storage error. The lifecycle harness now allows up to 180 seconds for startup, including verification of the full artifact; the final run passed both maintenance and healthy restarts.

This completes release **source infrastructure**, not a deployed service, real HTTPS ingress, hosted CI success, full acceptance/recovery certification or deployed monitoring. Those environment/acceptance items remain open; no production/server/main/website/Analyst operation was performed.

## Custom workspace permissions change

Baseline: `a3f93fbadb738c69d4aeadcb3d4457ce8dc18fe0`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 40 | ☑ Development implemented | Owner custom-role creation/editing/deletion and current-member assignment; 20 granular read/write/export permissions, prerequisite selection, built-in role ceilings and protected Owners; permission-aware navigation/controls and enforcement at all 76 workspace HTTP operations, including underlying generic job/schedule capabilities and OAuth completion. |

The existing Owner/Editor/Viewer authorization, view ACLs, CSRF, entitlement, release and connector policies remain in place. Unassigned members keep their existing behavior. Membership-bound grants cannot survive removal/rejoin; preexisting unbound grants stay inactive. Concurrent mutations require the reviewed member assignment revision and role definition timestamp. In-use deletion, assigned-member ceilings, strict bounded input and audit events protect role administration. Owner promotion clears active profiles atomically. Already accepted workspace jobs/schedules retain their existing lifecycle until canceled or disabled; changes apply to subsequent requests.

One additive migration adds role revisions and a composite membership binding using the existing roles/grants models, without activating or deleting existing records. No dependency or external connection is added. The role screen discloses its 100-definition and 200-member-list bounds. See `docs/security/custom-workspace-roles.md` for capabilities, concurrency, migration and operational boundaries.

Verification on the final development source: all 245 regression tests passed without failures/skips, including eight focused permission cases. All 24 migrations applied; the prior-chain upgrade preserved data across 65 tables without schema drift. TypeScript, source isolation across 389 files and a clean production build passed. `npm run verify:permissions` passed: focused PostgreSQL cases, fresh build, actual HTTPS Owner and independent restricted Editor workflows, direct read/write/administration denial, read-only Studio/connections, profile editing and built-in-role restoration, all existing BI/billing/collaboration/sharing/layout/monitoring/worker checks, 33 desktop/mobile accessibility scans without violations, and separate real HTTPS OIDC authentication. A non-disposable database URL was refused before database access. Native PostgreSQL 17.6 verification used a fresh memory-backed disposable cluster after scratch-backed fixture storage had reported a datafile EOF error; no analysis logic was changed to work around that environment failure. Hosted CI, live accounts, deployed infrastructure and the full final acceptance/recovery gate remain open.

## Quality review and dataset relationships change

Baseline: `ca69e41ff76b1ab6395e539e98f42b485f9cd73d`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 67 | ☑ Development implemented | Interactive issue history, acknowledgement/reopening with notes and stale-review protection; exact-row deduplication and reviewed fill/replacement transformations; verified resolution requires a different corrected current version and a passing checksum/revision-bound validation. Business-rule findings require a governed check. Historical evidence and audit records remain intact. |
| 68 | ☑ Development implemented | Advisory cross-dataset candidates based on matching field names and exact typed key overlap, with measured distinct/matching/missing-key counts and cardinality. Customer review is required; suggestions never activate relationships automatically. |
| 69 | ☑ Development implemented | Tenant-scoped relationship create/list/preview/edit/delete APIs and interface; up to three key pairs, reviewed cardinality/join type, exact version/checksum binding, optimistic revisions, serialized authoring and audit events. |
| 70 | ☑ Development implemented | Real queued INNER/LEFT/RIGHT/FULL joins with explicit one-to-one/many-to-one/one-to-many/many-to-many rules, typed composite keys, null handling, row/column/file bounds, cancellation/lease/replay protection and stale-source publication fencing. Output becomes a separately profiled dataset with version lineage; existing sources and calculation logic remain in use. |

The existing quality, entity, relationship, dataset, storage and worker models are reused. One additive migration adds a revision timestamp to relationship definitions; existing definitions remain stored and require explicit review before execution. The worker now advertises 13 implemented capabilities. Definitions are bounded to 100 per workspace; the UI discloses its dataset, definition and quality-history list bounds. Generic job submission cannot bypass dataset permissions. Source-version changes invalidate the saved join binding until explicitly reviewed again. See `docs/data/quality-and-relationships.md` for exact matching, fanout, verification and retention semantics.

Verification on the final development source: all 252 regression tests passed without failures/skips, including seven new focused cases covering typed/composite/outer joins, fanout limits, suggestions, authoring races, real worker publication/replay, tenant/custom-permission denials, stale sources, quality acknowledgement/reopening/fixed verification, confirmation revision invalidation and HTTP origin/input bounds. All 25 migrations applied; the prior-chain upgrade preserved data across 65 tables without schema drift. Source isolation across 403 files, TypeScript and a clean production build passed. `npm run verify:data-model` passed all 10 stages, including the focused tests, fresh build, actual HTTPS relationship suggestion/preview/create/edit/delete and materialized output, retained sources, duplicate correction and verified issue resolution, all existing BI/billing/collaboration/sharing/roles/layout/monitoring/worker workflows, 37 desktop/mobile accessibility scans without violations, and separate real HTTPS OIDC authentication. A non-disposable database URL was refused before access. Verification used native PostgreSQL 17.6 and Node 22 with normal HTTPS validation and isolated certificate trust. No external provider, production host or other product was accessed.

## Customer metric and formula authoring change

Baseline: `076407a6fc130aa75e7f6906248127d61f02e275`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 105 | ☑ Development implemented | Customer create/list/preview/edit/delete workflow for named formulas over ready governed metrics, with business meaning, optional business-timezone reporting period, explicit review, unit checks, bounded decimal arithmetic and retained source/rule/component lineage. Saved results require matching reviewed previews, current source/confirmation bindings, optimistic edits and audited authoring. |

This extends the existing metric definition/component models without replacing built-in calculations or their financial treatments. Raw arbitrary columns, executable code, unavailable inputs, incompatible units, dependency cycles and zero denominators are refused. Results are reviewed snapshots displayed on Custom metrics; existing dashboard chart/report/target bindings retain their standard metric catalog. Changed versions or confirmations require explicit re-preview/reconfirmation. Read-only custom profiles have no authoring controls. A maximum of 100 definitions and the dataset list bounds are disclosed. No migration, dependency, pricing policy or external activation is introduced. See `docs/metrics/customer-formulas.md` for exact numerical, freshness, permission and display scope.

Verification on the final development source: all 259 regression tests passed without failures/skips, including seven focused formula cases covering numerical golden values, precedence, units/rounding, grammar/injection/complexity refusal, real definition/components, protection of built-in definitions, stale previews and concurrent edits, changed confirmations, actual business-period filtering, tenant/custom-role/subscription boundaries and HTTP origin/input limits. TypeScript, source isolation across 411 files and a clean production build passed. The unchanged 25-migration chain upgraded with preserved data across 65 tables and no schema drift. `npm run verify:custom-metrics` passed all 10 stages, including actual HTTPS create/preview/edit/delete, retained exact results and input lineage, separate read-only custom-role controls, the existing BI/billing/collaboration/sharing/roles/relationships/quality/layout/monitoring/worker workflows, 40 desktop/mobile accessibility scans without violations and separate real HTTPS OIDC authentication. A non-disposable database URL was refused before access. An initial browser edit check exposed a changing textarea accessible name when loading saved content; explicit stable labels corrected it, and the final complete gate passed. No financial calculation, source-provider account, production host, main branch or other product was changed.

## Marketing APIs, configurable APIs and signed webhooks change

Baseline: `01e0f85f910179238070ad1a65dd3d38011f938a`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 168 | ☑ Development implemented | Google Analytics 4 and Google Ads OAuth, credential refresh, fixed read-only daily campaign reports, source-calendar windows, stable complete pagination, partial-report rejection, exact money/fraction handling, field mapping, manual refresh and schedules. |
| 169 | ☑ Development implemented | Operator-approved HTTPS JSON GET sources with public/bearer/API-key authentication, explicit identity and field mapping, root-array/envelope input, bounded stable cursor snapshots, encrypted credentials, refresh/schedules, permission-aware authoring and revocation. |
| 170 | ☑ Development implemented | HMAC-SHA256 complete-snapshot receiver, one-time/rotatable encrypted keys, bounded raw-body verification, durable file/version/job/receipt admission, event replay and monotonic-sequence checks, backpressure, worker publication binding, delivery history and guarded retry. |

The existing eight provider integrations, governed dataset calculations and worker lease pipeline remain in use. A separate source-management screen adds these four source types without extending the legacy provider enum. One additive migration binds existing webhook receipts to their tenant dataset/version/job; legacy unbound receipts remain inert. Source-origin allowances are explicitly scoped and do not expand legacy egress. No dependencies, commercial quota policy or external activation are added. Both connector feature flags default inactive. The worker still advertises 13 implemented capabilities. See `docs/connectors/marketing-api-webhooks.md` for exact source contracts, private configuration, numerical/report limitations and recovery behavior.

Verification on the final development source: all 272 regression tests passed without failures/skips, including 13 new focused native PostgreSQL cases. All 26 migrations applied; the prior-chain upgrade preserved data across 65 tables without schema drift. Source isolation across 427 files, TypeScript and a clean production build passed. `npm run verify:custom-sources` passed all 11 stages: focused tests, fresh build, dedicated actual HTTPS source setup/credentials/refresh/schedules, signed delivery/replay and worker publication, synthetic Google consent and real application OAuth callbacks, GA4/Ads worker imports, read-only source controls, all existing BI/billing/collaboration/sharing/roles/quality/relationships/formulas/layout/monitoring/worker workflows and separate HTTPS OIDC authentication. All 48 desktop/mobile accessibility scans reported no violations. A non-disposable database URL was refused before access. Verification used Node 22.23.4, native PostgreSQL 17.6 and isolated trusted HTTPS fixtures; no real provider account was contacted.

These are complete supported development adapters and a documented complete-snapshot protocol, not arbitrary marketing providers or incremental CDC. Live account/provider approval and real-source acceptance remain 171. Comprehensive quotas, deployed monitoring, hosted CI, original roadmap traceability and the full final recovery gate remain open. No production host, main branch, other product or customer integration was changed.

## Plan capacity and protected configuration change

Baseline: `32ffdc97b329eb740e62488013332237e0bb5f99`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 181 | ☑ Development implemented | Strict optional plan limits for 14 resource categories, including seats and registered storage bytes; database-enforced concurrent admission across customer services, webhook and worker publication; shared schedule capacity, safe downgrade retention, pre-I/O storage checks, permanent worker error handling and tenant-scoped desktop/mobile Plan usage. |
| 192 | ☑ Development implemented | Discoverable typed protected configuration catalog with eight allowlisted settings, six new transactional customer-admission controls, mandatory revision checks on new settings, monotonic edits, change reasons, independent read/manage authorization and atomic previous/new-value/revision audit records. |

Existing plans, prices, subscriptions and support settings remain compatible. No commercial amounts or automatic plan limits are introduced; absent/null quotas preserve prior behavior, zero prevents additions. Plan ceilings remain Dashboard-owned and independently administered. Capacity reductions preserve existing data, reads, disabling, revocation and removal. Registered file bytes measure retained source/snapshot/report records until actual deletion, not temporary/orphan/backup operational storage. Storage cleanup and legal holds retain their existing rules. One additive migration introduces quota functions and triggers without new tables or changes to existing records. The worker still advertises 13 capabilities; no dependencies, release activation, real provider or other product connection is added.

The new configuration defaults preserve existing behavior. Controls cover new workspace/organization creation, workspace/organization invitations and acceptance, new member-only share links and new schedules. Existing schedules continue to run. The protected API excludes secrets, executable settings, authentication, release, integration activation and deployment configuration. Existing support clients retain their payload compatibility; revision checks are available for those keys and mandatory for the six new keys. Generated administrative input contracts match runtime validation. See `docs/subscription-plan-quotas.md` and `docs/security/protected-configuration.md` for exact scope, counting, recovery and API contracts.

Verification on the final development source: all 283 regression tests passed without failures/skips, including 11 new focused native PostgreSQL cases. All 27 migrations applied; the prior-chain upgrade preserved existing data across 65 tables without schema drift and verified quota functions/admission inside the isolated upgrade schema. Source isolation, generated contract consistency, TypeScript and a clean production build passed. `npm run verify:plan-policy` passed all 11 stages, including real HTTPS quota rejection, exact usage display, downgrade retention and expired-subscription usage access, the existing source/OAuth and BI/billing/collaboration/sharing/roles/quality/relationships/formulas/monitoring/worker workflows, readiness loss/recovery and separate HTTPS OIDC authentication. All 50 desktop/mobile accessibility scans reported no violations. A non-disposable database URL was refused before access.

The first browser run found a long-plan-identifier mobile overflow in the new usage screen; wrapping and bounded scrolling fixed it. Review also identified that revoked direct grants must free share capacity: current membership-bound direct grants are now counted and their admission is enforced at the grant boundary. The final complete rerun passed with both corrections. Verification used Node 22.23.4, native PostgreSQL 17.6, isolated trusted HTTPS fixtures and no real provider account. This does not certify hosted CI, physical storage budgets, deployed monitoring or the entire final recovery/acceptance gate. No production host, main branch, website, Analyst or external product activation was changed.

## Persistent mutation evidence and activity history change

Baseline: `d3996e7832721c06f68cbee316af0d20e5907f22`, same independent development branch.

| Audit reference | Status | Implementation |
|---|---|---|
| 210 | ☑ Development implemented | Automatic transactional mutation evidence for all 63 persistent resource models other than the journal and ephemeral heartbeat/rate counters; verified service/worker actor context, existing domain-event correlation, private-value exclusion, runtime edit/delete protection, retained deletion evidence and scoped/paginated Owner/account/administrative activity APIs and screens. |

The existing domain/admin/organization audit records, data calculations, business authorization and billing semantics remain in use. The new journal records operation, resource reference, changed column names, scope, transaction ID and explicit actor provenance without copying source data, profile values, messages, credentials or token values. Unattributed writes remain labeled with the database role; provider events do not inherit the initiating customer's user ID. Read-only service transactions retain their existing behavior. Historical changes before the migration are not backfilled or invented. One additive migration adds the journal and resource triggers. It has no cascading resource foreign keys; runtime edits/deletions are rejected. Retention/privacy policy and account-wide erasure remain separate work; this is not a claim of immutability against the database owner or a log of every HTTP read/denial.

Owner activity is limited to the current workspace. Personal history excludes workspace and organization records, while independent administrative access uses the existing signed read capability. Cursors must belong to the same scope and filters; screens display 25 events per page. The exact BETA account-history routes are allowed while release OFF continues to deny them. See `docs/security/mutation-audit.md` for attribution, coverage, metadata/privacy boundaries, deployment grants and the read APIs. No dependencies, job kinds, provider activation, production/main or other product changes are introduced.

Verification on the final development source: all 289 regression tests passed without failures/skips, including six new focused native PostgreSQL cases. All 28 migrations applied; the prior-chain upgrade preserved existing data across 66 tables without schema drift. Source isolation, generated contract consistency, TypeScript and a clean production build passed. `npm run verify:mutation-audit` passed all 11 stages, including real HTTPS Owner/personal history, older/newer pagination, all existing API/webhook/marketing OAuth, BI/billing/collaboration/sharing/roles/quality/relationships/formulas/quotas/monitoring/worker workflows, readiness recovery and separate HTTPS OIDC authentication. All 54 desktop/mobile accessibility scans reported no violations. A non-disposable database URL was refused before access.

Focused testing and browser review identified and corrected UTC-default schema drift, cross-actor domain attribution and a missing BETA account-history route allowance; the final complete verification passed with those corrections. Verification used Node 22.23.4, native PostgreSQL 17.6 and isolated trusted HTTPS fixtures, without a real provider account. The checkout was restored after workspace maintenance and all source blobs were verified against the published baseline before editing. Hosted CI, deployed operations, the complete final recovery gate and account-wide erasure remain open.

## Account erasure and final local recovery acceptance

Baseline: `38ae35b69d573358c16824816509b0d15e4d814d`, same independent development branch. These are the 230 audit references, not the original 375 roadmap numbers.

| Audit reference | Status | Implementation and evidence |
|---|---|---|
| 211 | ☑ Development implemented and verified | Authenticated, revision-bound account deletion review; ownership transfer restrictions; explicit confirmation and session revocation; account/workspace/organization write fences; a durable independent leased cleanup queue; actual solo-owned file and metadata deletion; shared-owner preservation; legal-hold and financial-retention checks; private receipt/status/retry; scoped audit-identifier redaction; signed erasure decisions and restore reconciliation. |
| 228 | ☑ Local acceptance and recovery verified | The complete combined gate passed all 22 stages on the final source, including all 302 regression tests, preserved repository history, isolated runtime permissions, schema upgrade/drift checks, real database dump/restore, clean production build and actual HTTPS erasure/authentication/BI acceptance. Supplemental source/OAuth browser acceptance also passed. Hosted CI and live infrastructure remain separate references. |

The existing account, ownership, worker, billing, storage, provider and calculation services remain in use. One additive migration introduces the independent erasure queue and nullable admission/provider-state fields. Existing financial calculations are unchanged; actual provider status is stored separately from plan entitlement so a retired plan cannot disguise an active provider subscription. There is no invented financial-retention duration: absence of an explicitly approved policy blocks deletion of financial history. Shared business content remains with its other Owners, while personal account state and identifying actor references are removed within the documented scope. External provider accounts and retained backups are not silently destroyed.

The erasure flag defaults OFF. Enabling it requires a dedicated private key, a private signed-decision directory outside ordinary storage/backups and the independent worker. Cleanup checks current holds, maintenance, billing state, ownership, identity and scope markers before destructive work and final completion. File work is bounded and resumable after I/O failure or an expired lease. A restored organization without its fence is blocked rather than falsely reported deleted. Recovery requires release OFF, the latest retained decision ledger and reconciliation before reopening traffic; storage-only restores also requeue orphaned restored files. See `docs/security/account-erasure.md` for exact configuration, retained-data boundaries, administrative billing recovery and restore instructions.

Final local evidence: Node 22.23.4, PostgreSQL 17.6, separate migration/restricted runtime roles, isolated storage and normally verified HTTPS fixtures. All 29 migrations applied across 67 Dashboard tables with preserved upgrade data and no schema drift. Actual dump/restore fingerprints matched across 68 tables including migration history, with 37 fixture domains and restored restricted-role reads. All 302 regression tests passed with zero failures, skips or cancellations, including 13 erasure cases. The combined `npm run verify:complete` passed all 22 stages, and the final source/OAuth browser supplement passed. The final browser runs covered 59 desktop/mobile accessibility scans with zero violations: six erasure, 40 BI, five dedicated billing and eight source scans. A non-disposable database URL was refused before fixture/migration writes. No real provider account, production host, main branch, website or Analyst was changed.

The verified runtime-source fingerprint is SHA-256 `2361f95b4b2d1b2e21b5b80056d5d2b0fcf4664c03ca0a88c38bb5897df4f1b7` across 519 selected files. Initial runs exposed a response/navigation race in the browser fixture and missing local recovery client tools; both were resolved. Clean verification builds now explicitly skip persistent compiler caching, preserving normal build defaults. Optional erasure modules load only when enabled, preserving the existing ordinary worker startup path. The final combined rerun passed after these corrections. This certifies local development acceptance; successful hosted CI, deployed monitoring, live-provider acceptance and the original 375-item traceability remain open.

## Verification of the first customer-workflow batch

- PostgreSQL 17.6, disposable loopback `dashboard_test`, separate migration and restricted runtime roles, Dashboard-private temporary storage, Node 22.23.4.
- All 17 migrations applied; runtime role grants applied.
- 193 regression tests passed, zero failures/skips/cancellations. This includes new report authoring tenant, role, revision, CSRF, audit and worker-output acceptance.
- TypeScript passed and production build passed.
- Real HTTPS browser/worker workflow passed: prior Studio ingestion, confirmation, metric calculations, charts, filtering, CSV export, mobile behavior and worker recovery, plus new application entry, settings, support, subscription display, report create/edit/generate/download, schedule disable, job console and inactive connector setup.
- Ten desktop/mobile WCAG 2.1 A/AA scans completed with zero violations.
- Separate real HTTPS OIDC browser test passed: provider login, scoped cookies, callback replay, rotation, revocation, expiry and release/logout boundaries.

The container's browser downloader returned truncated archives. Browser acceptance used an isolated locally extracted Chromium executable with CPU rendering, no sandbox (container test process only), and the existing ephemeral certificate SPKI trust. Application TLS/authentication checks were not disabled. No browser executable or host-specific test helper is committed.

This is not a new complete 21-stage/release certification: the dedicated database dump/restore recovery stage, provisioning, live external accounts and hosted CI acceptance were not certified by these runs. Existing recovery code was not changed.

Run the focused workflow using the documented disposable test database and existing test environment:

```bash
npm run verify:workspace-ui
```

The complete verification gate discovers the new report test and invokes the expanded BI browser acceptance automatically.

## Remaining development work from the audit

### Operational monitoring and original requirement mapping update

Baseline: `ecf6033b7ffd9e1405963e23e4089a4b7a4956b9`, same independent branch. No existing application source, schema/migration or dependency version was changed.

| Audit reference | Status | Updated result |
|---|---|---|
| 220 | ☑ Local monitoring implementation; ☐ deployed operations acceptance | Added an independent one-shot monitor, real HTTPS readiness/storage I/O/database/worker probes, bounded aggregate failed-job/backlog/expired-lease/error probes, private durable incident state, grouped threshold/reminder/recovery notifications, retry with stable delivery IDs, an HTTPS sink interface, and reviewed service/timer/configuration examples. Nothing is installed or activated. |
| 230 | ☑ Traceability completed | All 375 original numbers, titles and acceptance descriptions are preserved and mapped to actual current source paths, related verification and explicit gaps in [the numbered table](roadmap/requirements-375.md), with structured provenance and a deterministic checker. This closes the mapping task, not every underlying requirement. |

The new monitor's six focused tests passed using a separate restricted runtime role on native PostgreSQL 17.6 and normally verified local HTTPS. They include the actual command across process restarts, real storage I/O, a failing/successful receiver, stable retry identity and a resolution event. The entire discovered regression suite passed **308/308 tests**, with zero failures, cancellations or skips. TypeScript, source isolation (476 scanned files), exact original requirement identities/evidence paths, and whitespace/diff checks passed. The dedicated test command rejects non-disposable databases before fixture access.

The source fingerprint after these changes is SHA-256 `40d09bd6696587a4ba209b3767549b2fee1862ae1ff94787c7a6a3316db1cff6` across 530 selected files. The prior 302-test/22-stage application/browser/build/recovery evidence remains baseline evidence. This update did not rerun that entire combined gate and does not claim a new full release certificate. The complete gate now has 23 stages, adding traceability and documenting its already-present erasure browser stage. No customer-facing application logic was modified.

Original-roadmap counts: **231 source-supported, 55 partial, 20 awaiting live acceptance, 40 deferred/conditional, 20 not implemented and 9 unverified business outcomes**. A source-supported check means reviewed scoped code and related suite evidence, not individual 375-point acceptance or production readiness. No aggregate completion percentage is asserted.

The detailed mapping exposes additional product gaps that the shorter architecture list did not enumerate: original 100–108 general units/workspace settings/localization/fiscal-calendar work; 127 consistent KPI freshness; 136–139 complete comparison selection/alignment; 143 target pace; 149 customer cohorts/retention/value; 152 CAC; 161 per-card targets; 170 dedicated segments; 174 missing-category drilldown; 181 universal autosave; 192 customer demo workflow; 202/257–258 stale-source/customer failure notifications; 216 general changed-only connector sync; 222 query-result caching; 239–241 administrative diagnostics; 262–263 PDF/image exports; 266 branded rendered output; 295 referrals; 299–300 general API/outbound webhook lifecycle; 314–321 product telemetry; 325/327/332–334/336–337 approved customer-facing legal/security disclosures; 338 complete reviewed threat model; 342 recurring dependency review; and 355–356 physical-device/manual assistive-technology acceptance. Some entries are explicitly future/conditional; the full table records those distinctions and related existing code. These must not be hidden by marking the architecture mapping complete.

Monitoring still needs actual installation, a configured/verified alert destination, off-host availability/dead-man checks, capacity/latency monitoring and on-call ownership. Hosted CI remains account-billing blocked; real-provider acceptance, staging/provisioning and authorized ecosystem integration remain separate. No production host, external receiver, website, Analyst or main branch was changed. See [operational monitoring](operational-monitoring.md).

### Verified comparison and KPI freshness completion

Baseline: `09a8942b86d083628226bf4227c32f6997171c37`. The following are **original 375 roadmap numbers**, not the 230 comparison audit references.

| Original # | Status | Completed development behavior |
|---|---|---|
| 127 | ☑ Implemented and verified | Each governed widget shows its actual source processing and governed calculation timestamps; manual and worker CSV reports carry the same provenance. |
| 136 | ☑ Implemented and verified | Previous-month selection, actual calendar month ends, clamped calendar dates, explicit ranges/day counts and shared governed calculations. |
| 137 | ☑ Implemented and verified | Previous-year selection, leap-day handling, explicit ranges/day counts and confirmed business-timezone boundaries. |
| 138 | ☑ Implemented and verified | Custom prior dates persist in private presets/report definitions and reach chart calculations, exports and the report worker; overlapping periods are visibly disclosed. |
| 139 | ☑ Implemented and verified | Explicit observed-through dates align elapsed day counts; too-short prior ranges are rejected. Source-record inspection uses the same effective range as KPIs and reports. No clock-based or missing-row inference of completeness. |

The final combined gate passed **all 23 stages** on the final source: **312/312 regression tests**, zero failures/skips/cancellations, 29 migrations, preserved upgrade data/no drift, real database dump/restore, clean optimized build, actual HTTPS OIDC/erasure/BI workflows and accessibility. The BI browser includes month/year/custom selection, observed-period alignment, saved filters, source rows, CSV download/freshness and desktop/mobile scans. It recorded 43 BI scans; erasure and dedicated billing recorded six and five respectively, without violations. Supplemental source/OAuth browser verification also passed with eight scans, bringing this final acceptance to 62 accessibility scans without violations. The first browser run found an ambiguous select label; adding an explicit accessible name corrected it, and the entire gate then passed.

Verified source fingerprint: SHA-256 `ee6104c6c152bf5e6fb5da27ccb7042f27a2b30aa150b2ba50f4cba4f259e4df`, 534 selected files. The existing `compare: true` behavior remains previous equal-length period. New comparison options are optional and strictly validated. Source/filter/permission checks, current-version guards and existing financial definitions remain authoritative. CSV's original columns retain their order, with comparison/provenance columns appended. No migration, dependency change, production access, main merge, provider activation or inter-product connection is included.

The [375-item table](roadmap/requirements-375.md) now records 236 source-supported, 52 partial, 20 live-pending, 40 deferred/conditional, 18 not implemented and nine unverified business outcomes. The remaining unchecked rows continue to apply. This is a verified development batch, not a claim that all original requirements or production acceptance are complete.

### Verified business preferences and source-provided segments

Baseline: `45c70c6da60dc86d9a4a4a36f360465ef770c571`. These are **original 375 roadmap numbers**.

| Original # | Status | Completed development behavior |
|---|---|---|
| 101 | ☑ Implemented and verified | Owner-configured, validated primary workspace currency; defaults for new confirmations, with existing dataset currencies and values preserved. |
| 105 | ☑ Implemented and verified | Explicit named IANA workspace timezone; defaults for new confirmations and timezone-aware timestamp display, without changing existing dataset period rules. |
| 107 | ☑ Implemented and verified | Workspace date/number locales, shared timestamp formatting across business pages/Studio/activity/billing, and date-only calendar-day preservation. English interface text is unchanged. |
| 170 | ☑ Implemented and verified | The existing customer-segment recognition is now connected to field confirmation, governed dimension filters and source-record inspection. Segments come from confirmed source fields; no behavioral classification is guessed. |
| 323 | ☑ Implemented and verified | Reusable workspace currency/timezone/locale infrastructure and international formatting while retaining explicit dataset business semantics. |

One additive migration adds nullable presentation metadata and a revision counter to existing workspaces. It does not invent preferences for existing customers. All 30 migrations apply, schema upgrade preserves existing data, and schema drift checks pass. Owner changes are revision-bound, serialized against membership changes, audited and protected by existing session/custom-permission/origin/body limits. Other members can read their workspace's formatting preferences but cannot mutate them. New dataset confirmations still require explicit customer review. No existing financial values, semantic revisions, plan definitions or currency conversion rules are rewritten by changing preferences.

The final source passed **all 23 combined stages**, including **316/316 regression tests**, zero failures/skips/cancellations, clean optimized build, actual HTTPS OIDC/erasure/BI workflows and actual PostgreSQL dump/restore. Recovery fingerprints match across 68 tables including migration history and 37 fixture domains; the workspace recovery fixture now contains non-default currency/timezone/locale and revision metadata. Restricted-role restore reads pass. The BI browser recorded 45 zero-violation desktop/mobile scans, including saved preferences, non-US formatting and unchanged USD data under a KES workspace preference. Erasure and dedicated billing recorded six and five scans. Supplemental source/OAuth acceptance also passed with eight zero-violation scans, for 64 accessibility scans in this final acceptance.

Verified source fingerprint: SHA-256 `0e941e8dae06e9113887c15376beb2766cdbe563533ddac758d23f2d5c5da7cf`, 543 selected files. An initial regression run found a missing custom-permission guard on the new read route; it was corrected at the route and service/layout boundaries before the entire gate passed. No production host, main branch, external provider or other Averidi application was changed. Apply the additive migration through the existing protected development setup before running this revision in another checkout.

The [original checklist](roadmap/requirements-375.md) now records 241 source-supported, 47 partial, 20 live-pending, 40 deferred/conditional, 18 not implemented and nine unverified business outcomes. These are scoped development checks, not general availability certification. Remaining unchecked rows remain open.

### Verified acquisition cost and missing-category completion

Baseline: `3427dfcfb9030c6a5e9d9f157add2f2cea0651ae`. These are **original 375 roadmap numbers**.

| Original # | Status | Completed development behavior |
|---|---|---|
| 152 | ☑ Implemented and verified | Marketing CAC joins supported spend/leads/conversions/attributed revenue/ROAS/ROI. It requires explicit unique, source-attributed, non-overlapping NEW-customer counts, non-repeated spend and a single currency. Missing prerequisites refuse calculation. Group ratios are recalculated from records; total spend and per-acquired-customer cost cannot be added as equivalent units. |
| 174 | ☑ Implemented and verified | Null/absent cells have typed group identities and MISSING filters, separate from literal category text such as `(Missing)`. The same filter reaches KPIs, source records, private presets and CSV missing-group markers. Selected filters are disclosed; date lines do not invent positions for missing dates. |

Chart drilldown also preserves an explicit observed-through bound instead of accidentally broadening the date range when disabling comparison. Existing financial and marketing ROI definitions, stored template versions, source isolation and access guards remain unchanged. The new CAC rule is optional and never inferred for existing datasets. It describes marketing acquisition cost, not unverified fully loaded sales-and-marketing cost. No migration, dependency or provider activation is included.

The final combined gate passed **all 23 stages** with **321/321 regression tests**, zero failures/skips/cancellations, schema upgrade/drift validation, actual database dump/restore, clean optimized build and actual HTTPS erasure/authentication/BI workflows. The browser checks perform real JSON uploads, field/business confirmations, null versus literal-category inspection, filtered source IDs, explicit CAC confirmation, new chart generation and desktop/mobile accessibility. All 49 BI accessibility scans reported zero violations; erasure and dedicated billing added six and five scans. Supplemental source/OAuth acceptance also passed with eight zero-violation scans, for 68 scans in this final acceptance. Native acceptance also proves the correct weighted CAC (150 spend/five new acquisitions = 30; grouped costs 25 and 50 must not be averaged).

Verified source fingerprint: SHA-256 `3864d1f47957c890057c5675d08a4e142ad61131b0b5f71d924014c01e39a582`, 545 selected files. Focused browser review found an ambiguous dataset-select label, a missing-value button whose accessible name omitted its visible text, and a fixture cleanup ordering error. These were corrected before the full passing run. No production, main, website or Analyst changes were made.

The [original checklist](roadmap/requirements-375.md) now records 243 source-supported, 45 partial, 20 live-pending, 40 deferred/conditional, 18 not implemented and nine unverified business outcomes. Remaining unchecked rows are still outstanding. See [missing-category behavior](data/missing-categories.md) and [marketing CAC](marketing-metrics-acceptance.md).

| Audit references | Remaining work |
|---|---|
| 220 | Local monitor/alerts and templates implemented and verified; deployed sink/on-call/off-host/capacity/latency acceptance remains. |
| 229 | Hosted CI is blocked before execution: GitHub reports failed account payments or an Actions spending-limit restriction. Resolve the account billing restriction, then rerun the published revision. |
| 230 | Completed as traceability. Follow the explicit remaining original-roadmap rows in [the 375-item table](roadmap/requirements-375.md). |

Live-environment verification remains outstanding for 26, 171, 182, 207 and 212. The development login fixture is verified; the actual Codespace/real-provider customer login remains distinct.

Deferred authorized integration/provisioning work remains 14, 27–28, 194, 196 and 218–219, subject to the architecture's ownership and approval conditions. In particular, support impersonation is conditional, not silently enabled.

No production/server/main/website/Analyst changes or cross-product activation are part of this change. The newer Studio source is preserved; existing data calculations, worker behavior, billing ownership and connector services are reused. The first customer-workflow batch introduced no migration. The monitoring/exploration batch adds one nullable binding migration. The onboarding/collaboration batch adds one migration for teams, organization audit events and a nullable profile name. Neither adds dependencies.

Hosted CI observation for code commit `64f00301c665bfcb0c2d0acbc16558f88230a469`: [run 40162420931](https://github.com/NNNNNthe1st/averidi-dashboard/actions/runs/40162420931) failed before any job steps ran and produced no job logs. The run-page annotation states an account payment/spending-limit blocker. This is not a hosted test result; 229 remains incomplete. Account billing settings were not changed.

## Completed: original requirement 222 — bounded authenticated query caching

Baseline: `ea7c51748e7104f23a11f21ccca75c81f0f0d9a0`, on the same independent development branch. This is original 375-roadmap number 222, not architecture comparison audit 222.

| Original requirement | Status | Result |
|---|---|---|
| 222 | ☑ Implemented and locally verified | Optional signed PostgreSQL query cache bypasses repeated source preparation and widget calculations for identical current dashboard/filter queries. Scope includes workspace, view revision/definition, governed analysis/version/checksum/semantic revision, engine and query. Current membership, custom permission, subscription, sharing and analysis are checked again before returning. |

The additive 31st migration adds only Dashboard-owned cache persistence, composite tenant/view foreign keys, database size/lifetime constraints and the existing audit/erasure triggers. Cache writes are bounded and best effort; worker startup and periodic expiry cleanup advertise a dedicated capability required by readiness when enabled. Invalid signatures, key rotation, expiry and backend failures use verified calculation fallback. Existing calculations, business definitions, source data and release flags are preserved. The example leaves caching disabled; enabling it requires a separate dedicated key and a healthy worker. See [query-cache.md](data/query-cache.md) for controls, limits and disabled-cache cleanup behavior.

Five focused PostgreSQL/native-worker acceptance cases pass, including a real missing-source-file test that succeeds only on the warm cache path, tampering, key rotation, tenant/access/subscription/confirmation refusal and actual worker cleanup. The full 23-stage verification passes 326 regression tests without skips, all 31 migrations, upgrade/drift checks, TypeScript, clean production build, HTTPS authentication, erasure and existing dashboard workflows. Real restricted-role backup/restore verifies 69 tables including the migration ledger and 38 fixture domains. Dashboard and erasure accessibility reports contain 49 and 6 scans without violations. Separate billing/source browser results are retained with their own reports.

Full-gate evidence: `.local/verification/2026-10-25T11-06-35.175Z-df498792-daf9-4098-b234-a83eea4a32ec/summary.json`; source SHA-256 `c6bf6b34b6d0be4dd5c71e0a7f6846a7d558687db57dd353336bdb4ec5a18293` across 549 selected source files. An earlier full run caught the fixture's old 37-domain expectation; it was updated to 38 and the entire gate rerun. The initial migration quote error and unsupported void-return advisory-lock query were fixed before passing evidence was produced.

The original roadmap now records 244 source-supported, 44 p
## 2026-10-26 — original 100, 143, 149, 151 and 181 implemented and locally verified

Baseline: `340cd170bd34d1bc7c4e2dd74bfc440e1dae15a3`, independent development branch. Original 375-roadmap numbering. See [implementation details](business-dashboard-completion.md) and [verification record](business-completion-verification.json).

| # | Status | Result |
|---:|---|---|
| 100 | ☑ Implemented | Explicit unit conversion and case packaging; compatible quantities, canonical labels/lineage/CSV, fractional physical inventory and dimensional formula safeguards. |
| 143 | ☑ Implemented | Persisted direction/pacing and matching KPI on-track/ahead/behind or completed met/missed status; explicit complete-through date, no guessed pace. |
| 149 | ☑ Implemented | Confirmed-history acquisition, repeat purchases, period retention and observed historical customer value; no projected future lifetime value. |
| 151 | ☑ Implemented | Product volume, governed revenue/profit/margin and correct full-denominator contribution in native product breakdowns. |
| 181 | ☑ Implemented | Debounced content/page/layout autosave, retained drafts and paused retries on failure, stale-write refusal and transaction-bound monotonic save revisions. |

Verification completed in stages. The comprehensive attempt passed all **374 regression tests without failures/skips**, dependency audit, migration/upgrade/drift, restricted database backup/restore (72 tables including the ledger, 40 fixture domains), TypeScript, production build, erasure and authentication browser acceptance. Its final BI stage found mobile overflow in the new pacing select. The select/fieldset bounds were corrected; the separate build and full BI browser run then passed, including **65 desktop/mobile accessibility scans with zero violations**, plus customer billing's separate five-scan workflow. Existing layout acceptance now verifies automatic persistence, reload, drag/resize and page management. The previous task's source-profile timeout did not recur: that complete data-management workflow passed, along with source-monitoring failure/recovery.

Final review additionally covered fractional physical inventory outputs/formula disclosures and refusal to choose a customer cohort period from multiple date filters. After those two calculation-boundary refinements, **all 44 focused regressions**, restricted-role migrations/grants, TypeScript and the exact final production build passed. The preceding browser run covers the unchanged final UI; these two calculation refinements have native calculation/worker integration evidence. The earlier comprehensive summary remains an honest failed-at-BI historical record, not relabeled as a fresh all-stage pass.

Comprehensive attempt: `.local/verification/2026-10-26T07-54-22.122Z-3402f78b-f9eb-480e-90c7-d6dd4c50dab0/summary.json`. Final focused/build/browser evidence: `/workspace/scratch/dashboard-mutation-audit-business-focused.log`, `/workspace/scratch/dashboard-mutation-audit-widget-target-types.log`, `/workspace/scratch/dashboard-mutation-audit-business-exact-final-build.log`, `/workspace/scratch/dashboard-mutation-audit-business-final-browser.log` and `/workspace/scratch/dashboard-mutation-audit-accessibility.json`. Exact final selected-source SHA-256: `6cac9404b0166f7c46921ad388b564ec696eb00c8272f43cd8f65f27de821c63` across 597 files. Narrative documentation is outside that fingerprint.

Only requested original rows 100, 143, 149, 151 and 181 were promoted. Roadmap counts: **258 source-supported, 30 partial, 20 live-pending, 40 deferred, 18 not implemented and nine outcome-unverified**. Original requirement titles/acceptance remain hash-pinned, traceability and whitespace checks pass. No production/server/SSH access, deployment, main merge or external-product activation occurred. No whole-product or production certification is claimed.

## 2026-10-26 — original 262, 263 and 266 implemented and locally verified

Baseline: `ddb7ae0f1f1ff50a6753c4dbd364dc75ca9480a1`, same independent development branch. These are original 375-roadmap numbers.

| # | Status | Result |
|---:|---|---|
| 262 | ☑ Implemented | Governed paginated PDF reports with embedded font, chart/table/KPI values, source identity/lineage, current filters/comparisons and private worker-generated downloads. |
| 263 | ☑ Implemented | PNG output from the same layout, full exact group labels/values and explicit page/file resource limits; authoring, generation, schedules and delivery are integrated. |
| 266 | ☑ Implemented | Persisted business name/subtitle/color/logo, optional Averidi branding, metadata-free bounded logo normalization and consistent PDF/PNG presentation. |

The existing CSV path remains covered by its original authoring/export/worker tests. Each export snapshots its own format, so changing a saved definition cannot relabel previously generated files. Existing integrity, tenant/view permissions, entitlement, CSRF, cancellation/lease, quota/storage, revision, expiry, delivery and cleanup boundaries remain in force. No external rendering service, headless browser, shared app files or active inter-product integration is introduced. See [visual-report-exports.md](visual-report-exports.md).

Four new regression cases include real binary PDF/PNG generation, byte-identical PDF retries, branded/logo output, pagination/image bounds/cancellation, malformed/external/oversized image refusal, restricted worker generation, downloads, format changes, recipient and due-schedule PNG delivery, expiry/tampering, foreign tenant and read-only refusal. Eight focused existing/new report/worker cases pass. Generated PDF text extraction and raster inspection confirm actual brand text, metric values, exact groups and readable layout; PDF/PNG raster views were checked locally. Runtime packages are pinned: PDFKit 0.20.2, SVG-to-PDFKit 0.1.8, resvg-js 2.6.2 and sharp 0.35.5. Actual dependency audit reports zero findings.

The comprehensive attempt passed **378 regressions with zero failures/skips**, schema/migrations/upgrade/drift, restricted-role database recovery of **72 tables including the ledger across 40 fixture domains**, storage, TypeScript, production build, erasure and authentication browsers. Its BI stage caught an exact accessible-label mismatch for the new output-format select. An explicit accessible label was added; the final build and complete HTTPS BI browser suite then passed, including real UI logo conversion, persisted format/branding, generation, binary downloads, schedule selection and **68 accessibility scans with zero violations**. Customer billing's separate five scans and erasure's six scans remain separate. No unexecuted all-stage rerun is claimed; the original failed-at-BI summary is retained as historical evidence.

Comprehensive attempt: `.local/verification/2026-10-26T10-16-28.912Z-746d4f99-7d8c-4520-b234-c67caadb03f0/summary.json`, source SHA-256 `59c8b3981992acf561de23362678c6a143cfe629d633f67f69a8f062516cd413`. Final build/browser logs: `/workspace/scratch/dashboard-mutation-audit-visual-final-build.log`, `/workspace/scratch/dashboard-mutation-audit-visual-final-browser.log`; final accessibility: `/workspace/scratch/dashboard-mutation-audit-accessibility.json`. Local rendered QA: `.local/visual-report-qa/`. Final source SHA-256 is **`c39da9a765d3fa2e2629a51b0d6c283dc5eae1f4b0233d3a8d116dc9754615d7` across 606 selected files**, including the bundled licensed font. The only source change after the comprehensive run is the select's explicit accessible label; final build/browser evidence covers it.

Only requested original rows **262, 263 and 266** were promoted. Counts are now **261 source-supported, 29 partial, 20 live-pending, 40 deferred, 16 not implemented and nine outcome-unverified**. Original requirement text/numbering remains hash-pinned and traceability passes. No server/production/SSH access, deployment, main merge or unrelated application changes occurred. Product-wide production approval is not claimed.
