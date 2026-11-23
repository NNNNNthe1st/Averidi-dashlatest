# Sales engineering verification — 30 October 2026

This change strengthens the existing Sales workflow. It does not certify equivalence to an entire enterprise BI product.

## Implementation boundaries

- Sales schema inference profiles complete columns, discovers observed single/composite identities and solves a constrained assignment for revenue, cost, quantity and reporting date. Competing evidence remains unresolved. Scores are evidence weights, not probability estimates. Observed uniqueness does not establish an external business key.
- Source reconciliation can establish that discounts were deducted. It cannot establish absent refunds, tax, delivery, complete history or accounting policy. New customers receive separate questions for those facts; previously saved net-sales answers remain readable. Clearing a saved answer removes it from the current source-version choices.
- Nine core Sales measures use a typed decimal dependency plan with dimensional checks and exact decimal lineage. Ratios and distinct counts are recomputed over each selected population. The existing custom-formula AST and Decimal dependency were already present; this change does not claim to introduce them.
- Chart APIs retain numeric presentation values, with bounded conversion error and range checks. Exact decimal values feed plan dependencies. Statistical/forecast/price-volume routines are not all converted to decimal arithmetic. JSON numbers already rounded by JSON parsing cannot have their original precision recovered.
- Sales preparation previews available headline metrics and all eight chart requirements. Incomplete dashboards identify missing dimensions or business requirements and link to the corresponding source-version review.
- The approved HTML and generated reference stylesheet are unchanged. Runtime styles wrap unavailable KPI values and narrow panel headings. Long ranking labels retain their complete text in accessible labels/tooltips.
- The public sample uses the actual Sales renderer and calculation path, accepts only validated queries over fixed fictional rows, and never accepts tenant/source identifiers.
- Commercial terms use configured public catalog fields. No prices or successful checkout are invented when provider configuration is absent.

## Verification

- `npm run test:sales-workflow`: 120 passing tests, including constrained matching, date ambiguity, composite identities, decimal invariants, accounting questions and public sample query boundaries.
- 51 database-backed checks across fresh migrated fixtures: runtime-role restrictions, source quality, cache boundaries, periods, Sales upload/preparation, clearing saved answers, filtering, refresh, source isolation, onboarding and billing state. HTTPS test providers use a trusted fixture certificate; certificate verification remains enabled.
- 24 passing Marketing, Inventory, Operations, release and session-cookie checks. Decimal execution is opt-in through the Sales confirmation; other templates retain their existing calculation behavior.
- Production webpack build and TypeScript checks; source-boundary check passes. Approved HTML SHA256: `16a259c0f2f8e257e2448d7fe31687ffc1629dba00f161ad603e02f577db5cc8`.
- Browser customer exercise: actual file chooser, 1,000-row CSV preview/upload, worker preparation, separate business answers, 8/8 chart readiness, saved dashboard and CSV export. Export reports revenue 949294.07, cost 692555.30, gross profit 256738.77, 1000 orders, 120 customers and 4237 units.
- Five additional API/worker exercises: retail CSV, service JSON, repeated-order line items, detail plus summary rows and mixed currencies. All 46 requests completed successfully; mixed-currency monetary totals remain blocked. Browser observations verify partial-state explanations and no document-level horizontal overflow at the tested viewport.
- Authentication fixture: signup 201; unverified login 403; verification 200; repeated verification 200; wrong password 401; successful login 200. The browser then creates a trial workspace. Fictional credentials are supplied by the isolated fixture, not entered through the browser.

## Independent workbook check

Source: Microsoft's [Financial Sample workbook](https://learn.microsoft.com/en-us/power-bi/create-reports/sample-financial-download), downloaded from the page's official workbook link. SHA256 `c3f17156ab7c192571ecfc742e88c16a4b7243a4d4b4a420fcb68dec44e10196`; 700 rows. This external workbook is not redistributed in the repository.

A separate Python standard-library ZIP/XML reader and Decimal summation compared source totals with the production ingestion/interpretation/calculation pipeline. USD and UTC, discounts/refunds already accounted for, tax/delivery excluded, and product-cost meaning were explicit test facts, not inferred facts about every customer file. The workbook's numeric cells contain small floating-point serialization residuals; financial comparisons use two decimal places.

| Result | Independent total | Sales result |
| --- | ---: | ---: |
| Sales | 118726350.26 | 118726350.26 |
| Cost | 101832648.00 | 101832648.00 |
| Profit | 16893702.26 | 16893702.26 |
| Units | 1125806 | 1125806 |

Order and customer counts remain unavailable because the workbook does not supply those identities. The engine does not turn row counts into invented orders.

## External acceptance still required

The managed customer preview uses disposable migrated SQL data, captured test email, and simulated TLS termination/cookie transport. It verifies application behavior, not production database performance, real email delivery, production TLS configuration or a live payment-provider transaction. Those deployment/provider checks must be run against their configured environments before release. No production deployment is included in this change.


Follow-up corrections and their validation are recorded in [Sales engine corrections](sales-engine-corrections.md) dated 31 October 2026.
