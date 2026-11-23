# Dashboard request rate limits

Every API request allowed by the existing release gate passes through the independent Dashboard request limiter before its route handler. Defaults are 600 general API requests and 30 authentication requests per network per fixed UTC minute. API routes share one budget; authentication routes share another. Changing a URL, cookie, query string or untrusted forwarded header does not create a new budget. Existing identity, membership, subscription, CSRF and integration controls still run on allowed requests.

Counters live in the Dashboard-only PostgreSQL database. An atomic upsert serializes concurrent consumers, including requests from different web processes. PostgreSQL supplies the window clock, independent of application timezone or clock differences. A denied request receives HTTP 429, a JSON `RATE_LIMITED` code, `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and `Cache-Control: no-store`. Configurations outside the documented bounds, missing migrations and database failures return HTTP 503 with a safe `REQUEST_PROTECTION_UNAVAILABLE` code and a five-second retry hint. Protection cannot be disabled through a runtime flag.

Health/readiness and both sign-out routes remain exempt so operational probes and session revocation stay available. Static assets and page rendering are outside this API budget. Existing release denials remain unchanged and do not consume a budget. Webhooks, admin APIs, integration discovery and otherwise unknown API paths use the general API budget when the release boundary permits them.

## Network identity and ingress

By default no client address header is trusted. Requests without a verified ingress address share the `unattributed` network budget. This is safe for direct local development and avoids an attacker choosing arbitrary `X-Forwarded-For` values to escape limits. For multiple customers behind an ingress, configure an exclusive trusted proxy that overwrites a dedicated header using the actual peer address and prevent direct access to the web process. Only then set both:

```dotenv
DASHBOARD_RATE_LIMIT_TRUST_PROXY=true
DASHBOARD_RATE_LIMIT_IP_HEADER=x-dashboard-client-ip
```

The header must be lowercase and start with `x-`. It must contain a single valid IP address without a port or chain. Invalid/missing addresses use the shared unattributed budget. Equivalent IPv6 representations and IPv4-mapped IPv6 normalize consistently; IPv6 addresses in the same /64 share a budget. Different clients on the same IPv4 NAT share a budget. The limiter does not trust caller-supplied user or workspace identifiers.

`infrastructure/security/dashboard-ingress.caddy.example` shows an independent ingress that overwrites this header from the actual peer. It is a configuration example, not an activated deployment. If a further proxy precedes it, explicitly design and verify that trust boundary before changing address attribution. Do not blindly trust the first or last address of a forwarding chain.

## Configuration and maintenance

`DASHBOARD_RATE_LIMIT_API_PER_MINUTE` defaults to 600 and `DASHBOARD_RATE_LIMIT_AUTH_PER_MINUTE` defaults to 30. Each accepts an integer from 1 through 100000. All web processes must use the same limits and address settings. Fixed windows permit requests on either side of a minute boundary; this is request-frequency protection, not a byte, concurrency, subscription or infrastructure DDoS quota.

The additive migration creates `DashboardRequestBucket` with an indexed expiry. Existing data and tables are preserved. Each record contains a SHA-256 network/class key and counter metadata, without raw addresses, tokens, identities, request URLs or request bodies. Hashing is pseudonymization, not encryption or anonymity. Counters expire two minutes after their window begins. The existing worker's hourly authentication maintenance deletes expired counters; `npm run auth:cleanup` also removes them. Storage cleanup therefore depends on running the worker or scheduling that command, and can lag the expiry until the next maintenance run.

Apply migrations and grant the runtime role through the existing protected development setup. `npm run verify:request-limits` requires Node 22 and the disposable loopback `dashboard_test` database with separate runtime/migration roles. It checks the schema, five focused tests, a clean build, the actual production request boundary, all HTTPS BI browser workflows and the separate OIDC browser test. The combined acceptance gate discovers the new regression tests and runs the production boundary check as part of its existing BI stage. Customer/development database URLs are refused before migrations or fixture writes.

Live ingress attribution, traffic sizing and deployed monitoring remain deployment acceptance work. No website/Analyst source, shared database, production configuration or external-product connection is changed by this implementation.
