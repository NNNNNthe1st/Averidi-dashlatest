# Sales US state boundary geometry

The approved map paths embedded in `public/design/sales-dashboard.html` and its generated `approved-sales-design.ts` asset were adapted from:
https://github.com/PublicaMundi/MappingAPI/blob/master/data/geojson/us-states.json

It contains the 50 states and District of Columbia. The original Puerto Rico
feature was excluded from the state-focused reference panel.

This geometry supplies **boundaries only**. No commercial metrics, state revenue,
region assignments, or artificial sales figures are included. The dashboard
calculates all displayed amounts from confirmed customer datasets and keeps
non-state geography values in their own source-labeled display.

No runtime dependency or network request to the source repository is required.
