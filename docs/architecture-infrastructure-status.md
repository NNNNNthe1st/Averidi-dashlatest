# Infrastructure alignment with Averidi Dashboard Complete Architecture
Status: development branch, 2026-10-23. Source present does **not** imply remote resources are provisioned or acceptance is complete.

| Word section | Infrastructure | Evidence | Remaining boundary |
|---|---|---|---|
| 1–4 | Independent source, routes and package | This repository, next.config.ts, scripts/check-isolation.mjs | Independent deployment and reverse proxy are not connected |
| 6–7 | SSO-compatible identity and standalone sessions | src/server/oidc-*.ts, browser-session.ts, auth routes | Item 6 native PostgreSQL, restricted-role and actual HTTPS Chromium acceptance passed; real provider/central SSO activation remains separately approved integration |
| 8 | Protected independent admin resource API | src/app/api/admin/v1; src/features/administration; src/server/admin-bridge.ts | Item 9 adds support/configuration/usage/connector health; website administrative UI and issuer remain unconnected |
| 9 | Independent catalog, entitlements, billing events and reconciliation | src/features/billing; src/features/subscriptions; docs/item9-subscriptions-administration-acceptance.md | Item 9 source infrastructure implemented; live provider configuration, website checkout ownership/creation and central UI remain separately authorized integration |
| 10–11 | Dashboard-only BI engines and database | src/engines, prisma/schema.prisma, migrations | Review items 4 and 8 accepted locally: database persistence and governed source-to-dashboard pipeline for the implemented metric catalog; specialist roadmap features remain separate |
| 12 | Workspace-qualified storage, lifecycle and encrypted recovery | src/server/storage.ts; src/features/storage; docs/item5-storage-acceptance.md | Item 5 development acceptance passed for local and authenticated HTTPS S3 contracts; real remote buckets, IAM and deployment policies remain environment provisioning |
| 13 | Dedicated worker and durable job lifecycle | src/worker, scripts/check-worker.mjs; docs/item7-worker-acceptance.md | Twelve processor entry points, durable schedules, receipts, recovery and protected in-app CSV delivery accepted on native PostgreSQL; additional connector resources, external report transports and provisioning remain separate |
| 14 | External business connectors | Data ingestion engines, inactive contracts | Item 10 implements eight provider-specific OAuth/API readers, encrypted credentials and durable refresh; provider app registration, consent and live-account acceptance remain external configuration |
| 15 | Versioned future Averidi contracts | src/contracts; contracts/v1; src/features/ecosystem; docs/item11-integration-contract-acceptance.md | Item 11 development infrastructure accepted: identity/admin/billing/events/navigation and HTTPS contract tests; source lock remains false and real applications remain unconnected |
| 16 | Source, session, tenant and storage security | tests, authorization services, scripts/check-isolation.mjs | Actual fixture-based authentication and BI browser tests passed; full security audit and real-provider integration remain separate |
| 17 | Isolated development infrastructure | dev:setup; dev:serve; verify:development-infrastructure; docs/item13-development-environment-acceptance.md | Native setup, repeated setup, application/worker launch and all 21 combined stages passed; Docker execution and hosted acceptance remain unverified/blocked; staging and production remain separate future provisioning |
| 18 | Complete automated verification | scripts/verify-complete.mjs; .github/workflows/verify.yml; docs/item12-verification-acceptance.md | Item 12 implementation and all 21 local stages passed, including 166 restricted-role tests, browsers, WCAG/performance and real database recovery; successful hosted execution remains blocked at runner startup and is not claimed |
| 19–20 | Preserve original 375-point phased plan and independent extraction | docs/repository-extraction.md, docs/history | Remaining roadmap items must be completed against real code, without copying Analyst code |
| 21–22 | Canonical domain and product responsibility boundaries | next.config.ts, src/contracts/integration.ts | Public-domain routing to Dashboard and central experience need explicit later approval |

## New runtime readiness check

