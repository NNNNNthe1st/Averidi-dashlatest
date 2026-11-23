# Codespaces browser preview — 2026-10-23

The existing default development launcher deliberately keeps release OFF and the original optional identity fixture uses localhost origins. Codespaces browser forwarding requires exact external HTTPS callbacks and a private local server-to-provider route.

The explicit `dev:codespaces:setup` and `dev:serve -- --codespaces` commands prepare that configuration without modifying application authentication. Setup generates a private fixture realm and credentials, creates a uniquely scoped development workspace with a 30-day local STARTER fixture entitlement, and checks provider discovery through its trusted loopback TLS proxy. Normal username/password provider login, PKCE, signed tokens, nonce/issuer/audience checks and application sessions remain in use. Only the fixture workspace is in the local BETA allowlist. Future Averidi connections, business connectors and live billing remain inactive.

## Verified locally

- Environment/origin checks reject production, foreign forwarding domains and malformed Codespace names.
- Only the exact issuer's token, signing-key and discovery paths are routed to trusted loopback TLS. Real HTTPS transport preserves POST bodies and Request objects; production preload is rejected.
- The actual Next.js development launcher and separate worker became ready in BETA mode with native PostgreSQL 17 and restricted credentials. Repeated setup preserved secrets; shutdown was clean.
- The exact Codespace origin loaded development JavaScript assets; an unrelated origin received 403. Production configuration does not add a development origin allowance.
- The complete restricted-role gate, database recovery, regression suite, build and both browser workflows were run on the recorded source. Exact status, test counts and source fingerprint are in `codespaces-preview-results.json`.

The complete local run passed all 21 stages, 179 root regression tests and both browser workflows on the inspected marketing baseline `8c4f7d8` plus these preview changes. Concurrent marketing commits through `8c4f7d8` were preserved. Later concurrent inventory commits are preserved on publication but were not part of this source-fingerprinted run; this report does not certify them. Their registered verification commands and tests remain present. Browser acceptance explicitly selects the new marketing confirmations while retaining the original sales workflow assertions. No website, Analyst, production service, main branch or remote customer resources were accessed.

Docker-hosted Keycloak/Caddy and GitHub's private port forwarder cannot be exercised from this execution environment. The user's Codespace has already passed Docker database setup, all 17 migrations, restricted-role and storage checks, and live web/worker readiness. The new identity fixture and actual forwarded browser login must still be observed there. Native protocol/launcher checks do not substitute for that result. Earlier failed checks are not counted as accepted runs.

See `development-environment.md` for commands and port configuration. Keep forwarded ports 3000 and 8081 Private and use the generated developer credentials only in the isolated fixture.
