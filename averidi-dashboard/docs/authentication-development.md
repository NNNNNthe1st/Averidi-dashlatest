# Review item 6 — independent authentication and sessions

Dashboard uses a standards-based external OIDC provider with its own local identity mapping and session records. The production identity-provider decision is unchanged. The optional Keycloak realm below is a disposable development fixture, not a new Averidi customer identity service or an active website integration.

## Implemented boundaries

- Authorization-code flow with PKCE S256, state and nonce; five-minute signed HttpOnly pending cookie.
- Hash-addressed login-attempt records consumed atomically once, before token exchange; expired/replayed attempts fail closed.
- HTTPS-only issuer-owned endpoints, exact registered Dashboard callback, no redirect-following at token exchange.
- Signature, issuer, audience, expiry, issue time, nonce and authorized-party checks; bounded subject/token inputs and a streamed 64 KiB token-response limit; stable issuer/subject mapping, never email joins.
- Dashboard-only signed, 30-minute browser sessions backed by revocable local database records.
- Atomic refresh rotation; an old session can produce only one successor. Individual logout, logout-all and session-version invalidation.
- Cookie mutations enforce Dashboard origin checks. Cookies use unique Dashboard `__Secure-` names, Secure, HttpOnly, SameSite=Lax and no Domain. Session cookies are restricted to `/dashboard/app`; pending OIDC cookies are restricted to `/dashboard/app/api/auth`. Login clears the former root-scoped development cookie names. Other applications do not use these cookies or their signing secrets.
- Callback parameters and cookies must be unambiguous: duplicate state/code or pending cookies fail closed. Malformed or duplicate session cookies never fall through to bearer identity. Callback failures clear pending cookies. Sign-out lands on a signed-out page and does not automatically restart SSO. The signed-out page and logout work in BETA and while customer release is OFF; login/refresh still obey the release gate.
- Expired login attempts and expired/revoked sessions are cleaned by the independent worker or `npm run auth:cleanup`.
- `npm run auth:check` validates discovery metadata, PKCE support and the session database without printing secrets.

## Optional isolated developer identity provider

Requires Docker Compose v2 and Node 22. Start from the Dashboard repository root:

```sh
npm ci
npm run dev:identity:up
npm run dev:identity:configure
```

The setup uses the documented Keycloak realm-import mechanism and Caddy local TLS. Only loopback ports 8443 (Dashboard) and 9443 (identity) are published. Generated settings and the local CA certificate live in ignored `.local/identity/`. The script preserves the generated session secret on repeated runs and never overwrites `.env.local`.

Load your dedicated Dashboard database/storage settings and the generated identity settings into the application process. For a POSIX development shell:

```sh
set -a
. ./.env.local
. ./.local/identity/dashboard.env
set +a
export NODE_EXTRA_CA_CERTS="$PWD/.local/identity/root.crt"
npm run db:deploy
npm run auth:check
DASHBOARD_RELEASE_MODE=GENERAL npm run dev
```

`GENERAL` above is an explicit **local development** release setting; it does not change any deployed product. The public local application is `https://localhost:8443/dashboard/app`. Configure the development browser to trust this specific generated CA using its normal certificate-management UI. Keep certificate verification enabled. Node trusts only the specified additional CA through `NODE_EXTRA_CA_CERTS`.

Open `/dashboard/app/api/auth/login`. Fixture credentials are username `dashboard-developer`, password `dashboard-local-only`. They exist solely in the loopback-only development realm. A successful callback creates the Dashboard-local identity and session; it does not grant workspace access or a subscription. Create/assign workspaces through separately authorized development tooling. Product onboarding and billing remain their own roadmap work.

To stop the fixture without removing its data:

```sh
docker compose -f infrastructure/development/identity/compose.yaml down
```

## Verification

`npm run test:auth-lifecycle` creates an ephemeral test TLS certificate and a child process that trusts only that extra test CA. A real HTTPS protocol fixture issues signed OIDC ID tokens. Tests cover PKCE, tampered/incorrect/replayed state, wrong nonce/audience/issuer/authorized party/signature, expired tokens, session creation/rotation/revocation/expiry and origin checks. No production authentication bypass is installed.

The protocol/database and actual Chromium browser suites now pass on native PostgreSQL 17. `npm run test:auth-browser` drives the production Next.js application through a separate HTTPS provider fixture: credentials → PKCE → callback → persisted local session. It verifies cookie paths, replay rejection, protected access, rotation, logout-all, expiry, BETA/OFF sign-out and discovery readiness. It never injects a session cookie to skip sign-in.

Node trusts only the fixture CA through NODE_EXTRA_CA_CERTS. Chromium keeps ignoreHTTPSErrors false and pins the ephemeral fixture public key through its certificate SPKI allowlist; certificate errors are not disabled globally. Fixture credentials, certificates and database records are disposable. The test provider lives only under tests; it is not an application authentication bypass or a second customer identity service.

The optional Keycloak/Caddy Compose configuration remains available for developer use. Docker was unavailable in this execution environment, so this acceptance does not claim a container-hosted Keycloak run. No production identity credentials or cross-product sessions are used.

Reference configuration: https://www.keycloak.org/server/containers ; https://www.keycloak.org/server/hostname ; https://caddyserver.com/docs/automatic-https

Current acceptance (2026-10-22): 110 full regression tests passed, plus actual HTTPS Chromium authentication and existing BI browser workflows, restricted-runtime-role authentication, type checking, optimized build and source isolation. See [item6-authentication-acceptance.md](item6-authentication-acceptance.md). This supersedes the earlier WASM-only verification record.

For a complete authentication gate against disposable loopback dashboard_test and separate test storage:

```sh
npx playwright install --with-deps chromium
npm run verify:authentication
```

Use Node 22. The gate deploys only the configured dedicated Dashboard migrations, so do not point it at another product or production. DASHBOARD_BROWSER_EXECUTABLE can select an already-installed Chromium. CI includes the browser gate after build and Chromium installation.

## Operations and future identity integration

Session signing requires a Dashboard-only secret of at least 32 bytes. Keep it out of source and logs. Increment DASHBOARD_SESSION_VERSION to invalidate existing browser sessions, or rotate DASHBOARD_SESSION_SECRET independently; neither requires sharing a website cookie or secret. Session database records enforce individual revocation and expiry even before a signed token expires. Refresh consumes one old session and creates one successor transactionally. The worker and auth:cleanup remove expired attempts and old session records.

The product-facing adapter accepts standards-based verified identity; it does not implement password reset or account recovery itself. Those belong to the trusted provider. Choose and configure the real provider, its registered HTTPS callback, discovery/JWKS endpoints and independent secret through the later approved integration. Login establishes identity only: workspace roles, subscription entitlement and release eligibility remain separate checks. No website, Analyst, production or public routing connection is activated by item 6.
