# Section 1, item 1.3 — Operations metrics

## Implemented independent Dashboard infrastructure
The operations engine is `src/engines/metrics/operations-metrics.ts`. It adds six governed outcomes without changing existing sales, marketing or inventory formulas:

1. Completed work — sum of source-confirmed completed tasks/jobs.
2. Labor hours — confirmed productive hours in the same observation period.
3. Productivity — completed work per productive labor hour.
4. Average cycle hours — total completed-work cycle hours divided by completed count.
5. Operational errors — source-confirmed error count.
6. Defect rate — defective units divided by inspected units, **only** when explicitly confirmed that the source error count denotes unique defective units, not incidents.

The engine requires user confirmation of a shared, nonduplicated observation period. Productive labor hours and total cycle hours have separate confirmation controls, as does defective-unit interpretation. Unconfirmed, ambiguous or duplicate mappings, negative data, fractional counts, unsafe totals and zero denominators refuse calculation. Every result carries source-field lineage, dataset version and versioned definition identity.

The existing workflow exposes these concepts in dataset field confirmation, user-specific rules in Studio, analytics and grouping, an OPERATIONS dashboard template, saved-view validation and standard chart/report export. `ANALYSIS_ENGINE_VERSION` is 4; pre-existing runs remain stored but are not silently reused as current.

## Tests and verification
`tests/operations-metrics.test.ts` provides five acceptance cases for numerical truth, correct subgroup recomputation, confirmation fail-closed behavior, invalid ratios, precision and unchanged original metric catalog. `npm run verify:operations` includes operations, inventory, marketing, prior analysis/views, typecheck and production build. `npm run verify:complete` discovers the new tests and runs the broader isolated database/browser gate.

**Source-level integration reviewed, runtime acceptance not yet observed.** The GitHub connector does not run commands inside the user's Codespace, and the container for this conversation does not contain the complete repository or installed dependencies. The code must not be described as fully accepted until the focused gate and complete gate pass using their documented isolated environment.

```bash
cd /workspaces/averidi-dashboard
git pull --ff-only origin feature/independent-dashboard
nvm use 22
npm ci
npm run verify:operations
```

Use `docs/complete-verification.md` with an isolated disposable `dashboard_test` and distinct runtime/migration roles before invoking `npm run verify:complete`; it refuses `dashboard_dev`. Do not touch other products, `main`, the server or production.
