# Independent Dashboard administration infrastructure (review checklist item 9)

Dashboard provides its own protected administrative resource API. A future central website UI calls these APIs through a separately authorized server adapter; it never accesses the Dashboard database. No website, Analyst or production application is modified here.

## Independently verified authority

Configure `DASHBOARD_ADMIN_OIDC_ISSUER`, `DASHBOARD_ADMIN_OIDC_AUDIENCE`, `DASHBOARD_ADMIN_OIDC_JWKS_URL` for a trusted HTTPS administrative identity service. Issuer-signed access JWTs require `token_use=access`, stable subject, issuance age at most 15 minutes and `dashboard_permissions` containing only supported grants. `dashboard:read` permits inventories; `dashboard:manage` permits mutations and reads. Customer OWNER membership, customer sessions, unsigned headers and website cookies never grant this authority. Writes reject conflicting Origin headers and use bounded JSON. Responses use no-store. Administration stays reachable when customer release is OFF.

The optional future bridge remains disabled behind the source-level `EXTERNAL_AVERIDI_INTEGRATION_ENABLED=false` lock. Environment flags alone cannot activate it. Its prepared versioned verifier additionally requires `iss/sub/aud/iat/exp/jti`, a single exclusive audience, and verifies `DASHBOARD_ADMIN_BRIDGE_ENABLED=true`, configured HTTPS same-origin issuer/JWKS, exclusive audience, `integration=averidi-dashboard-admin-v1`, `token_use=access`, a maximum five-minute token lifetime and explicit permission grants. Only the Dashboard verifier exists; the website issuer and UI are not connected.

## Resource inventory

All paths below are under `/dashboard/app/api/admin/v1`.

| Resource | Operations |
|---|---|
| `/overview` | Workspace/user/dataset/view counts, job/subscription statuses, billing bindings, open support count |
| `/workspaces`, `/workspaces/{id}` | Inventory, scoped summary and audited rename |
| `/workspaces/{id}/usage` | Aggregate datasets, views, members, jobs and source-version bytes; no customer rows or source contents |
| `/users`, `/jobs` | Bounded identity/membership/session metadata and job metadata; no session tokens or job payload |
| `/connectors` | Provider, enabled/status/refresh/cooldown metadata and credential availability; no configuration, scopes, tokens or secret references |
| `/operations` | Cursor-paginated operational severity/kind metadata; no raw customer details |
| `/plans`, `/billing/events`, `/workspaces/{id}/subscription`, `/workspaces/{id}/billing`, `/workspaces/{id}/invoices` | See `docs/subscriptions.md` for the independent billing contract and lifecycle |
| `/support`, `/support/{caseId}` | Inventory, protected case detail and audited conflict-safe transitions |
| `/configuration` | Read/update the explicitly allowlisted support settings with a required reason |
| `/audit` | Stable cursor pagination with optional workspace filter; actor/action metadata, no raw audit detail |

Lists use bounded cursors, at most 100 rows. Usage source-version bytes are persisted source history, not a promise of total object-store usage or billable usage. Connector availability is reference metadata, not proof of a live account connection. Health APIs remain `/api/health` and `/api/health/ready`; the latter validates billing configuration when enabled.

## Support and configuration

A verified workspace member may submit a strict subject/message via `POST /api/workspaces/{id}/support` without an active subscription. Its GET lists only that requester's cases in that workspace. Ordinary customers cannot make administrative transitions. Creation records a workspace audit event.

Admin PATCH requires `{status, expectedUpdatedAt, note}`. Allowed transitions are OPEN → IN_PROGRESS/CLOSED; IN_PROGRESS → RESOLVED/CLOSED; RESOLVED → OPEN/CLOSED; CLOSED → OPEN. Compare-and-set on status and updatedAt rejects stale concurrent decisions, and the change and operator note/audit commit together.

Protected settings are `SUPPORT_CASE_CREATION_ENABLED` (boolean, default true) and `SUPPORT_MAX_OPEN_CASES_PER_USER` (integer 1–1000, default 20). Creation applies them under a workspace/requester transaction lock, preventing concurrent limit bypass. Only OPEN/IN_PROGRESS cases count against the admission limit. Configuration changes are audited. Secrets, release settings, authentication settings, executable configuration, integration activation and billing credentials cannot be written through this endpoint.

No impersonation capability is implemented or enabled. The Word document explicitly makes it conditional on a separately approved, audited mechanism. Future central UI, real trusted issuer provisioning and cross-product integration acceptance belong to the later connection/provisioning work, rather than weakening customer or admin authorization here.


The version 1.0 machine-readable operation inventory and shared request schemas are published in `contracts/v1/openapi.json` and `contracts/v1/schemas.json`. See `docs/future-averidi-contracts.md` for the inactive identity, event and navigation contracts. The bridge's token ID and required expiry/lifetime are checked independently of the existing standalone admin OIDC access path.
