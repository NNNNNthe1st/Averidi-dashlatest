# Quality review and dataset relationships

Audit references 67–70 extend the existing Dashboard-owned profiling, validation, transformation, versioning and worker pipeline. The existing calculation engine and source uploads remain in use.

## Quality review (67)

On Data management, select a dataset and run validation. Refresh results when the queued job completes. The latest 20 checks are shown, with up to 100 issues per check. Historical findings remain attached to the source version that produced them.

Editors with dataset write permission can acknowledge a finding, reopen its review, or mark it verified fixed. A note is required. Acknowledgement does not change a failed validation result or enable metrics. Verification requires a different corrected current dataset version with a passing DATASET_VALIDATION check bound to its exact checksum and current semantic confirmation revision. Business-rule findings require a governed check after confirming the current field meanings and business rules; a structural-only check cannot close them. Old checks without this binding must be rerun. The original failed check and issue remain stored; the issue records the review, verification check and resolution time. Every decision is audited, and stale issue revisions are refused.

Existing ordered transformations now also offer explicit exact-row deduplication, filling empty fields with reviewed text, and replacing an exact text value. The worker schema supports typed scalar replacement values for API callers. No values are guessed or automatically imputed. Transformations create a new immutable source version and reprofile it; field meanings and business calculation rules must be confirmed again. Retained source versions remain subject to the existing retention policy.

## Relationship suggestions (68)

Open Relationships and choose two ready datasets. Suggest relationships compares matching field names and exact typed key overlap across the current versions. Each candidate reports matching and distinct key counts, missing keys and measured cardinality. At most 20 candidates are returned. Suggestions are advisory and never create or activate a relationship automatically. A similarly named field with shared values is evidence to review, not proof of business meaning. Fields with different names can be mapped manually.

## Authoring (69)

Create or edit a named relationship with one to three field pairs, explicit cardinality and join type. Preview the output counts and review the business meaning before saving. One-to-one, many-to-one, one-to-many and many-to-many are supported. Cardinality is checked against the entire bounded source, not a preview sample; a claimed unique side with duplicate keys is refused.

Definitions reuse DashboardBusinessEntity and DashboardDataRelationship. Each definition binds the source dataset IDs, active version IDs and checksums, and stores its field mappings and join type. An additive migration adds an updatedAt revision to the existing relationship model. Existing legacy definitions are preserved and require explicit review before execution. Edits and deletion require the reviewed revision; workspace locking serializes concurrent authoring. Up to 100 definitions are supported, and the screen displays up to 100 ready datasets. Authoring, deletion and execution create audit events.

After either source version changes, edit, preview and reconfirm the definition. Enqueue/schedule dispatch and worker publication reject stale or deleted relationships and mismatched source versions. Deleting a definition leaves already materialized datasets intact.

## Join execution (70)

Create dataset from a saved relationship queues DATASET_JOIN, the thirteenth implemented worker capability. Restart the development worker after applying this revision so readiness advertises the complete current capability set.

The engine implements INNER, LEFT, RIGHT and FULL equijoins using exact typed composite keys. Empty/null keys never match; strings are not trimmed or numerically coerced, so `001` differs from `1` and numeric 1 differs from text `1`. All left/right fields receive left_ / right_ prefixes. Many-to-many expansion is explicit in the selected cardinality and preview; the engine never silently drops duplicate keys or selects an arbitrary match.

Output is bounded to 50,000 rows, 100 combined fields, field names at most 120 characters and the configured upload file-size limit. Oversized or empty output is refused. No preview or join silently truncates a result. Cancellation and lease checks precede publication. Worker-effect receipts and immutable artifact writes provide replay safety; request UUIDs provide enqueue idempotency. The join result, source bindings, relationship revision and row/match counts are retained as version lineage.

Execution creates a separate dataset and JSON version, then queues the existing profiling handler. It does not overwrite either source dataset or reuse their metric confirmations. The new dataset appears in Studio for customer confirmation and normal governed analysis/dashboard generation. Dataset/relationship/source version locks and a final revision check prevent stale publication if a source or definition changes during execution. Physical source retention follows the existing lifecycle policy; lineage does not imply indefinite retention or a live automatic cross-dataset view.

## Authorization and verification

Readers need current workspace membership, datasets.read and an active subscription. Mutations additionally require Editor/Owner and datasets.write; existing Owner/Editor/Viewer ceilings remain authoritative. HTTP writes require the same origin and bounded strict JSON. Generic job submission also requires its existing jobs.manage capability and the underlying datasets.write permission. No cross-workspace, website or Analyst source is accepted.

Run `npm run test:data-model` for focused PostgreSQL tests or `npm run verify:data-model` for the production-build and actual HTTPS browser gate. The gate requires Node 22 and a disposable loopback dashboard_test database with separate migration and restricted runtime roles; it refuses other databases before access. Apply the additive migration through the existing protected development setup. No new dependency, external provider account or deployment activation is needed.
