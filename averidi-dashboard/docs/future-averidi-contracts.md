# Future Averidi connections — version 1.0, prepared and inactive

This implements review checklist item 11 and Word section 15. Dashboard owns these interfaces and their validation. Other Averidi products must independently implement their own adapters from the wire specification. They do not import this repository, its contracts as application code, or a shared application package. Nothing here reads another application's database, session, storage or source.

## Activation boundary

`EXTERNAL_AVERIDI_INTEGRATION_ENABLED` remains a source-level **false** constant. Both a reviewed source-level unlock and explicit environment activation would be required later. Setting `DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED=true`, supplying credentials, adding a cookie or sending an HTTP parameter cannot unlock the prepared endpoints. The optional website administrative bridge is now subject to that same source lock as well as its separate bridge flag. Independent Dashboard administrative OIDC access remains available under its existing separately verified authority.

Inactive resource handlers return versioned HTTP 503 `INTEGRATIONS_INACTIVE` **before** identity/JWKS access, database reads or any network call. The default Dashboard-owned conformance client also fails before resolving credentials or validating a destination. Its injectable activation/transport dependencies exist for isolated contract fixtures; production route modules always use the locked dependencies.

The public, data-free `GET /dashboard/app/api/integrations/v1/contracts` publishes `enabled:false`, the version, OpenAPI and JSON Schema. Discovery stays available while customer release is OFF. It contains static interface metadata only. It is not a readiness claim about another product or a live connection.

## Wire artifacts and compatibility

- `contracts/v1/openapi.json`: OpenAPI 3.1 operation/security inventory for the prepared read API and **all 19 existing administrative route paths**.
- `contracts/v1/schemas.json`: Draft 2020-12 definitions generated from the actual runtime validators.
- `src/contracts/integration.ts`: strict identity, purpose-bound claims, subscription/navigation envelopes and signed event schemas.
- `src/contracts/administration.ts`: administrative operation inventory and shared request validators used by the real subscription, rename, support and configuration implementations.

Run `npm run contracts:generate` after a reviewed schema change, and `npm run contracts:check` to detect artifact drift. Checking artifacts does not require database configuration. JSON Schema describes structural rules; the OpenAPI `x-dashboard-integration.runtimeInvariants` and runtime parsers additionally enforce time/cross-field/URL bindings that JSON Schema alone does not express. The published artifact contains no generated timestamp or secret.

Consumers pin `contractVersion: "1.0"` and `X-Dashboard-Contract-Version: 1.0`. Unknown fields, versions and permission values fail closed. Any wire change needs a reviewed version/compatibility decision; breaking changes require a new major path and independent consumer acceptance. Do not change another application's source to match this contract automatically.

The actual app base path remains `/dashboard/app`. The Word's `/api/dashboard/v1/*` is recorded as a **planned external alias**, not an implemented proxy or live website route. No routing is provisioned or changed outside this app.

## Identity and customer resource API

The future trusted identity provider must issue a dedicated asymmetric signed access JWT with exactly these claims:

```
iss, sub, aud, iat, exp, jti,
token_use: "access",
integration: "averidi-dashboard-ecosystem-v1",
dashboard_permissions: ["dashboard:subscription:read", "dashboard:navigation:read"],
workspace_ids: ["explicit-dashboard-workspace-id"]
```

An optional `nbf` is permitted. Tokens require a single exclusive audience, nonblank stable subject, unique token ID, supported RS256/ES256/PS256 signature, required expiry and a maximum five-minute lifetime/issuance age. JWKS must use HTTPS on the issuer origin. Permission arrays and workspace lists are bounded and unique. Configure only the future independent `DASHBOARD_ECOSYSTEM_OIDC_ISSUER`, `_AUDIENCE`, `_JWKS_URL` values; they are not populated here.

`issuer + subject` resolves an existing Dashboard user; email and client-supplied actor objects are never identity joins. There is no auto-provisioning or support impersonation. An explicit workspace claim **and current Dashboard membership** are required for every read; signed claims cannot replace membership. Customer tokens cannot access administration, and administrative bridge tokens cannot access customer integration resources. Existing standalone OIDC PKCE/session creation, secure scoped cookies and logout remain the implementation for browser sign-in; no website cookie is forwarded or shared.

Prepared routes:

