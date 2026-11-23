# Marketing APIs, configurable APIs and signed source webhooks

Audit references 168–170. These development sources are managed under **Workspace → API sources and webhooks** (`/dashboard/app/workspaces/<workspaceId>/custom-sources`). The existing eight provider integrations continue to use Connections. Source authoring and refresh require current connector permissions and an active subscription; schedules also require job-management permission. Tenant, custom-role, CSRF, release, storage and worker boundaries remain enforced.

## Activation and credentials

Both `DASHBOARD_DATA_CONNECTORS_ENABLED=true` and `DASHBOARD_CUSTOM_SOURCES_ENABLED=true` are required, together with a dedicated 64-hex-character `DASHBOARD_CONNECTOR_ENCRYPTION_KEY`. Defaults are inactive. Configure these privately; do not commit secrets. Existing BETA workspace release rules also apply.

Generic API endpoints additionally require an exact normalized HTTPS origin in comma-separated `DASHBOARD_CUSTOM_API_ORIGINS`, for example `https://api.example.com`. Endpoint URLs cannot contain credentials, queries, fragments or nonstandard ports. Parameters are configured separately and cannot contain token/password/API-key names. This allowance is scoped to the configurable reader: it does not widen legacy provider egress. Transport pins public IPv4 DNS, validates TLS, refuses redirects and limits individual responses to 8 MB. Loopback/private/link-local endpoints are unavailable.

Google OAuth applications need `DASHBOARD_CONNECTOR_GOOGLE_ANALYTICS_CLIENT_ID` / `_SECRET` or `DASHBOARD_CONNECTOR_GOOGLE_ADS_CLIENT_ID` / `_SECRET`. Google Ads also requires the server-side `DASHBOARD_CONNECTOR_GOOGLE_ADS_DEVELOPER_TOKEN`. Register the exact configured application origin plus `/dashboard/app/api/custom-source-oauth/callback` as the callback. GA4 requests `analytics.readonly`; Ads requests `adwords` but the adapter performs only report searches. Google Ads does not offer a narrower read-only OAuth scope; grant appropriate account access. The application exposes no ad mutation command.

OAuth uses five-minute actor/source/revision-bound state and PKCE. Completion rechecks current membership and permission; refresh is serialized. Credentials are encrypted and never returned in metadata or audit details. Configuration changes revoke credentials. Suspension disables this source's schedules and invalidates authorization; already running workers must still pass publication checks. Revocation is not a claim that a remote provider has revoked its own grant.

## Configurable JSON API

Supported authentication is public, bearer token or API key using one of the four named headers offered by the interface. Tokens are entered separately, optionally with expiry. GET requests return flat scalar records; nested cells require upstream flattening. An explicit string or safe-integer identity field must be present and unique. Optional mappings select/rename fields; unknown mapped inputs are rejected. Dataset business meaning remains subject to normal customer confirmation.

SINGLE mode reads one JSON response. Records path defaults to `records`; an empty path accepts a root array. CURSOR mode requires a stable snapshot envelope, for example:

```json
{"records":[{"id":"order-1","amount":"12.50"}],"snapshotId":"immutable-export-7","total":2,"nextCursor":"page-2"}
```

Subsequent requests use the same approved endpoint and configured cursor parameter. The final page has `nextCursor: null`. Snapshot ID and total must remain identical, identities cannot repeat, and final row count must equal total. A cursor is a parameter value, never a URL to follow. A producer without this snapshot contract should expose a single complete snapshot instead. Offset pagination, arbitrary headers, executable transforms, incremental CDC and arbitrary HTTP methods are not supported.

Readers enforce 500 pages, 50,000 rows, 100 columns, 50 MB cumulative response bytes and the configured final upload-size limit. Empty snapshots are rejected and retain the last good version. Manual refresh and schedules use the existing leased SOURCE_REFRESH worker, immutable storage and profiling pipeline; errors do not publish a partial version.

## Marketing reports

