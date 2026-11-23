# Independent development environment — review item 13

Item 13 is the combined independent **development** environment acceptance, not phase 13 of the 375-point product roadmap or Word section 13's worker. Word sections 17–18 require environment separation and combined verification. Production infrastructure and live cross-product connections are not required to continue development.

## Persistent local setup

Use Node 22, the locked dependencies, and Docker Compose v2:

```sh
npm ci
npm run dev:setup
npm run dev:serve
```

`dev:setup` uses the dedicated `averidi-dashboard-development` Compose project. Its PostgreSQL 17 database is `dashboard_dev`, with its own volume and an automatically assigned loopback port. This does not reuse the older default Compose project or its port 5434 database. The ordinary `docker compose up` default remains compatible with port 5434.

The setup creates private ignored `.local/development/` configuration and storage. Its provisioning state retains generated credentials across repeated setup. Migrations use the owner only during setup. The application/worker configuration contains the restricted `dashboard_development_runtime` credential, a separate session secret and connector encryption key. Both files are mode 0600; directories are 0700. No `.env.local` is overwritten. If provisioning state is lost while its volume survives, restore the original credentials; the setup does not reset an existing role's password or delete data to force success.

Setup validates PostgreSQL 17, deploys the Dashboard migrations, rejects an elevated runtime role, applies restricted table grants, checks the database and probes private storage. A failure returns nonzero. An existing native PostgreSQL 17 installation is also supported: create a dedicated `dashboard_dev` database owned by `dashboard`, and supply its owner URL only to setup:

```sh
# Set DASHBOARD_MIGRATION_DATABASE_URL securely to the dedicated loopback owner URL.
# Required shape: postgresql://dashboard:<password>@127.0.0.1:<port>/dashboard_dev?schema=public
npm run dev:setup -- --existing-development-database
npm run dev:serve
```

Choose one provisioning mode for a development configuration. Native mode does not create, stop or delete the caller's PostgreSQL server. Remote hosts, other database names, runtime-as-owner credentials and foreign schemas are rejected.

`dev:serve` starts the Next.js development application and a separate worker. Inherited Dashboard settings and generic database/Compose overrides are cleared; the generated runtime settings take precedence. An empty migration-owner setting prevents Next.js from importing an owner credential from a developer's `.env.local`. Cross-product connections, live billing and business connectors remain disabled. The default release mode is OFF, and HTTP binds only to `127.0.0.1:3000`. Health endpoints remain available:

```sh
curl --fail http://127.0.0.1:3000/dashboard/app/api/health
curl --fail http://127.0.0.1:3000/dashboard/app/api/health/ready
```

Readiness checks the database, configured storage and a fresh capable worker heartbeat. The storage write/read check is performed by setup and acceptance; readiness alone is not a storage write test. Process output and structured worker events go to the terminal. Ctrl+C terminates both process groups; if either process exits unexpectedly, the supervisor stops the other and returns failure. Data is preserved.

To stop only the dedicated Compose database, preserving its volume:

```sh
docker compose --project-name averidi-dashboard-development \
  --env-file .local/development/compose.env -f compose.yaml down
```

## Optional local browser identity

The existing Dashboard-only Keycloak/Caddy fixture remains available:

```sh
npm run dev:identity:up
npm run dev:identity:configure
npm run dev:serve -- --identity
```

The explicit `--identity` option loads only the approved local fixture settings and CA, and enables GENERAL only in these local processes. It does not modify a release configuration file or deployed service. Open `https://localhost:8443/dashboard/app`; configure the browser to trust that specific development CA as described in `authentication-development.md`. The fixture login is `dashboard-developer` / `dashboard-local-only`; authentication does not automatically grant a workspace or subscription.

The Docker TLS proxy uses `host.docker.internal:3000`, so this explicit fixture mode binds the internal HTTP application to `0.0.0.0:3000`. Use a private local development machine and keep forwarded ports private. Default mode stays loopback-only. Never disable TLS verification globally. The hosted fixture is an optional developer convenience; automated browser acceptance uses a dedicated HTTPS OIDC protocol fixture and real Chromium.

## Combined acceptance

Install PostgreSQL 17 client tools (`pg_dump`, `pg_restore`, `createdb`, `dropdb`), OpenSSL and the locked Playwright Chromium/native dependencies. `DASHBOARD_PG_BIN` may select the client directory; `DASHBOARD_BROWSER_EXECUTABLE` may select an installed Chromium.

```sh
npx playwright install --with-deps chromium
npm run verify:development-infrastructure
```

