# Independent operational monitoring (comparison audit 220)

The monitoring runner is independent of the web/worker processes. It checks the existing application without changing customer business logic, authorization, job execution or billing. It is inactive until an operator installs a timer and supplies environment-specific private configuration. **Local implementation does not establish deployed monitoring.**

`npm run monitor:once` performs eight probes concurrently, each with a deadline:

| Signal | Actual check | Default |
|---|---|---|
| application | Normally verified HTTPS readiness, HTTP success, correct product and all four checks true; redirects rejected, response limited to 32 KiB | 10-second deadline |
| storage | Existing independent storage write/read/immutable-overwrite rejection/temporary cleanup probe | 20-second child-process deadline |
| database | Existing dedicated database, schema and migration identity/checksum validation | 20-second child-process deadline |
| worker | Fresh compatible standalone worker heartbeat, including erasure capability when configured | Existing 30-second heartbeat requirement |
| failedJobs | Terminal failures with a finished time in the selected window | At least one within 15 minutes |
| queueDelay | Queued job whose available time is older than the delay threshold | Five minutes; future scheduled jobs excluded |
| expiredLeases | RUNNING jobs with an expired lease | At least one |
| operationalErrors | ERROR/CRITICAL operational events in the selected window | At least one within 15 minutes |

Database signal queries use database UTC time, a five-second statement timeout and the restricted Dashboard runtime principal. They export only healthy/unhealthy results. Payloads, workspace/user identifiers, source data, raw exception messages, tokens and connection URLs are excluded from monitoring output. Operational-event monitoring covers events actually written to that model; it does not invent an application-wide error/latency instrumentation system. Terminal failed jobs cover existing processing failures independently.

Two consecutive unhealthy samples create one grouped incident delivery. Two healthy samples resolve it. Sustained failures repeat after 30 minutes; all thresholds are explicit reliability settings in the example environment. Recovery checks do not change or repair customer state. A nonzero exit reports any unhealthy sample, delivery failure or runner failure, including the first sample before the notification threshold.

## Delivery and durable state

The operator chooses an HTTPS JSON alert sink and optional bearer credential. Neither the runner nor this change creates or contacts a real sink. Delivery rejects redirects, has a ten-second timeout and accepts only HTTP 2xx. Response bodies are discarded. Alert JSON contains product, event ID, time and fixed signal/status codes only. It deliberately omits source/customer details.

The private state directory must already exist with mode 0700, at an absolute normalized path without symlinks. State/lock files use 0600 and reject symlinks, unexpected hard links, oversized/corrupt state or broad permissions. State writes use a new file, fsync, atomic rename and directory fsync. An exclusive lock refuses simultaneous invocations. Supply a dedicated directory outside source, ordinary application storage and backups; retain it across releases.

An incident is persisted **before** delivery. A failed delivery remains pending across restarts with the same `Idempotency-Key`. The receiver must deduplicate that key. A crash after receiver acceptance but before local acknowledgment may resend the same event; delivery is at least once, never claimed exactly once. Pending delivery is retried before advancing incident state. If a service recovers during an outage of the sink, it may first receive the pending failure and then a resolution after two subsequent healthy samples.

An abrupt kill can leave `monitor.lock` intentionally blocking future invocations. To recover, stop the timer/service, verify no monitor process is running, inspect the service journal, then remove only that lock and restart. Do not discard `state.json` to suppress an incident. A separate dead-man check must alert if the monitor stops reporting. A timer on the same host cannot detect loss of that host by itself.

## Installation review

Review the examples in `infrastructure/monitoring/`; no installer is automatically run. Use Node 22 and the matching checked-out release/dependencies. The environment file must be private and the runtime principal non-elevated. Never put migration/owner or another product's credentials in it. For local storage, use the storage owner's OS identity so its existing 0700 protection remains intact. For object storage, use independent Dashboard credentials and supply the standard endpoint/bucket/region/key environment values. Do not broaden storage permissions to make a probe pass.

The service example uses the existing release account `dashboard`, `StateDirectory`, a one-minute timer and a 90-second whole-run deadline. Set actual working directory, executable path, environment-file location and exact writable storage path before installation. Carry relevant existing storage, database and erasure-capability configuration into the monitor environment; do not copy unrelated customer/provider secrets. The probe process reads the tested release's schema/migration files. A mismatched release/monitor version is unhealthy.

Production acceptance still requires: provisioned/installed timer; verified real sink delivery and resolution; deliberate worker stop/recovery and unavailable-storage/DB tests in staging; a separate off-host availability/dead-man monitor; network/storage capacity and latency monitoring; documented on-call ownership/escalation; and evidence that alerts reach that owner. These require the real environment and destination. They are not satisfied by templates or local fixture delivery. This task does not authorize production access or external communications.

## Verification

`npm run test:operational-monitoring` uses only a disposable loopback `dashboard_test` database with separate runtime/migration roles through the repository's normal verification setup. The suite covers actual restricted-role database signals, real HTTPS sink failure/retry/success/redirect rejection, consistent event identity, threshold/recovery/reminder behavior, malformed readiness, bounded child termination, private persistent state and symlink/concurrency/corruption rejection. The complete gate discovers this test automatically.