GA4 uses the Data API v1beta with daily campaign/source-medium dimensions and sessions, total users, ecommerce purchases, key events and total revenue. Users are explicitly labeled nonadditive. Google Ads uses v26 campaign/day search with cost, clicks, impressions, conversions and conversion value. Cost micros are converted exactly to decimal major-unit strings; missing measures remain null and fractional conversions remain decimal strings. Conversion value is not asserted to be business sales revenue. Currency, source timezone and API version accompany every row.

The interface offers last seven days, last thirty days, this month and last month. GA4 monthly boundaries derive from the property's reported timezone; Ads uses the account's date-range semantics. Refresh replaces the current rolling-window snapshot; it does not append a permanent full-history ledger. Both readers repeat the complete paged report and require exact equality before publication. This can legitimately reject mutable current-period reports; retry after the source stabilizes. GA4 sampled, thresholded, truncated or restricted reports, inconsistent metadata, foreign Ads accounts, duplicate identities and incomplete totals are refused. Source-reported attribution and API freshness are not certification of accounting accuracy.

Primary contracts: [GA4 runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport), [GA4 schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [GA4 metadata](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData), [Ads REST authorization](https://developers.google.com/google-ads/api/rest/auth), [Ads v26 search](https://developers.google.com/google-ads/api/reference/rpc/v26/GoogleAdsService/Search?transport=rest).

## Signed inbound complete snapshots

Create a signed webhook source and copy its one-time key. The 64-character hex key represents 32 binary bytes. The receiver is:

```text
POST /dashboard/app/api/workspaces/<workspaceId>/sources/<connectorId>/webhook
```

Send UTF-8 JSON with a unique event ID and a strictly increasing positive sequence encoded as a decimal string (maximum signed 64-bit integer):

```json
{"schemaVersion":1,"eventId":"export-42","sequence":"42","records":[{"id":"order-1","amount":"12.50"}]}
```

Let `timestamp` be the current ten-digit Unix time in seconds. Compute HMAC-SHA256 with the **hex-decoded** key over the exact bytes of `timestamp + "." + workspaceId + "." + connectorId + "."` followed by the raw request body. Supply `X-Averidi-Timestamp: <timestamp>` and `X-Averidi-Signature: v1=<lowercase hex digest>`. The accepted clock skew is five minutes. Reformatting JSON changes the signature. Browser login alone cannot authorize a delivery; the signature is mandatory.

The receiver bounds body bytes and read time, validates records/identity, stores a private immutable file, then atomically commits a pending dataset version, profiling job, receipt and sequence. An accepted response identifies the receipt, job and version; it means durable admission, not completed profiling. Check delivery history for PROCESSED/FAILED/CANCELLED. One pending import per dataset applies backpressure (409 with `Retry-After: 5`). Send a fresh timestamp/signature on retry. An exact event/body replay returns the existing receipt; changed bytes for the same event, an older sequence or legacy unbound receipt conflict. This protocol accepts complete snapshots only, with at least one row; it does not interpret events as incremental inserts/deletes.

Rotation displays a new key once and immediately invalidates the previous key and pending jobs' configuration binding. Suspension disables ingestion. The latest failed/cancelled delivery can be retried from the interface only while its configuration revision, sequence and retained version/file still match. If rotation or configuration change invalidates it, send a new higher-sequence complete snapshot. Failed imports retain the last good current version. Administrative job submission cannot bypass receipt/job binding. Composite foreign keys and complete-binding constraints protect new receipt records; old unbound records remain inert.

## Verification and remaining acceptance

`npm run test:custom-sources` runs focused native PostgreSQL cases. `npm run verify:custom-sources` refuses nondisposable databases before fixture writes and executes schema/migration/generation, focused tests, clean typecheck/build, dedicated HTTPS source browser/worker flows, existing BI workflows and separate HTTPS authentication acceptance. It requires the same disposable migration/runtime roles, private storage and browser environment as the existing verification workflows. Synthetic provider fixtures exercise real HTTPS application routes, OAuth callbacks, worker imports, credentials and rejection behavior; they do not contact Google or a customer's API.

These implementations do not certify live provider approvals, real account data, hosted CI, production ingress, operator deployment or the complete recovery gate. Live connector acceptance remains audit 171. Quotas beyond the existing technical safety bounds remain audit 181. No integration is activated by publishing this source change.