| Method and path (under `/dashboard/app`) | Required permission | Result |
|---|---|---|
| GET `/api/integrations/v1/workspaces/{workspaceId}/subscription` | `dashboard:subscription:read` | Dashboard-only entitlement decision, subscription state and period; no provider/customer/payment identifiers |
| GET `/api/integrations/v1/workspaces/{workspaceId}/navigation` | `dashboard:navigation:read` | Existing workspace chooser, workspace Studio and login paths; members path only for a current OWNER |

They remain read-only, reject unexpected query inputs, use no-store, and respect the existing BETA/GENERAL workspace release gate after authorization. Subscription summary reads do not require an active paid entitlement, so an otherwise authorized expired customer can see status. Active access still comes from Dashboard's database and catalog/period/hold rules; another product cannot grant it.

Navigation paths are generated only from validated IDs and existing routes. Validators bind every link to the response workspace and reject foreign origins, path traversal, protocol-relative URLs, unexpected destinations and mismatched tenant IDs. Login starts Dashboard's existing independent identity flow.

## Administrative contract

The machine-readable inventory covers each implemented administrative route and HTTP method, exact request schema where applicable, path parameters, list limits/cursors, and required read/manage grant. The conformance test compares the inventory with the actual route exports to prevent undocumented additions or method drift. Existing response resource details and operational workflows are documented in `docs/central-administration.md` and `docs/subscriptions.md`.

The future website bridge requires an independently signed, maximum-five-minute token with required `iss/sub/aud/iat/exp/jti`, `token_use=access`, `integration=averidi-dashboard-admin-v1` and explicit supported `dashboard_permissions`. A missing expiry, excessive lifetime, dual audience, customer purpose, unsigned role or ordinary cookie is denied. The bridge stays locked. Its offline verifier is exercised against a temporary HTTPS JWKS server without weakening the separate standalone admin OIDC path.

## Billing and events

Billing overview is Dashboard-owned and read-only. No price, subscription or invoice state is accepted from the website or Analyst. Existing dedicated Stripe billing processing and receipts retain ownership of payment events. Shared checkout ownership, website pricing presentation, checkout creation and account registration are outside this inactive connection contract and require the later explicit integration decision.

Prepared informational event types are `dashboard.subscription.changed.v1` and `dashboard.workspace.changed.v1`. Envelopes bind product/version/event UUID/workspace/occurrence time to a strict payload. Subscription event summaries must identify that same workspace. They contain no card data, provider secrets, raw datasets or other-product entitlements.

The offline-ready codec signs short-lived, audience-specific JWTs with `integration=averidi-dashboard-events-v1`, event ID as `jti`, and `sub=workspace:{workspaceId}`. Verification checks issuer/audience/signature, required claims and maximum lifetime, event/subject/ID bindings and future-time consistency. The codec does not emit or deliver events automatically.

`consumeDashboardEvent` verifies before invoking an `AtomicDashboardEventReceiver`. The receiver must atomically persist event ID + normalized semantic payload digest **and its receiver effect in its own store**. Identical deliveries acknowledge DUPLICATE; a changed payload under the same ID fails. JWT reissuance for delivery must retain the immutable event ID and payload. The HTTPS fixture tests this receiver contract with a local mock receipt store. No actual website/Analyst receiver, shared receipt store, sender queue or cross-application scheduler is installed. Event timestamps do not authorize last-write-wins entitlement changes: a future receiver reconciles the current Dashboard-owned summary. These contracts never grant another product's subscription.

## Failure isolation and conformance client

`createDashboardContractClient` is a Dashboard-owned server-side conformance helper, not a shared application library. It accepts only a configured HTTPS origin, fixed API paths, bounded resource IDs and a purpose-specific token provider. It omits cookies, refuses redirects, uses a three-second request deadline, caps response bodies at 64 KiB, validates version/content type and the full response, and rejects tenant mismatches. It returns bounded retry guidance for 429/503/network failures without automatic retries or mutations. Real consumer code must be independently owned by its application.

Mock/provider outages cannot change Dashboard subscriptions. No live integration lookup is introduced into BI requests, worker execution, storage, billing entitlement evaluation or browser authentication. Deployment, real issuer registration, canonical proxy routing, real external receivers and enabling connections remain later authorized work. See `docs/item11-integration-contract-acceptance.md` for executed evidence.
