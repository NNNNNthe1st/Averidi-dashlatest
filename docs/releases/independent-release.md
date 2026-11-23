# Independent Dashboard releases

Audit reference 9 adds a Linux/Node 22 build, installation, activation and application rollback path. It uses the existing Next production server, dedicated database/storage checks and separately leased worker. The website, Analyst, production service and routing are unchanged. Nothing here installs a service, connects SSH, provisions infrastructure or deploys automatically.

## Build and artifact trust

Use a committed, reviewed Dashboard checkout. `npm run release:build -- /absolute/output/outside-checkout version` exports only committed application/configuration/dependency-lock/test source into a temporary directory, installs locked dependencies and generates Prisma, checks source isolation and creates a fresh Next build. Runtime/owner credentials, application environment variables, `.env` files and the developer's npm user configuration are excluded. The build uses OFF and a deliberately unreachable build-only database URL. Uncommitted source and an existing output directory are refused.

The resulting directory includes the build, source required by the worker, locked dependencies and `release.json`. Its SHA-256 digest identifies the complete manifest; the manifest records every file's path, byte count, content hash and mode, safe relative links, committed revision, version, platform/architecture, Node major and migration checksums. Verification rejects changed/missing/extra files, unsafe links, secret/environment files, incomplete packages and foreign products. Only Next's local `.next/cache` contents may change; a symlink at that cache path is refused. Builds and hosts must have compatible Linux architecture, libc/OpenSSL and Node 22. This is a self-contained directory artifact, not a Docker image or static export.

The manual `Build independent Dashboard release artifact` GitHub workflow builds the selected committed revision and uploads a tar archive plus archive checksum and manifest digest. Tar preserves relative links and executable permissions. Obtain the digest through a trusted review/CI channel; a checksum supplied alongside an untrusted artifact is not proof of authenticity. Transfer and extract only a reviewed archive as an unprivileged deployment user into a private staging directory, then verify/install it with that trusted manifest digest. This workflow has read-only repository permissions and no deployment credentials or deploy step. Successful hosted execution remains acceptance work, not a claim made from local tests.

## Host preparation

Use a dedicated OS user, a separate Dashboard database with a restricted non-owner runtime role, and a migration owner. Keep private storage independent of release directories. The example runtime and migration JSON files under `infrastructure/releases` are placeholders, not live configuration. Place actual files outside the artifact at `HOST_ROOT/runtime.json` and `HOST_ROOT/migration.json`, owned by the deployment user with mode 0600. `HOST_ROOT` must be that user's real, private 0700 directory. Initialization refuses a nonempty unrelated directory.

```bash
node scripts/dashboard-release.mjs init /absolute/dashboard-host
node scripts/dashboard-release.mjs verify /absolute/staged-artifact TRUSTED_MANIFEST_DIGEST
node scripts/dashboard-release.mjs install /absolute/dashboard-host /absolute/staged-artifact TRUSTED_MANIFEST_DIGEST
node scripts/dashboard-release.mjs serve /absolute/dashboard-host
```

Run the foreground supervisor under a dedicated process manager. `averidi-dashboard.service.example` is a reviewable systemd example only; adapt Node/tool paths, provision the dedicated user/directories and review it before a separately authorized installation. `KillMode=control-group` ensures supervisor and children stop together even after a crash. Node and util-linux `flock` are required. A kernel file lock prevents two supervisors owning the same root. The internal entry point verifies possession of the locked file descriptor.

The control endpoint binds only to loopback and authenticates each bounded request using a random 256-bit capability in a private 0600 `control.json`. It has no public HTTP route, shell execution or SSH support. Only an OS principal allowed to read this private host directory can operate it. The web server also binds only to loopback; independently approved HTTPS ingress remains necessary. Never expose either loopback listener through an unrestricted proxy.

Runtime configuration accepts Dashboard settings only. Generic app variables, Node preload hooks, migration-owner settings and development/test settings are refused. Runtime processes receive no inherited application environment or owner credential. Cross-product bridges/integration remain forced OFF. Customer release defaults to OFF; a healthy process is not customer authorization. Config changes require a supervisor restart. Existing authentication, billing, connector, release and tenant policies still apply.

## Activation, rollback and recovery

```bash
node scripts/dashboard-release.mjs status /absolute/dashboard-host
node scripts/dashboard-release.mjs activate /absolute/dashboard-host NEW_DIGEST
node scripts/dashboard-release.mjs rollback /absolute/dashboard-host
```

The supervisor serializes operations and rejects stale expected state. It verifies the installed artifact before executing it, stops/drains its old worker and web process, checks the dedicated runtime role/database/private storage, starts a new worker and waits for that worker's first committed heartbeat, starts Next, and requires two real readiness successes while both new processes remain alive. State is committed only after readiness succeeds, using a flushed temporary file, atomic rename and flushed directory metadata. The previous release is retained. An unhealthy same-schema candidate is stopped and the old release is restarted and checked before returning failure. Promotion has a brief interruption; it is not a zero-downtime or multi-host orchestrator. Worker abort/lease recovery reuses the existing queue behavior.

Application rollback requires identical migration histories. Database downgrades are never executed. Review stored-data and queued-job compatibility before approving a rollback; matching migration history is a necessary guard and does not prove semantic compatibility. A release with a new migration chain requires the explicit command below and separate private migration-owner configuration:

```bash
node scripts/dashboard-release.mjs activate /absolute/dashboard-host NEW_DIGEST --migrate
```

The migration preflight verifies a matching dedicated database/schema, distinct non-elevated runtime role and unchanged applied migration checksums/prefix. Before any migration write, durably flushed state enters maintenance and clears rollback. The existing forward-only migration/grant commands then run; the owner credential is passed only to these short-lived commands, never to the web process or worker. Failure or interruption after this fence keeps the application stopped. Install a corrected candidate containing the same applied history and retry `activate … --migrate`. Do not force an old application against uncertain/new schema or remove ledger rows to bypass the fence. Make and verify the existing database/storage backups before an authorized real migration; the release tool does not silently create a customer-data copy or assume a backup exists.

Unexpected process loss stops the remaining owned process and exposes degraded status. An operator can reactivate the same verified release or roll back to a same-schema previous release. On supervisor restart, the last committed release is verified and restarted; a migration-maintenance fence prevents automatic boot. Structured `events.jsonl` records lifecycle events and safe error codes without command output, runtime settings or secrets. Keep old artifacts needed for rollback; this implementation never prunes customer data, storage or releases automatically.

## Local verification and scope

`npm run test:releases` verifies integrity, secret/link boundaries, private host installation, environment isolation and the actual exclusive-lock/authenticated-control behavior. `npm run verify:releases` requires Node 22, a committed source tree, the disposable loopback `dashboard_test` database and separate runtime/migration roles. It refuses development/customer database URLs before fixture work, runs unit/type checks and builds a real committed artifact in a clean context. Native lifecycle acceptance relocates that build and tests the real Next process and worker: activation, OFF preservation, promotion/rollback, unhealthy-candidate recovery, stale operations, migration fencing, forward repair, maintenance-fenced restart, healthy restart and retained database/storage fixtures. The only extra acceptance migration executes `SELECT 1`; its fixture receipt is removed after fixture processes stop, exclusively in the guarded disposable database.

Actual host/service/HTTPS provisioning, deployed monitoring (220), hosted CI and full final acceptance (228–230) remain separate. This infrastructure does not enable billing, data-provider connections, production release or any external Averidi integration.
