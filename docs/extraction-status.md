# Standalone Dashboard extraction status

## Already created
- Next.js application with future /dashboard/app base path (existing main website routing is unchanged).
- Dedicated Prisma schema and database client using DASHBOARD_DATABASE_URL.
- Dashboard-only storage implementation requiring DASHBOARD_STORAGE_ROOT.
- Initial data models: identity mapping, workspaces, memberships, datasets, versions, metrics, views and jobs.
- Dataset list/create domain service with membership-role checks and a protected API route.
- Independent OIDC and signed browser-session implementations; a real identity provider still requires configuration and acceptance.
- Inactive cross-product interface definitions.
- Dedicated private `NNNNNthe1st/averidi-dashboard` repository, with an independent development branch and 270 Dashboard-only source commits preserved in a verified Git bundle.

## Incomplete / must not claim finished
- Extract existing Dashboard Studio, ingestion, metric engine, reporting, connectors, billing and administration code from legacy locations.
- Production identity-provider selection and historical customer migration. Dashboard-only development OIDC/TLS configuration and session lifecycle infrastructure are implemented; native PostgreSQL and actual HTTPS Chromium protocol-fixture acceptance now pass (docs/item6-authentication-acceptance.md). Optional container execution is not claimed.
- Remaining product-domain schema and historical customer data migration. Development database/storage acceptance infrastructure is present; native PostgreSQL 17 container and dump/restore execution still require Docker.
- Remaining feature-specific background processors (see independent-worker.md). Queue/service/lease/progress/cancellation/scheduling/health infrastructure is implemented; profiling works end to end in the local PostgreSQL WASM test suite.
- API-contract and administrator integration into the existing website.
- GitHub-native restoration of the archived historical ancestry remains optional; its one-time import job was blocked before execution by the account billing/spending-limit restriction. All original extracted history remains available in the repository's bundle.
- CI / build / typecheck / browser and data-isolation test evidence.

## Rules
- Do not alter the website, Analyst, main branch or production as part of extraction.
- Do not enable unauthenticated production access to placeholder endpoints.
- Do not copy Analyst code or point standalone environment configuration to the website database.
