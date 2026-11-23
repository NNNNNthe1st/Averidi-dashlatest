# Protected Dashboard operational configuration

Audit 192. `GET/PUT /dashboard/app/api/admin/v1/configuration` is the Dashboard-owned configuration interface. GET requires independently verified `dashboard:read`; PUT requires `dashboard:manage` and the existing same-origin rule for browser-originated requests. Ordinary customer sessions, workspace Owners and website cookies confer no administrative capability. This change supplies the protected Dashboard resource API, not an external website administration screen.

GET preserves the existing persisted `settings` list and adds a discoverable `catalog` with each allowlisted key's type, default, effective value, revision and exact behavior. Reads and mutations are `private, no-store`. Corrupt stored values fail validation rather than silently authorizing an action. Arbitrary key/value configuration is unavailable.

| Setting | Default | Effect |
|---|---|---|
| SUPPORT_CASE_CREATION_ENABLED | true | Existing support case creation policy. |
| SUPPORT_MAX_OPEN_CASES_PER_USER | 20 | Existing integer 1–1000 admission limit for open/in-progress support cases per workspace/requester. |
| WORKSPACE_CREATION_ENABLED | true | New customer workspaces. |
| ORGANIZATION_CREATION_ENABLED | true | New customer organizations. |
| WORKSPACE_INVITATIONS_ENABLED | true | New workspace invitations and acceptance of existing invitations. |
| ORGANIZATION_INVITATIONS_ENABLED | true | New organization invitations and acceptance of existing invitations. |
| SHARE_LINK_CREATION_ENABLED | true | New workspace-member share links; existing links and independently authorized direct grants retain their rules. |
| SCHEDULE_CREATION_ENABLED | true | New generic job, connector and report schedules. Existing enabled schedules continue to run. |

All new controls default to prior behavior. They are admission controls with the exact scope above, not maintenance shutdowns. Reading, disabling, revocation, member removal, existing sharing restrictions and cleanup remain available. Shared per-setting transaction locks bind admission to the effect: after an administrator's disabling change commits, subsequent covered admissions cannot use a stale cached value. Updates take an exclusive lock for the same key.

PUT requires strict bounded values and an 8–500-character change reason. New keys require `expectedUpdatedAt`: send null for a key that has no persisted override, or the exact revision returned by GET. A stale concurrent edit returns `CONFIGURATION_CONFLICT` (409); successful timestamps increase monotonically. Existing support callers remain compatible with their established payloads; those two keys also accept the revision field for reviewed edits. Every committed edit atomically retains the operator, key, previous/new value, previous/new revision and reason in the administrative audit. Denied and stale edits have no effect. Set an admission control back to true to restore its default behavior; there is no unaudited delete/reset operation.

No credentials, signing keys, origins, database URLs, executable settings, authentication policy, release mode, integration activation, impersonation or deployment configuration can be written here. Dashboard-owned plan/financial policy remains in the separately protected plan API. Validated local deployment configuration remains operator-owned.

The generated v1 OpenAPI and JSON Schema artifacts describe the expanded strict input. Native tests cover schema rejection, concurrent CAS edits and audit history, real customer-service admission and revocation, serialized in-flight effects, malformed-state refusal and independently signed HTTPS admin JWT read/manage/origin boundaries. Run the combined `verify:plan-policy` gate for regression and browser acceptance. Publishing these source controls does not connect another product or modify a production environment.
