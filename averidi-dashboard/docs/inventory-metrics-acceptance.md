# Backlog 1.2 — Inventory metrics (independent Dashboard)

## Code implementation
- `src/engines/metrics/inventory-metrics.ts` is a separate governed engine; no changes to the calculation of the original nine sales metrics or the six marketing metrics.
- Eight governed inventory outcomes: stock-on-hand units, stockout products, stockout exposure %, current stock value, period inventory turnover, period demand units, products requiring replenishment, and units to replenish.
- Inventory Stock: requires explicitly confirmed single current snapshot and exactly one row per uniquely confirmed product. Historic snapshots or ambiguous duplicates refuse calculation.
- Stockout exposure: count products with zero current units; an optional source stockout flag must exactly agree with the on-hand quantity.
- Inventory value: requires current inventory monetary value per product in one confirmed currency.
- Turnover: `SUM(period COGS) / SUM(average inventory value over the same period)`. The source must supply *average* inventory value; a single current on-hand valuation is not substituted for that average.
- Demand and replenishment: source-reported demand units must cover a confirmed `inventoryDemandPeriodDays` of 1–366 days. User must specify lead time (>0 to 365 days) and optional safety coverage (0–365 days). Replenishment requirement for each product is `max(0, ceil(demandUnits / periodDays * (leadDays+safetyDays) - currentUnits))`. The metric is a basic stock-coverage signal, not an automatic purchase order or supplier commitment.
- All currency, grain, source columns and inventory policies are explicitly confirmed. Negative/invalid values and zero turnover denominators fail closed. Lineage retains dataset version and confirmed source fields.
- The Inventory dashboard template now selects governed inventory outcomes; source-origin assumptions are not inferred from product labels, channel names or historical rows.
- The Studio exposes the concepts and confirmation controls. `ANALYSIS_ENGINE_VERSION` bumped from 2 to 3 to avoid silently reusing results from the prior engine version.
- Added `tests/inventory-metrics.test.ts` with seven focused test cases covering calculation truth, SKU grouping, duplicate prevention, missing confirmations, stockout-flag conflicts, invalid numbers, overflow, zero denominator, mixed currencies, saved-view schema and invalid observation periods. `npm run test:inventory` and `npm run verify:inventory` are available.

## Verification state
Source implementation is committed to `feature/independent-dashboard`. Code-level wiring is cross-checked: all eight inventory metric keys are represented in the metric union and dashboard template, Studio inputs and rules are paired, the calculator is called by the analysis engine, and saved-view validation accepts the specialist catalog. **Execution acceptance is not yet independently observed.** GitHub files can be reviewed, but no direct Codespace process execution is available in this interaction. Do not mark full acceptance until the focused suite and the existing complete acceptance gate return green. Real production/staging remains untouched.

Run inside the independent Dashboard Codespace:

```bash
cd /workspaces/averidi-dashboard
git pull --ff-only origin feature/independent-dashboard
nvm use 22
npm ci
npm run verify:inventory
```

For full end-to-end acceptance, configure only a disposable `dashboard_test` database as described in `docs/complete-verification.md` and execute `npm run verify:complete`. The complete gate discovers all tests dynamically, including inventory, marketing and prior BI workflows. It intentionally refuses the persistent development database `dashboard_dev`.

Do not touch `main`, the website, Analyst, production server, or external customer accounts.
