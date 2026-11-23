# Dashboard plan capacity policy

Audit 181. Plan quotas are an optional, strictly validated `entitlements.quotas` object in the existing independently authenticated administrative plan API. No commercial limit, price or default plan is invented, and existing plan rows remain unchanged. Missing or null limits mean no plan ceiling; zero prevents additional capacity. Technical ingestion, request, query, list and worker safety limits still apply. Financial price mappings remain immutable.

Supported integer keys are `seats`, `datasets`, `dashboards`, `connectors`, `reports`, `schedules`, `customMetrics`, `relationships`, `alerts`, `targets`, `teams`, `customRoles`, `shares` and `storedBytes`. Values must be nonnegative safe integers. Unknown keys, strings, fractions, negative and unsafe numbers are rejected. Quotas belong to the plan linked by the workspace subscription's `billingPlanId`, not a guessed match on a legacy plan-code string. Legacy unlinked subscriptions have no plan quotas. Limits apply independently to each workspace on the plan, not pooled across unrelated tenants or organizations.

For example, the existing plan PUT input can include:

```json
{"entitlements":{"dashboardAccess":true,"quotas":{"seats":10,"datasets":20,"storedBytes":1073741824,"schedules":5,"shares":0}}}
```

This excerpt is not a complete plan request; the established code/name/financial-mapping fields are still required. Only verified `dashboard:manage` administrators can change the catalog. Plan edits retain previous/new policy and actor in the existing administrative audit. No customer owner, frontend field or external product can grant itself capacity.

## Counting and enforcement

| Key | Counted capacity |
|---|---|
| seats | Current workspace memberships, including Owners; invitations do not reserve a seat. Acceptance atomically checks capacity and rolls back invitation consumption if full. |
| datasets | Non-archived datasets, including pending ingestion; archiving frees definition capacity and unarchiving checks it again. |
| dashboards | Saved dashboard view records. |
| connectors | All connector definitions, including disabled/disconnected definitions and the four newer API/webhook/marketing types. Disconnecting preserves the definition and does not free its slot. |
| reports | Report definitions. |
| schedules | Enabled job schedules plus enabled report schedules, in one shared capacity pool. |
| customMetrics | Customer formula definitions with the reserved `CUSTOM_FORMULA_` prefix; governed built-in metric definitions are excluded. |
| relationships | Saved dataset relationship definitions. |
| alerts | Enabled alert rules. |
| targets | Saved targets. |
| teams | Workspace teams. |
| customRoles | Workspace custom role definitions. |
| shares | Unrevoked, unexpired member-only links plus direct shares with a current membership-bound, unrevoked, unexpired access grant. Revocation/removal frees direct-share capacity; legacy unbound grants do not consume it. Expiry uses UTC consistently with stored timestamps. |
| storedBytes | Retained, registered source-version, dataset-snapshot and report-export file bytes. |

One additive migration installs database functions and per-resource admission triggers. They check only capacity increases, serialize admissions within a configured workspace and reject over-limit writes atomically. The same boundary covers customer services, OAuth/source setup, generic resource routes, scheduled workers, joins, webhook admission and report publication. Lowering a plan limit does not delete existing data or block reads, renames, disabling, revocation and removal. Re-activation/unarchiving that adds counted capacity must fit the current policy. A transaction serialization conflict remains a retryable conflict under the existing transaction rules.

Application storage writes also check capacity before I/O. The database trigger at metadata publication is authoritative under concurrent writes. Registered bytes are a product retention measure, not a physical filesystem/bucket budget: temporary files, backup copies, crash leftovers and a concurrent write that loses publication can consume operational storage. Existing quarantine/cleanup handles those objects; no cleanup, retention or legal hold is bypassed to meet a plan limit. Source and snapshot files remain charged until the actual deletion tombstone commits; marking a snapshot for purge alone does not free capacity. A report that expires but has not been deleted still consumes bytes. Replaying an existing identical object does not add registered capacity.

Worker quota failures have the safe permanent code `QUOTA_EXCEEDED` and retain the last good dataset/output rather than automatically retrying three times. After an authorized capacity increase or cleanup, the existing explicit recovery controls can be used. HTTP mutation mappers return 409 with `{ "error": "QUOTA_EXCEEDED", "resource": "datasets" }` (or the applicable key), without SQL text or secret values.

## Customer and administrative usage

Workspace members with `workspace.read` can open **Plan usage** and `GET /dashboard/app/api/workspaces/<workspaceId>/usage`. It returns exact decimal strings for usage, limit and remaining capacity plus an over-limit flag. It remains readable after subscription expiry; it does not grant access to analysis or data. Tenant membership and current custom-role permissions remain mandatory. The existing protected administrative workspace usage API includes the same `quotas` object alongside its previous usage fields.

## Verification

`npm run test:plan-policy` covers native PostgreSQL racing admissions, plan edits/downgrades, seat acceptance rollback/retry, definition limits, built-in metric preservation, schedule and alert transitions, retained source/snapshot/report bytes, storage preflight, safe HTTP failures and tenant/expiry boundaries. `npm run verify:plan-policy` adds a clean production build, actual HTTPS capacity rejection and desktop/mobile usage screens, the existing source/OAuth and BI workflows, and separate HTTPS authentication acceptance. Verification requires the established disposable loopback `dashboard_test`, separate owner/runtime roles, private storage and browser tooling; it refuses a customer/development database before fixture writes.
