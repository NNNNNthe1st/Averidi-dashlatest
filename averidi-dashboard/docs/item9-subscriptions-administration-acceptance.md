# Review checklist item 9 — subscription and administration infrastructure

Accepted for the independent development branch on 2026-10-23. This is the review checklist's item 9, corresponding to Word sections 8–9, not the Word's original numbered storage row.

| # | Infrastructure requirement | Status | Evidence |
|---|---|---|---|
| 1 | Dashboard-owned plan catalog and entitlement policy | [x] Done | Strict immutable price mappings; plan retirement and paid-period/access-hold evaluation |
| 2 | Separate provider billing boundary | [x] Done | Dedicated disabled-by-default Stripe account credentials; fixed-host bounded verified HTTPS reader |
| 3 | Verified, idempotent payment-event processing | [x] Done | Raw-body HMAC, timestamp/mode/account checks, durable event/digest receipts and transaction locks |
| 4 | Subscription reconciliation and outage recovery | [x] Done | Authoritative reads after workspace lock; atomic invoice/subscription/audit/receipt commits; protected API and bounded operator CLI |
| 5 | Tenant-qualified billing persistence and invoice history | [x] Done | Migration 17, unique provider resources and composite customer/workspace FK; Decimal major-unit money |
| 6 | Independently authorized administrative lifecycle | [x] Done | Signed access-token grants, catalog, bindings, holds, manual/provider separation and transactional audit |
| 7 | Customer status and support after expiry | [x] Done | Owner-only billing summary; member/requester-qualified support; entitlement endpoint remains available |
| 8 | Product administration resources | [x] Done | Usage, connector-health metadata, operations, support transitions, allowlisted enforced configuration and paginated audits |
| 9 | Application and background entitlement enforcement | [x] Done | Requests and newly executed jobs deny expired, held or retired catalog access; committed worker recovery preserved |
| 10 | Independent development acceptance | [x] Done | Native PostgreSQL, restricted runtime role, verified HTTPS provider/JWKS fixtures, regression, build and actual Chromium workflows |

## Executed verification

- All **146 root regression tests** passed, with zero failed/skipped tests, on a fresh dedicated native PostgreSQL 17.10 cluster. This includes existing BI, authentication, storage, connector, worker crash/replay and workspace-isolation suites.
- The **19 billing/administration tests** passed both as database owner and as a restricted non-owner runtime role. Final focused reruns also exercised the actual billing-check CLI and the reconciliation CLI's missing-binding failure contract.
- Clean migration deployment and legacy-chain upgrade succeeded with **60 models and 17 migrations**, preserved legacy fixture data and zero Prisma schema drift. Runtime grants, fingerprint checks, domain relationship tests and the DDL-restriction test passed.
- Final route generation, TypeScript checking, source isolation and Next.js 16.4.1 production build passed.
- Actual Chromium HTTPS OIDC login/session/logout acceptance passed. The existing Chromium BI workflow also passed: upload, worker profile, confirmation, metric calculation, generation, edit/filter/export and mobile viewport.

Billing acceptance covers signed administrative read/manage separation, conflicting Origin rejection, atomic binding without premature activation, immutable financial mappings, exact invoice values, cross-workspace rejection, racing duplicate receipts, payload conflicts, invalid signatures, out-of-order cancellation, past-due recovery, period-end cancellation, holds that survive reconciliation, retired/unknown plans, worker entitlement rejection, provider failures and foreign-invoice rollback/retry, expired-owner visibility, stale support transitions, audited configuration, support admission limits, wrong mode/Connect scope rejection and disabled ingress.

The HTTPS fixture intercepts only the fixed Stripe URL in its test process and forwards it to a temporary trusted localhost HTTPS endpoint. It checks the dedicated Authorization and pinned Stripe-Version headers and rejects Connect headers. TLS verification remains on. No real payment account, charge or external customer is used.

## Execution environment and acceptance boundary

The root-only container uses a test-local UID/ownership preload shim to launch the native PostgreSQL binary; it is outside this repository and is not production configuration. An initial reused-cluster run hit a host-filesystem `unexpected data beyond EOF` error in the workspace fixture. Acceptance was rerun on a newly initialized isolated cluster with autovacuum disabled for this disposable harness; all 146 tests then passed. This is developer-run acceptance, not a hosted-CI or production database certification.

GitHub Actions now includes `npm run test:billing`; this document does not claim a successful hosted runner execution. Real provider registration/credentials, actual production prices, shared/website checkout ownership and creation, website central-admin UI/issuer connection, deployment resources and production acceptance remain the later explicit integration/provisioning work. No approved impersonation workflow exists, so none is enabled.

The independent billing adapter owns receipt processing and Dashboard entitlement updates. It does not create checkout sessions, alter external subscriptions or charge customers. Those external purchase flows remain subject to the Word's explicitly deferred checkout ownership decision. Existing provider subscriptions can be registered and reconciled through the protected Dashboard API. Release remains OFF, the worker remains disabled by default, and cross-product integrations remain false.

See `docs/subscriptions.md` and `docs/central-administration.md` for endpoint/configuration contracts and operational recovery commands.
