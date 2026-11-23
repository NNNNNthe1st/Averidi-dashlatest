# Item 10 — external data connector infrastructure acceptance

Date: 2026-10-23 (Japan). Baseline: independent Dashboard branch commit 49f25475e05c811e6ba2481055724bd4a60fd279. This is the current checklist's external-connectors item, implementing Word architecture section 14.

| Requirement | Implemented evidence |
| --- | --- |
| Eight provider adapters | Google Sheets rows, Shopify orders, Stripe charges, QuickBooks invoices, WooCommerce orders, HubSpot contacts, Square payments and Xero invoices |
| Provider authentication | Seven OAuth authorization/refresh/revocation adapters; WooCommerce HTTPS consumer keys validated before storage |
| Tenant and actor boundaries | Protected same-origin APIs; membership/entitlement checks; actor-bound, expiring, single-use hashed OAuth state; company/shop/organisation binding |
| Callback registration | One fixed HTTPS callback per environment, resolving the signed-in actor's attempt and enforcing workspace release eligibility |
| Credential lifecycle | AES-GCM workspace/source-bound encrypted database store; serialized token refresh; immediate local disconnect and explicit remote-revocation results |
| Configuration and mapping | Strict provider-specific configuration and explicit field selection/rename; identifiers, currency and major/minor-unit distinctions preserved |
| Worker refresh | Existing SOURCE_REFRESH now reads remote snapshots; immutable storage/versioning, real profile publication, active-version preservation and transactional completion receipt |
| Concurrency and recovery | One source refresh owner bound to a live job lease; staged snapshot replay; disconnect/configuration changes fence publication |
| Rate handling | Retry-After job backoff plus connection-wide cooldown; other jobs cannot bypass the cooldown |
| Egress boundaries | Verified TLS, exact host/origin restrictions, public IPv4 DNS pinning, no redirects or provider-supplied arbitrary pagination URLs |
| Bounds and failures | Row/column/page/body limits; safe codes; bad pages, repeated IDs/cursors and empty/partial snapshots cannot replace the last good dataset |
| Scheduling and reporting | Existing durable generic schedules support remote refresh; source health and refresh executions persist safe outcomes |

Executed with Node 22 and disposable native PostgreSQL 17 configured for Asia/Tokyo: all **122 full regression tests passed**, clean deployment of all **15 migrations**, legacy upgrade with zero schema drift, database/role checks and all-eight-connector integration under the restricted runtime role passed. The added queue test verifies future availability and exact five-minute leases under non-UTC PostgreSQL; raw SQL now writes/compares explicit UTC timestamps. Previous migrations were not edited.

All eight reader contract tests cover their actual request/resource shapes and pagination. Integration tests exercise OAuth actor binding/replay rejection, newer-attempt invalidation, encrypted credentials, concurrent refresh-token rotation, real database/storage/version/profile/job publication, scheduled refresh, cooldown exclusion, parallel-refresh exclusion and disconnect during fetch. Provider responses are contract fixtures; no real customer provider account, sandbox account or credentials were used. Live OAuth app registration, provider permissions/approval and account acceptance remain necessary before enabling a real connection. No claim of successful live-provider certification is made.

Type checking, source isolation, optimized build and the existing real Chromium authentication and BI workflows are part of the final acceptance gate. The build surfaced the official Next.js 16.4.0 security advisory; this change pins its published 16.4.1 patch and updates the lockfile, rather than ignoring the advisory. Reference: https://nextjs.org/blog/nextjs-security-update-october-14-2026 . CI now includes connector gates, but this execution does not claim hosted CI or Docker execution.

Development infrastructure is complete for the eight named provider resources in external-data-connectors.md. Marketing providers, arbitrary custom API/webhook integrations and other resources within those providers are future demand-driven adapters. WooCommerce's read-only key cannot revoke itself remotely; disconnect deletes local use and explicitly requests store-side key removal. External account activation is not represented as completed testing.

Defaults remain release OFF, worker disabled, data connectors disabled and Averidi cross-product integrations inactive. No main merge, sales/website/Analyst source access, production connection, public routing or external recipient action is included.
