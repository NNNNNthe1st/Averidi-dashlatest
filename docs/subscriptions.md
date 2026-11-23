# Dashboard-owned subscriptions and billing (review checklist item 9)

Dashboard owns plans, entitlement decisions, provider/customer bindings, invoice copies, billing receipts and audit records. Nothing reads Analyst/website billing data or uses a Stripe **data connector** credential. Existing unlinked subscription rows remain compatible; new manual ACTIVE assignments require an active catalog plan that grants `dashboardAccess`.

## Catalog and access

`PUT /api/admin/v1/plans` accepts a strict code/name, active flag, `{dashboardAccess:boolean}` and either a complete Stripe price mapping or four null mapping values. Mapping fields are `externalPriceId`, uppercase `currency`, integer `amountMinor`, and `billingInterval` (`month` or `year`). A code's financial mapping is immutable: retire it and create a new code for another price. There are no invented production plans, prices or free trials. Supported currency exponents are explicitly listed in `src/features/billing/contracts.ts`.

Access requires ACTIVE, a future period end, no administrative access hold and, for catalog-linked subscriptions, an active plan granting Dashboard access. Plan retirement applies immediately to requests and new worker executions. Trialing, unpaid/past-due, paused, incomplete, canceled, expired and unmapped subscriptions deny access. A provider's scheduled end-of-period cancellation retains valid access until the period expires or cancellation takes effect. Held access remains held after provider reconciliation. Committed worker effects retain their existing recovery semantics.

The existing manual subscription endpoint remains available for unbound subscriptions. A provider-bound subscription returns `PROVIDER_MANAGED` on manual status changes; use audited holds for an independent operational restriction. No arbitrary customer request can grant a subscription.

## Separate provider adapter

The reference adapter supports Stripe's account-level, single licensed recurring price, quantity one, month/year interval-count one. It deliberately rejects partial/multiple item collections and unsupported billing shapes. Its pinned contract is `Stripe-Version: 2025-06-30.basil`, using subscription-item billing periods and invoice parent subscription details. The server retrieves the current subscription/invoice objects; event payload fields are never used as entitlement authority.

Independent configuration:

```
DASHBOARD_BILLING_ENABLED=false
DASHBOARD_BILLING_STRIPE_MODE=test
DASHBOARD_BILLING_STRIPE_SECRET_KEY=
DASHBOARD_BILLING_STRIPE_WEBHOOK_SECRET=
```

When enabled, all four must be valid; readiness fails otherwise. The key is used only against fixed `https://api.stripe.com/v1` GET resources, with verified TLS, no redirects, a five-second request deadline and one-MiB response limit. No Stripe-Account/Connect header is sent. Never reuse connector, website or Analyst account keys.

`POST /dashboard/app/api/billing/stripe/webhook` remains routable while customer release is OFF; the billing flag and provider signature still gate processing. The handler verifies the exact bounded raw body, SHA-256 HMAC in constant time, one signature timestamp within five minutes, configured live/test mode and absence of Connect account scope. Multiple v1 signatures permit provider key rotation. Supported event types are subscription created/updated/deleted/paused/resumed and invoice paid/payment_failed/updated/voided/marked_uncollectible/finalized. Unknown types or unbound subscription IDs produce an IGNORED receipt without affecting access.

Event IDs and digests are durable. Identical racing deliveries apply once; a different payload under a processed ID returns conflict. A transaction locks the event and workspace, retrieves authoritative current state *after* acquiring the workspace lock, and commits subscription, invoices, receipt and audit atomically. This avoids ordering assumptions about Stripe `created` timestamps. Failed retrieval, wrong ownership, corrupt snapshots or database errors roll back; HTTP 503 permits provider retry. Customer, subscription and invoice identities must match the registered workspace binding. Unique and composite foreign keys reject cross-tenant reuse. Unknown or disabled mapped prices deny access. Outages preserve the last committed state only through its existing period end.

Invoice `amount` remains exact **major currency units** in Decimal(20,6); Stripe's integer `total` is divided using the explicit currency exponent. No floating-point money conversion or card/payment-method data is stored. Receipt rows contain digests and metadata, never raw payment payloads.

## Protected operations

All administrative endpoints require independently signed `dashboard:read` or `dashboard:manage` access tokens. Customer OWNER does not grant administration. Lists are cursor-paginated to at most 100 records. Responses use no-store headers.

| Endpoint (application base path omitted) | Purpose |
|---|---|
| GET/PUT `/api/admin/v1/plans` | Catalog inventory and audited creation/retirement |
| GET/PUT `/api/admin/v1/workspaces/{id}/subscription` | Subscription status and unbound manual lifecycle |
| PUT `/api/admin/v1/workspaces/{id}/subscription/hold` | Audited access hold/release with required reason |
| GET/PUT `/api/admin/v1/workspaces/{id}/billing` | Provider binding; attaching alone always leaves access INACTIVE |
| POST `/api/admin/v1/workspaces/{id}/billing/reconcile` | Reconcile one registered binding |
| GET `/api/admin/v1/workspaces/{id}/invoices` | Workspace-qualified invoice inventory |
| GET `/api/admin/v1/billing/events` | Bounded billing receipt inventory |
| GET `/api/workspaces/{id}/billing` | Verified workspace OWNER's status and invoice history, even after expiry; omits external provider IDs |
| GET `/api/workspaces/{id}/entitlement` | Existing membership-qualified access decision |

Operator recovery: `npm run billing:reconcile -- [workspaceId]` walks registered bindings in bounded pages, serializes each workspace, continues other workspaces after failure, and exits nonzero if any reconciliation fails. Run it with an independent scheduler (daily or more often according to deployment requirements) to recover missed webhooks. `npm run billing:check` reports counts of unbound/unmapped, never-reconciled and >24-hour stale states; it returns nonzero for attention conditions. These are explicit operator commands; they do not enable the main worker or change release mode. Admin reconciliation also supports individual recovery.

## Development boundary

The provider adapter and independently owned resource API are implemented and tested with signed fixture events, verified HTTPS and native PostgreSQL. No real payment account is connected and no customer has been charged. Checkout creation, the website's pricing/admin UI, shared checkout ownership, provider account registration and production routing require the later explicit integration decision described in Word section 9; this item does not silently implement or activate that cross-product checkout. No checkout-success browser redirect is trusted to grant access.

To configure an already authorized separate Dashboard subscription: define the real catalog mapping, register its customer/subscription binding through the protected API, reconcile it, register the exact webhook events/version and test recovery in the intended isolated environment. Provisioning and real-provider acceptance remain separate from source-level infrastructure completion.
