# PDF, PNG and branded reports (original 262, 263 and 266)

Reports retains its existing CSV path and adds PDF and PNG choices using the same saved dashboard, governed analysis/query, private storage, worker queue, report schedules and in-app delivery. Report creation/editing retains current permissions, entitlement, view authorization, CSRF and revision checks. No external rendering service or browser installation is required.

## Customer workflow

Open Reports, choose a saved dashboard and output format. For PDF/PNG, set an optional business name, subtitle, accent color and logo; choose whether Averidi branding appears. Save the definition, Generate, then refresh Generated files and download the file labeled with its actual format. Edit reloads the saved branding and format. Schedules and inbox delivery support each format through the same existing queue.

The logo chooser accepts PNG/JPEG up to 1 MB and resizes to a small embedded PNG. The API accepts only bounded base64 PNG data, never image URLs, SVG, HTML or CSS. It checks PNG signature/dimensions, decodes at most 256×256 pixels and re-encodes metadata-free data of at most 24 KB. Report authoring alone receives a bounded 64 KB JSON body allowance; other analysis endpoints keep their existing 16 KB limit.

CSV remains the original exact tabular metric export. Branding controls apply to PDF/PNG. Original CSV files remain CSV after migration. Each generated artifact records its own format, so editing a report from PDF to PNG never changes the MIME type or filename of an older PDF.

## Rendering and fidelity

Both visual formats share one controlled SVG layout with an included licensed DejaVu Sans font. PDFKit embeds the font and renders vector PDF pages; resvg renders PNG using the same font with system-font loading disabled. Runtime dependencies are locked npm packages and bundled native binaries. Release construction already includes tracked public assets and therefore includes the font and its license. Native packages must be installed for the deployment's architecture using the lockfile; the existing release install path does this.

Saved dashboard pages determine widget grouping/order. Visible KPI, bar, horizontal-bar, line and table widgets use native governed values and grouped calculations; no new business arithmetic is introduced. Output includes exact numeric values, statuses and unavailable reasons, source version/checksum/analysis, filters, formula/field lineage, row counts, processing/calculation times, comparisons and page numbers. Workspace date/number presentation preferences are respected. Chart group order is paired with the full group labels and exact values below each chart; labels are wrapped instead of silently truncated.

PDF paginates up to 100 pages. PNG combines up to 12 pages vertically into one 794-pixel-wide image; larger image requests fail explicitly with guidance to use PDF or narrow filters. Output has a 32 MB bound. These are rendering resource limits, not row deletion or silent content truncation. Job errors preserve explicit page/image/file-size limit codes and customer guidance.

Customer strings are XML-escaped. Only renderer-generated SVG enters the libraries; image sources are embedded normalized PNG only, PDF external-document callbacks refuse access, and there are no remote resource requests. The font path is application-owned. Creation timestamps derive from the job's persisted creation time, making identical retries deterministic; native tests assert byte-identical PDFs.

## Durable publication and download

Rendering runs outside the final publication transaction. Cancellation/lease, current analysis, source semantics, report/view revisions and workspace presentation revision are checked before publication. Immutable artifact bytes and checksums use existing quota-protected private storage. Snapshotted format is stored with the export. Downloads recheck workspace entitlement, both current report view and original source-view access, expiry, exact storage scope, byte size and checksum, then return a private no-store attachment with an allowlisted MIME type, extension and content length. Delivery reuses the same integrity, membership, entitlement and view checks. Existing cleanup/backup/account-erasure paths already operate on all report artifacts and remain format independent.

## Validation

Native acceptance covers deterministic valid PDF/PNG files and nonblank raster output, branded logo/text, pagination, cancellation and image limits, malformed/external/oversized image refusal, actual restricted-role worker generation/download, format snapshots after edits, recipient delivery, due-schedule PNG generation/delivery, foreign tenancy, expired/tampered artifacts and read-only refusal. Existing CSV authoring/worker/export tests remain in the suite. The browser fixture creates both formats through the real UI, converts a logo, reopens saved branding, generates through the independent worker, downloads actual binary files, schedules PNG, and checks desktop/mobile accessibility and overflow.

PDF text extraction and raster inspection confirm the actual sample file contains brand text, exact metric values and full chart groups. PDF and PNG images are visually inspected during local verification. Final evidence and numbered status updates are recorded in the architecture progress document; no production deployment or main merge is implied.
