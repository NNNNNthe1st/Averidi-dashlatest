# Checklist item 10 — external business data connectors

This is the current review checklist's item 10, implementing Word architecture section 14. It is separate from the older source-independence item 10 and the 375-point roadmap. All code, records, credentials, files and jobs belong to the independent Dashboard repository and resources.

## Implemented providers

| Provider | Authentication | Snapshot resource | Preserved representation |
| --- | --- | --- | --- |
| Google Sheets | Authorization code, state and PKCE; offline refresh; revoke | Explicit spreadsheet ID and A1 range | Header-based rows, text identifiers, unformatted numbers and formatted date strings |
| Shopify | Shop-bound OAuth callback HMAC/state; expiring offline tokens; refresh; app uninstall on disconnect | GraphQL orders, API 2026-10, cursor pagination | Order ID/status/date and shop-currency total in major units |
| Stripe | Connect read_only OAuth; refresh when expiring; deauthorization | Charges, starting_after pagination | Charge ID/status/date, currency, amount/refund in minor units |
| QuickBooks | Company-bound OAuth; serialized refresh; revoke | Invoices, STARTPOSITION pagination | Invoice identity/date/currency, total/balance in major units |
| WooCommerce | Read-only consumer key/secret over verified HTTPS; credential validation | Orders, page and X-WP-TotalPages | Order identity/status/date, currency and major-unit totals |
| HubSpot | OAuth 2026-03 token/refresh/revoke endpoints | CRM v3 contacts, after pagination | Contact identity, names and creation/modification dates |
| Square | OAuth with PAYMENTS_READ; refresh; revoke | Payments, cursor pagination; Square-Version 2026-09-16 | Payment identity/status/date, currency and minor-unit amounts |
| Xero | Organisation-bound OAuth, offline_access and accounting.invoices.read; refresh; delete organisation connection | Accounting invoices, page/pageSize pagination | Invoice identity/type/status/date, currency, total/due in major units |

These are bounded readers for the listed resources, not every API offered by each provider. Marketing APIs and arbitrary generic API/webhook providers remain demand-driven targets rather than invented integrations. No external account or production resource was connected during implementation.

Minor-unit values are explicitly named and require safe integers; they are not silently treated as major-unit revenue. Field mappings explicitly select and rename source columns. Snapshot imports retain source units and reset business confirmation: no inferred currency, row grain or field meaning becomes an approved metric rule.

## Configuration and API

Business connector enablement uses DASHBOARD_DATA_CONNECTORS_ENABLED (default false), independent of DASHBOARD_EXTERNAL_INTEGRATIONS_ENABLED, which remains false for Averidi cross-product contracts. Set a dedicated DASHBOARD_CONNECTOR_ENCRYPTION_KEY (32-byte hex), DASHBOARD_PUBLIC_ORIGIN and the desired provider's CLIENT_ID/CLIENT_SECRET pair from .env.example. Do not reuse another application's app registration, credential or key. Stripe's CLIENT_SECRET value is its platform secret API key, as required by Connect.

Register one HTTPS redirect URI per Dashboard environment:

`https://your-dashboard-origin/dashboard/app/api/connectors/callback`

The fixed callback resolves the signed-in actor's hashed state to its workspace and connection; providers do not need a new redirect registration for every tenant. BETA callback access checks the target workspace release allowlist. Customer authorization is explicit: the server does not acquire permissions without the provider consent flow.

Under /dashboard/app/api/workspaces/{workspaceId}:

- GET /connectors: viewer-authorized connection/configuration/health summaries, with no credentials or token envelopes.
- POST /connectors: editor and active entitlement required; strict provider, name and configuration. Returns connectorId, sourceId and datasetId. A new connection starts disabled/disconnected.
- POST /connectors/{id}/authorize: same-origin editor request; returns the provider authorization URL with a five-minute single-use state bound to this actor, connection and workspace.
- POST /connectors/{id}/credentials: WooCommerce only; accepts consumerKey and consumerSecret and validates read access before encrypting them.
- POST /connectors/{id}/refresh: authorized Idempotency-Key request; enqueues SOURCE_REFRESH and returns jobId/status.
- DELETE /connectors/{id}: immediately disables local use and invalidates outstanding OAuth attempts; attempts provider revocation and reports pending revocation safely. Disconnect remains authorized for editors after subscription expiry.