The default acceptance command creates a unique disposable Compose project and `dashboard_test` database, chooses a random loopback port, creates a separate restricted role, and invokes **all 21 stages** of `verify:complete`. It clears inherited product destinations and uses private temporary test storage. It removes only its generated Compose project/volumes on completion or failure. The persistent development database is not used or deleted. Cleanup failure is an acceptance failure.

An already isolated native test database can be used explicitly:

```sh
# Supply the separate owner/runtime URLs for loopback dashboard_test only.
# The runtime username must match dashboard_*runtime; both URLs must target the same public schema.
npm run verify:development-infrastructure -- --existing-test-database
```

This mode does not provision or delete the supplied server/database. It performs the same migrations, restricted-role tests, real recovery, clean build and browser workflows. Use only a disposable dedicated test database. Every run writes `.local/development-acceptance/<run>/summary.json` and references its `.local/verification/<run>/` stage logs, test results and source fingerprint. Failed stages remain failures; local results never imply hosted success.

The BI browser stage runs the production build, private storage, restricted database and separate worker together. It checks live readiness and the worker health CLI, exercises the upload-to-dashboard workflow, then verifies readiness changes from 200 to 503 after worker shutdown and returns to 200 after restart. Authentication is independently exercised through actual HTTPS browser sign-in. The gate also covers storage recovery, subscriptions/administration, inactive future contracts and isolation.

See `item13-development-environment-acceptance.md` for executed results and explicit execution limitations. Staging and production require their own future resources, credentials and authorization; this setup never connects them.

## Browser preview inside GitHub Codespaces

The localhost identity option does not work unchanged through GitHub's forwarded browser URLs. On a standard development Codespace, after `dev:setup`, stop any running `dev:serve` and run:

```sh
npm run dev:codespaces:setup
npm run dev:serve -- --codespaces
```

In the Ports panel, forward ports **3000** and **8081** with **Private** visibility and HTTP as the internal protocol (the external GitHub URLs use HTTPS). Stay signed into GitHub as the Codespace owner. Open the login URL printed by setup and use the generated `dashboard-developer` password printed only in the terminal. Do not share the generated credentials. After normal provider login, select **Dashboard development preview** to open Studio. Upload a CSV/JSON/Excel dataset to exercise the workflow; `docs/examples/preview-orders.csv` is a small fixture you can download from the editor and upload through the browser.

The helper requires `CODESPACES=true`, a valid Codespace name, `app.github.dev` forwarding and a non-production environment. It creates a separate `averidi-dashboard-codespaces-identity` Docker project using the existing Keycloak/Caddy versions, its own volumes and a generated realm under private `.local/identity-codespaces/`. The realm callback and web origin match this Codespace's HTTPS port-3000 address. A stable generated developer subject owns only a uniquely named preview workspace. Its local STARTER fixture subscription is renewed for 30 days when setup runs; no live billing operation occurs. Existing workspaces/datasets are not reset.

GitHub's private forwarder protects browser requests but cannot supply a signed-in browser session to server-side OIDC requests. The explicit Codespaces launcher therefore preloads a development-only transport mapping for exactly the configured issuer's token, signing-key and discovery paths, through Caddy at `https://localhost:9443` with its generated CA. The provider's public issuer, normal credentials, PKCE, nonce, token signature, audience and session verification remain unchanged. This is local backend routing, not an authentication bypass. Unrelated endpoints are not rewritten. Production/non-Codespaces use and foreign issuer paths are rejected. TLS certificate validation remains enabled.

Next.js development assets allow only this Codespace's exact forwarded port-3000 hostname, with no wildcard or production allowance.

The launcher enables BETA only for this generated preview workspace, keeps the web application on loopback and leaves billing, business connectors and cross-product connections inactive. Without `--codespaces`, the default development release remains OFF.

Stop the web/worker with Ctrl+C. To stop only this identity fixture while preserving its data, run from the Codespace:

```sh
DASHBOARD_DEV_IDENTITY_ORIGIN="https://${CODESPACE_NAME}-8081.app.github.dev" \
DASHBOARD_DEV_REALM_FILE="$PWD/.local/identity-codespaces/realm.json" \
  docker compose --project-name averidi-dashboard-codespaces-identity \
  -f infrastructure/development/codespaces/compose.yaml down
```

The local test suite covers origin/production rejection, exact transport mapping and actual trusted HTTPS token/JWKS transport. Docker-hosted Keycloak and GitHub forwarding must also be observed in the user's Codespace; passing native tests do not establish that external execution result.
