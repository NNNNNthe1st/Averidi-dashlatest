# Missing categories and source-record filters

A missing value is a null/absent source cell after the existing parser's normalization. It is distinct from a real text value such as `(Missing)`, `Unknown` or `null`. Filters do not reinterpret those words as missing data.

Chart groups use a typed identity containing both missingness and the actual category label. A missing group and a literal `(Missing)` category cannot combine their metrics or collide as rendered rows. The interface labels missing cells explicitly and provides separate accessible source-record inspection controls.

The strict query contract supports `{ "type": "MISSING", "field": "confirmed_field", "value": "" }`. A missing-value filter cannot supply a category value or end date. It remains limited to confirmed dimensions of the currently authorized source/dashboard. The same query reaches governed calculations, source inspection, private presets and report generation. CSV output includes an explicit `Missing group` column so equal-looking text labels remain distinguishable outside the application.

Customers can select “Missing values only” or inspect the missing group in a chart. Selected filters are disclosed on the canvas. Chart drilldown preserves an explicit observed-through range when turning off comparison; it cannot accidentally include unobserved dates. Missing dates appear in the value table and disable a time-series line until corrected. Invalid non-null dates still fail date validation.

Verification is in `tests/missing-categories-and-cac.test.ts` and the real upload/confirmation/chart/source-record browser workflow in `tests/fixtures/missing-cac-browser.ts`. The tests distinguish exact null/literal totals and source IDs and exercise desktop/mobile accessibility. Existing session, custom-permission, current-source, tenant and export guards remain authoritative.
