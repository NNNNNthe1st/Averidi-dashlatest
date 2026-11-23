# Dashboard customer subscriptions

Audit references 178–179 extend the existing Dashboard-owned catalog, provider reconciliation, entitlement policy, invoices and owner billing screen. The website and Analyst do not participate. No live provider account, paid subscription or production environment is changed by development fixtures.

## Configuration

Customer billing is OFF by default. Keep `DASHBOARD_BILLING_SELF_SERVICE_ENABLED=false` until the dedicated Dashboard Stripe test account is configured and accepted. The existing `DASHBOARD_BILLING_ENABLED`, matching test/live key and webhook signing secret remain required. `DASHBOARD_PUBLIC_ORIGIN` must be the exact HTTPS application origin. Customer input cannot choose provider IDs, prices, amounts, identities, return URLs or payment credentials.

Use the existing signed administrative plan API to configure commercial plans. Purchasable plans must be active, grant Dashboard access and have complete immutable provider price/currency/minor-unit amount/monthly-or-yearly mappings. The provider price is retrieved and matched before checkout. No commercial prices are invented. Fixtures contain temporary prices only.

Set `DASHBOARD_BILLING_PORTAL_CONFIGURATION` to an explicit `bpc_…` configuration in the same dedicated account/mode. Enable invoice history, payment-method updates, cancellation at period end, and subscription updates restricted to `price` changes. Quantity changes are refused. The portal must offer only active locally approved Dashboard prices, with at most ten distinct prices. Each price's financial mapping is checked. Proration behavior is explicit provider configuration (`none`, `create_prorations` or `always_invoice`); the application supplies no commercial policy default. Trial/custom amount/transformed quantity/metered/multiple-item products remain outside the existing subscription contract and are refused.

Register the existing signed webhook endpoint for existing subscription/invoice events and `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. The pinned API version and dedicated-account checks remain authoritative. Keep the existing reconciliation worker/command running for missed-event recovery.

## Customer behavior

Only current workspace owners can purchase or open management. Billing remains accessible without an active entitlement so expired customers can recover. Purchase uses hosted Checkout; upgrades, downgrades, cancellation, invoices and payment-method changes use the explicitly configured hosted portal. Customers confirm these external actions. Dashboard never collects card details.

One durable pending reservation is permitted per workspace. The reservation and exact server-generated provider request commit before any provider write. Repeated/concurrent clicks resume the same attempt with the same provider idempotency key. A different plan requires closing the pending attempt. An existing nonterminal provider subscription or active legacy access blocks another purchase. Holds block purchase; reconciliation preserves operator holds. Manual administrative binding and legacy subscription assignment refuse a pending checkout, preventing competing subscription ownership while the provider response is unresolved.

A checkout return is not payment evidence. Customer refresh and signed events retrieve the current session and subscription, validate saved attempt metadata/price/customer/mode/return addresses, and reuse existing reconciliation. Incomplete subscriptions remain inactive. Scheduled cancellation preserves existing paid-period policy; terminal cancellation allows replacement purchase. A delayed old checkout cannot rebind a newer subscription. Duplicate signed events are idempotent.

Owners can explicitly expire pending checkout. If completion races expiration, authoritative provider state decides; failed network responses cannot be assumed to cancel payment. Disabling new self-service purchases does not stop signed reconciliation of existing obligations while the existing billing service remains enabled.

## Recovery and operations

Ambiguous provider responses retain the reservation and key. Unknown session IDs are retried only within 23 hours of reservation creation, before the provider's documented minimum idempotency retention boundary. Older ambiguous attempts require verified operator recovery and are never silently released or retried with a new key.

`npm run billing:check` reports `checkoutRecoveryRequired` (unknown provider session older than 23 hours) and `checkoutPastExpiry` (active reservation past expected expiration). Either fails the check. Normal future pending sessions do not. Expired webhooks or owner refresh/cancel reconcile known expired sessions. Deployment monitoring/scheduling remains audit 220.

An operator with a verified `dashboard:manage` administrative access token can POST to `/dashboard/app/api/admin/v1/workspaces/{workspaceId}/billing/checkout` with strict JSON `{attemptId, sessionId, reason}`. Obtain the exact session ID and its `client_reference_id` (the attempt ID) from the dedicated provider account. The service retrieves and validates the full session against the reservation before reconciling or closing it. Foreign/mismatching sessions are rejected without releasing the reservation. Recovery audits the verified administrative actor/reason and returns status only. If no matching provider session can be established, keep the reservation and investigate in the provider account; do not delete it or create another paid session as a workaround.

Apply additive migration `20261024030000_customer_billing` through the existing protected development setup. It adds reservations, workspace/plan foreign keys, unique provider session IDs and one active reservation per workspace. It changes no existing data or dependencies. Hosted URLs and card information are not persisted or logged by this workflow. Provider identifiers and server-generated nonsecret request parameters stay in the dedicated Dashboard database.

## Verification and acceptance boundary

`npm run test:customer-billing` runs focused PostgreSQL tests. `npm run verify:customer-billing` requires Node 22, isolated loopback `dashboard_test`, distinct runtime/migration roles, private fixture storage and an installed browser. It refuses customer/development databases before fixture writes, validates/generates the schema, runs focused tests, type checks/builds, then runs new HTTPS customer billing, existing request-limit/BI/worker workflows and separate HTTPS OIDC browser acceptance. Combined acceptance discovers new tests and reaches billing browser acceptance through its existing BI stage.

The billing browser fixture runs the actual production app and restricted database role. A test-process preload alone maps the fixed Stripe endpoint to a local verified HTTPS provider fixture; no application test flag or arbitrary provider origin is added. Hosted payment pages are browser-intercepted fixtures and never charge a live account. Accessibility scans cover available plans, pending checkout, scheduled cancellation and canceled subscriptions on desktop/mobile.

Live dedicated-account setup, real purchase/upgrade/downgrade/cancellation/payment-method behavior, webhook delivery and charge/invoice acceptance remain audit 182. Feature/seat/storage quotas remain 181. Final recovery/hosted CI/375-point traceability remain 228–230. Mock-provider development tests do not complete those items.
