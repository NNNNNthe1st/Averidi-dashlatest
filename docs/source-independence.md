# Architecture item 10 — No shared source code

Averidi Dashboard is an independently built Next.js application in this dedicated Git repository. It was extracted from `sales_solutions/dashboard-standalone/`; that source prefix is no longer part of application paths here. Its application code, Prisma schema/migrations, storage adapters, background workers, contracts, tests and dependencies are owned by Dashboard. It must not import website or Averidi Analyst modules, source files, Prisma clients, build output, or static assets.

## Enforcement

Run `npm run verify:item10` from this repository's root. The boundary check covers TypeScript/JavaScript under src, scripts and tests; scans imports for parent-directory escapes, cross-product packages, absolute paths and symlinks; and rejects shared local package dependencies. This check is required for independent CI.

Only the Dashboard-owned project and its relevant history were extracted. The original website and Analyst sources were excluded from every extracted historical tree. Repository provenance is recorded in `repository-extraction.json`. Independent CI runs from this root; secrets, build/release permissions, schema validation, isolated database integration and production-build acceptance still require verification before release.

## Important limits
A dedicated private repository has been created at `NNNNNthe1st/averidi-dashboard`. The independent application is published on `feature/independent-dashboard`; original Dashboard-only history is retained in a checksum-verified Git bundle. GitHub Actions is currently blocked by the account's billing/spending-limit restriction, so no passing CI result is claimed. A source import audit cannot guarantee network, credential, runtime or deployment isolation. Do not merge the development branch to `main` or move production assets as part of this item.
