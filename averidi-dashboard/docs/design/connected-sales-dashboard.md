# Connected approved Sales dashboard

The approved source is `public/design/sales-dashboard.html`, preserved byte for byte. `scripts/sync-approved-sales-design.mjs` extracts its stylesheet and dashboard markup into the typed presentation asset. Use `--check` to verify synchronization. Do not restyle the generated asset.

`SalesDashboard` mounts that markup in a native shadow root, which prevents the application's older global button/table rules from changing its appearance. The DOM adapter binds existing data, date and dimension filters, comparison values, metric/cadence selectors, export and authenticated workspace links. Dynamic source labels are written with `textContent`, never interpolated into HTML. No runtime iframe, remote font, copied customer data, or cross-application connection is used.

The existing saved-view data endpoint supplies confirmed metrics, real filter choices, observed business-date bounds, and the authenticated user's workspace/display name. Older saved Sales layouts receive the canonical Sales panels when read. Saved extra widgets remain available to tools/exports; stored definitions and datasets are not deleted. Other dashboard templates retain their current canvas and layout editor.

Finished Sales pages suppress the legacy outer navigation, trial strip, page padding and editor actions. Studio remains the configuration destination. Clicking a supported breakdown opens the existing governed row exploration below the dashboard; normal viewing retains the approved artboard.

Unavailable or unconfirmed values render as unavailable. Comparison changes are shown only when calculated; the date selector enables the existing previous-period comparison. Missing heatmap months are not fabricated as zero sales. Geographic state fills use confirmed state values, or recognized US region groups; other geography is displayed by its original labels. Changing live data naturally changes numbers, labels, chart shapes and supported insights, while the stylesheet and panel geometry remain fixed.

## Validation

- Approved source SHA-256: `16a259c0f2f8e257e2448d7fe31687ffc1629dba00f161ad603e02f577db5cc8`; the generated stylesheet matches verbatim.
- Browser comparison at 1536 × 1024: all fifteen card positions/sizes and heading font family, size, weight and color match the approved HTML. No card overflow in the connected test dataset.
- Browser interactions checked: region filtering, profit selection, yearly trend aggregation, date comparison, export callback, export denial, customer drill-down, missing values and retry.
- Eighty focused tests pass, including canonical Sales generation, formatting, date extents, data filtering, metric engines, preserved saved extras, and non-Sales template behavior.
- Fresh isolated database: upload, worker, confirmation, calculation, dashboard read, filters, CSV export, stale-source rejection and authorization integration pass.
- Production Next.js build and TypeScript validation pass on Node 22.23.4. Client-safe metric descriptions/query schemas were separated from server-only calculation imports; formula implementations are unchanged.

The broader baseline suite already fails `trailing 12 calendar months handles leap days rather than 365-day shorthand` and `39 mix shift measures prior-price contribution without changing portfolio revenue reconciliation`. Both failures were reproduced on the unmodified starting snapshot; they are not fixed or introduced here. The isolation checker also reports the same 28 pre-existing matches in embedded repair-script templates, with no new findings from this change.
