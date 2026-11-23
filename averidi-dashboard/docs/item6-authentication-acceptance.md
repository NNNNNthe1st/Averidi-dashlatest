# Item 6 — independent authentication acceptance

Date: 2026-10-22 (Japan). Baseline: independent Dashboard commit 93a60d940ab47fd64cfdfcd237ecda1c21ce563a. Scope: checklist item 6, independent authentication and sessions, implementing the Word architecture's unified-authentication contract with independent product sessions.

| Requirement | Implemented and verified |
| --- | --- |
| Independent identity | HTTPS OIDC authorization-code flow with PKCE S256, signed pending state, nonce and atomic single-use login attempts |
| Verified provider responses | Signature/issuer/audience/time/nonce/authorized-party checks; wrong claims/signature and oversized/invalid responses rejected |
| Local mapping | Stable issuer and subject; login does not grant membership or subscription |
| Session ownership | Dashboard-only signing secret, signed 30-minute token and revocable local database record |
| Cookie isolation | Secure, HttpOnly, SameSite=Lax, host-only and Dashboard-path cookies; browser confirms no session cookie at website root or provider origin |
| Ambiguous inputs | Duplicate/malformed session cookies cannot fall through to bearer authentication; duplicate callback parameters/pending cookies rejected |
| Lifecycle | Atomic refresh rotation, old-token rejection, individual logout, logout-all, expiry and generation invalidation |
| Request boundaries | Same-origin cookie mutations; callback failure clears pending cookie; no-store responses and safe errors |
| Release behavior | BETA sign-out remains available; release OFF blocks new sign-in but preserves logout and signed-out page |
| Recovery and operations | Independent auth:check discovery/PKCE/database checks, auth:cleanup, worker cleanup, explicit session-version/secret rotation |
| Browser acceptance | Real Chromium credentials → provider → callback → protected application; no injected session shortcut |

Executed on native PostgreSQL 17 and Node 22: **110 full regression tests passed, zero failed/skipped**, the real Chromium authentication acceptance passed, the existing Chromium BI workflow passed, authentication lifecycle/revocation passed under the restricted runtime database role, and types/build/source isolation passed. No schema or migration change was needed. CI now includes the authentication browser gate; this local run does not claim hosted CI success.

The browser uses a separate HTTPS protocol fixture with signed RSA ID tokens, discovery, a credential form, one-use codes and PKCE verification. Node adds only the ephemeral test CA; Chromium pins only its public key with ignoreHTTPSErrors false. The fixture and generated credentials are test-only. Optional Keycloak/Caddy development configuration is present; Docker was unavailable, so container execution is not claimed.

Item 6's development infrastructure and acceptance are complete. Configuring the real trusted identity provider, central website SSO and production routing remains a separately approved integration. This work creates no new customer identity provider and shares no database, source, cookies or signing secrets with another product. Worker stays disabled by default, release stays OFF, external integrations stay inactive, and main/website/Analyst/production remain unchanged.