- `GET /dashboard/app/api/health` is a lightweight, release-independent process response and retains its existing behavior.
- `GET /dashboard/app/api/health/ready` checks dedicated database connectivity, standalone storage **configuration**, validated release configuration, and fresh worker heartbeat only when `DASHBOARD_WORKER_ENABLED=true`. A missing dependency returns HTTP 503. The response has no credentials or customer data.
- Storage configuration readiness does not prove a remote bucket can be read/written; use dedicated storage acceptance for that.
- A readiness 200 does **not** imply subscriptions, product functionality, deployment or customer release is enabled.
- Both health routes remain reachable when `DASHBOARD_RELEASE_MODE=OFF`, for diagnostics.
- `npm run test:health-readiness` runs logic checks; `npm run verify:item1` includes them.

## Evidence and safety rules

The user's independent Codespace ran `verify:item2`, `verify:phase3` and `verify:item1` successfully on 2026-10-22 **before** these new readiness commits. These commits require a fresh run before claiming green.

Do not run migrations on website/Analyst/production databases. Do not activate future Averidi integrations or reverse proxy. Do not provision or change production during development. Do not regard templates/checklists as actual staging or production resources.

### Remaining infrastructure needed before staging/release

1. Provision Dashboard-only staging PostgreSQL, storage, worker and application, distinct from development and production.
2. Configure environment-specific credentials, restricted networks, backups, retention and restore tests.
3. Configure independent monitored HTTPS endpoint and versioned deployment/rollback.
4. Perform authorized canonical-domain routing, real identity and administration integration only through their approved contracts.
5. Complete additional provider resources, demand-driven connectors, report formats/transports and specialist roadmap capabilities beyond the implemented adapters.
6. Rerun native acceptance, browser, tenant isolation, security and production-like recovery tests.

Source of truth: *Averidi_Dashboard_Complete_Architecture.docx*, especially sections 11–18 and 20–22.


## Current BI acceptance

See `docs/item8-bi-acceptance.md` for the executed 105-test regression, native PostgreSQL migration/role checks and actual Chromium workflow. This supersedes earlier statements that the metric engine was disconnected from Studio.

## Current worker acceptance

See `docs/item7-worker-acceptance.md`: all 109 regression tests, native multi-process crash/replay checks, restricted runtime-role handlers, migrations, build and Chromium workflow passed. This supersedes earlier worker-only profiling limitations.

## Current authentication acceptance

See `docs/item6-authentication-acceptance.md`: 110 regression tests, native restricted-role authentication, actual HTTPS Chromium login/session/logout and the existing BI browser workflow passed. This supersedes earlier WASM-only and missing-browser limitations.

## Current connector acceptance

See `docs/external-data-connectors.md` and `docs/item10-connector-acceptance.md` for the eight implemented resource adapters, protected connection APIs, native database/worker acceptance and the distinction between tested contracts and live provider activation.

## Current storage acceptance

Checklist item 5 is complete: owner-controlled retention, quarantine, orphan/abandoned-write cleanup, publication fences, encrypted backups and verified restore. See `docs/item5-storage-acceptance.md` for native PostgreSQL, restricted-role, HTTPS S3/CLI and regression results.


## Current future-connection acceptance

Checklist item 11 is complete as **prepared, inactive** infrastructure. OpenAPI/JSON Schema artifacts, strict identity/admin/billing/event contracts, membership-qualified read handlers, safe product navigation and the offline HTTPS conformance client are implemented. All 160 regression tests and both Chromium workflows passed. See `docs/item11-integration-contract-acceptance.md`; external activation and real consumer implementations remain separate authorized work.


## Current complete-verification acceptance

Item 12 now has one source-fingerprinted 21-stage gate, complete test discovery, restricted-role execution, TAP/JUnit and retained CI reports, fresh builds, native database dump/restore, keyboard/WCAG scans and maximum-dataset performance checks. The complete local run passed with 166 root tests and both browser workflows. Hosted jobs previously failed before executing a step; hosted success remains an external acceptance requirement. See `docs/item12-verification-acceptance.md` for the explicit distinction.

## Current combined development acceptance

Review item 13 has complete development-side setup, private restricted-role configuration, supervised web/worker startup, diagnostics and the full combined acceptance gate. Native local setup and all 21 stages passed with 169 regression tests and both browser workflows. Live readiness detects worker shutdown and recovery. See `docs/item13-development-environment-acceptance.md` for exact results and the separate Docker/hosted limitations; production provisioning is not a prerequisite for continuing development.
