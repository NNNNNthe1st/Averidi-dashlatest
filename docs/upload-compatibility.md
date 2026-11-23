# Upload compatibility and acceptance

Allowed extensions are .csv, .json and unencrypted .xlsx (case-insensitive). Defaults: 25 MiB per file, 50,000 non-empty data rows and 100 columns. The server file-size setting and Next proxy body limit use the same shared function, plus 64 KiB for multipart framing.

CSV accepts UTF-8, UTF-8 BOM, and BOM-marked UTF-16 LE/BE. Comma, semicolon and tab separators are detected from the header record outside quoted values. CRLF, LF and CR line endings and quoted multiline values are supported. Invalid text encodings, malformed quoting, extra unnamed columns and empty data are rejected with a specific reason. Duplicate column headings are renamed without overwriting already-named columns.

JSON accepts an array of flat row objects or an object containing a non-empty rows array. BOM-marked text is decoded before JSON parsing.

XLSX supports selected data worksheets, Unicode and rich-text cell values, dates and cached formula results. The service does not calculate Excel formulas. Multiple data sheets return a structured list for the Studio picker. Exact worksheet names, including surrounding spaces, survive upload and queued profiling. Encrypted, unreadable, oversized and over-budget archives are rejected; decompression guards remain active.

The file input keeps its selection on a failed request. A new file clears the prior sheet choice and preview. Failed replacements preserve the last verified version. Trial, membership, custom permissions and quotas continue to gate requests.

## Validation

- Node 22, Next.js 16.4.1 with Turbopack: real HTTP previews and version uploads, storage, queued profiling and activation for CSV, JSON array, JSON rows wrapper, UTF-16 CSV, semicolon CSV, BOM JSON, single-sheet XLSX, selected multi-sheet XLSX and an 11 MiB CSV.
- Real HTTP chunked multipart preview and upload without Content-Length; append, complete-snapshot synchronization, rejected replacement preservation, expired and suspended trial denial, and cross-workspace denial.
- Parser/multipart regression coverage, plus existing phase-4 database tests for activation, source ownership, first-import failure and replacement failure.
- The local HTTP audit used isolated PostgreSQL-compatible PGlite with all 36 repository migrations and private local storage. Native PostgreSQL concurrency/load behavior and external object-storage providers were not load-tested by this audit.

Run npm run test:upload-compatibility for parser and request-boundary checks. Run npm run test:upload-http against a dedicated, migrated *_test PostgreSQL database for the HTTP-to-worker acceptance test. It creates and removes its own fixture users/workspaces and private temporary storage, starts a Next development server on loopback port 55440, and never sends email. Do not point it at development/customer data or production.
