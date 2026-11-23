# Customer metric and formula authoring

Audit reference 105 adds named customer formulas on Custom metrics. The implementation reuses the existing governed dataset analysis, metric definitions, metric components, source verification and business-period filtering. It does not replace built-in business calculations.

## Define and review a formula

Choose a dataset with confirmed fields/rules and a ready governed analysis. Give the formula a name and business meaning, choose its display format, and optionally select a confirmed date field and reporting period. Leaving dates blank explicitly means all rows in the current source version. Period filters use the existing business timezone and calculation engine. Category filters are also supported by the API's existing analysis-query contract.

Formulas combine ready governed metric keys, decimal constants, arithmetic operators and parentheses, for example `(REVENUE - COST) / REVENUE`. Inputs inherit their existing field mappings and financial treatment of refunds, discounts, cancellations, returns, tax and shipping. An arbitrary source column cannot replace a governed input. Unavailable or unconfirmed measures and failed dataset quality prevent preview/save. Customer definitions cannot call other custom formulas, so they cannot introduce dependency cycles.

Preview recalculates the selected period from verified source bytes using the existing engine. It shows the result, inferred units, required input definitions/source fields and their governance versions. Currency, number and percent display are supported; percent formulas return fractions, so 0.25 displays as 25%. The customer explicitly reviews the meaning, treatments, period and output before saving. No adjustments or missing values are inferred.

## Numerical and execution bounds

The parser is an explicit arithmetic grammar. It never uses eval, JavaScript execution, function/property access, SQL or source-text interpolation. Expressions are limited to 512 characters, 128 tokens, 16 nesting levels and 16 distinct governed inputs. Decimal constants are bounded to 10^12. Zero denominators, incompatible units, unavailable inputs and results outside 20 integer digits are refused. Multiplication/division derive units; addition/subtraction require matching units. Currency and percentage formats must match inferred units.

Evaluation uses isolated decimal precision of 40 digits and rounds the saved output to at most 10 decimal places. It starts with the existing governed engine's returned values and cannot retroactively increase their precision. The exact saved decimal string is available in lineage; human display may use fewer places. No global Decimal settings are changed.

## Persistence, freshness and permissions

Existing DashboardMetricDefinition and DashboardMetricComponent records store the formula and input snapshots. Custom keys use a separate namespace. Built-in definitions cannot be edited through this interface. Up to 100 custom definitions are supported; lists show up to 100 ready datasets. Deletion refuses referenced results, widgets, targets or alerts. Create/edit/delete actions record actor-attributed audit events containing the definition history.

The saved definition includes its source version/checksum, confirmation revision, analysis/engine identity, exact field/rule snapshot, reporting query, component definitions and source fields, output and calculation timestamp. All-row scope is recorded explicitly through the empty filter list rather than an invented reporting date. The result is a reviewed snapshot: a changed source version, confirmation revision, invalidated analysis or engine version marks it for review. Edit, preview and save again to adopt a new source. Historical definitions/results remain in the audit ledger.

Saving requires a matching preview hash for the exact reviewed formula, rules, query, inputs and source. The server recalculates and compares before publication, then locks/checks the current dataset version and confirmation revision. Concurrent edits/deletion require the reviewed definition timestamp. Workspace membership and custom analysis.manage permission are rechecked in the write transaction. Readers require analysis.read and an active subscription; authoring requires Editor/Owner and analysis.manage. HTTP writes require same origin and strict bounded JSON. Read-only custom profiles retain read access without receiving authoring controls.

Custom results are displayed on Custom metrics. Existing generated dashboard charts, targets and reports retain their existing governed metric catalog; this change does not silently rewrite their definitions or add unsupported chart bindings.

## Verification

Run `npm run test:custom-metrics` for focused PostgreSQL/numerical cases, or `npm run verify:custom-metrics` for the focused clean-build and real HTTPS browser gate. It requires Node 22, a disposable loopback dashboard_test database, separate migration/runtime roles and private temporary storage. Non-disposable databases are refused before access. The optional DASHBOARD_CUSTOM_METRICS_VERIFICATION_REPORT captures successful completion of all 10 stages.

No migration, dependency, commercial policy, provider activation or other-product change is required by this addition.