OAuth callbacks require a current Dashboard session, editor membership and active entitlement. A newer authorization attempt invalidates an older one, including callbacks still exchanging tokens. Malformed, replayed, expired, foreign-user and mismatched-company callbacks fail closed. Configuration is validated separately for each provider. Google uses spreadsheetId/range, Shopify shop, QuickBooks realmId, Xero tenantId and WooCommerce an operator-approved origin; optional fieldMapping is an array of explicit from/to pairs. Unknown keys, unsafe targets and invalid mappings are rejected.

Create recurring refresh with the existing protected jobs/schedules API:

```json
{"type":"JOB","kind":"SOURCE_REFRESH","payload":{"sourceId":"SOURCE_ID","datasetId":"DATASET_ID"},"intervalSeconds":3600,"nextRunAt":"2026-10-24T00:00:00.000Z"}
```

Existing file-source refresh keeps its versionId/format payload. Connector refresh uses sourceId/datasetId and obtains a fresh immutable JSON snapshot.

## Execution and safety

Secrets use authenticated AES-256-GCM envelopes bound to workspace and source, stored in the Dashboard-only credential store table. Jobs/configuration/API responses contain references rather than plaintext secrets. Refresh-token rotation is serialized by a database row lock; the updated ciphertext commits before data reads. Do not replace the encryption key while records still need it: disconnect/reconnect with the new key through a controlled maintenance operation, retaining the old key until pending revocations are resolved.

HTTP requests use verified TLS, fixed provider hosts, no redirects, bounded bodies and request deadlines. WooCommerce additionally requires an operator-managed exact-origin allowlist. DNS results must be public IPv4 addresses and the selected address is pinned to the request. Private, loopback, link-local and reserved addresses are refused. Provider pagination links never become arbitrary request URLs.

All pages must complete within 50,000 rows, 100 columns, 501 requests, bounded response bytes and existing file limits. Duplicate IDs/repeated cursors, invalid shapes, oversized responses and empty snapshots fail instead of publishing partial or fabricated data. Some provider APIs expose a limited authorized history window; the snapshot covers what this connection is permitted to read, not an invented complete business history. A moving upstream dataset cannot provide database-style snapshot isolation; duplicate cursor/identity checks reject detected instability.

One connection has one active refresh owner tied to a live job lease token. Network work runs outside the publication transaction. A new version is immutable and remains pending until actual parsing/profiling succeeds. Publication verifies the worker lease, connection revision, enabled state and current owner, then records the active version, refresh execution and job receipt together. Disconnection/configuration changes prevent an in-flight import from publishing. Replay reuses a staged immutable snapshot. Failure or cancellation preserves the last good active version.

HTTP 429 honors Retry-After through both job availability and a connection-wide cooldown; other jobs cannot bypass it. Transient network/provider failures use bounded worker retries. Source summaries expose CONNECTED/SYNCING/EXPIRED/DELAYED/FAILED/DISCONNECTED and safe error codes. Raw provider errors, credentials and customer response bodies are never exposed as diagnostics. UTC boundaries are explicit in raw queue/cooldown SQL, including non-UTC PostgreSQL sessions.

Disconnect is immediate locally even if the provider is unavailable. Pending remote revocations retain encrypted credentials for a subsequent DELETE retry. WooCommerce read keys cannot revoke themselves through the read-only API: local use is removed, and the response explicitly requests key deletion/rotation in the store. No fake remote-revocation success is returned.

## Development acceptance

Use Node 22, a dedicated disposable Dashboard database and separate test storage:

```sh
npm run verify:connectors
```

Reapply db:grant after the additive migration when using a restricted runtime role. CI and the disposable development gate include connector tests. Provider-shaped HTTP contract fixtures exercise all eight OAuth/API adapters, real database/storage publication, tenant boundaries, refresh scheduling and failures; they never call real customer accounts. See item10-connector-acceptance.md for executed results and the live-provider boundary.

## Provider specifications consulted

- Google OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
- Sheets values: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
- Shopify standalone OAuth: https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps
- Shopify orders: https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders
- Stripe Connect: https://docs.stripe.com/connect/oauth-reference
- QuickBooks OAuth: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- WooCommerce authentication/pagination: https://developer.woocommerce.com/docs/apis/rest-api/
- HubSpot OAuth migration: https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/migration-guide
- Square tokens: https://developer.squareup.com/reference/square/oauth-api/obtain-token
- Xero OAuth: https://developer.xero.com/documentation/guides/oauth2/auth-flow/
- Xero invoices: https://developer.xero.com/documentation/api/accounting/invoices
