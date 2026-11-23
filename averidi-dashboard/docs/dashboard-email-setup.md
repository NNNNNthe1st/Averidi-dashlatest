# Dashboard account email setup (independent app)

Dashboard registration, verification resend and password recovery use Dashboard-local settings and send transactional mail through Resend. The same Resend account, verified averidi.com domain and authorized sender used by the website can be configured explicitly for Dashboard. Dashboard does not read the website environment or connect to its application or database.

## Required runtime configuration

Set these as private environment variables in the **Dashboard process only** (not in Git, and not in the website process):

- `DASHBOARD_EMAIL_API_KEY`: a Resend API key authorized to send using the verified Dashboard sender domain.
- `DASHBOARD_EMAIL_FROM`: sender mailbox on that verified domain, e.g. `Averidi Dashboard <accounts@YOUR_VERIFIED_DOMAIN>`.
- `DASHBOARD_PUBLIC_URL`: HTTPS origin actually serving Dashboard (no `/dashboard/app` suffix), e.g. `https://YOUR_DASHBOARD_HOST`.
- `DASHBOARD_PUBLIC_ORIGIN`: **same origin** as `DASHBOARD_PUBLIC_URL`.
- `DASHBOARD_SESSION_SECRET`: existing Dashboard-only session secret, at least 32 bytes.
- `DASHBOARD_DATABASE_URL`: existing independent Dashboard PostgreSQL database.

Before sending live email, verify the chosen sender domain with Resend and publish the DNS verification records it supplies. Do not invent records; obtain actual values from the mail provider and domain's DNS console. The existing verified averidi.com domain may be reused with an authorized API key and sender.

## Route behavior

- Trial CTA: `/dashboard/app/signup`, rendered by `src/app/signup/page.tsx`.
- Signup: `POST /dashboard/app/api/auth/signup`.
- Email verification: `/dashboard/app/verify?token=...`; the browser submits to `POST /dashboard/app/api/auth/verify`.
- Expired verification: `POST /dashboard/app/api/auth/resend-verification`.
- Login: `/dashboard/app/login`.
- Recovery: `/dashboard/app/forgot-password`; token links go to `/dashboard/app/reset-password?token=...`.

For JSX `next/link` hrefs use paths relative to the configured Next.js basePath (`/signup`, `/login`); for native browser navigation and fetch use the external path including `/dashboard/app`.

## Deployment boundary

This repository's application declares `basePath: '/dashboard/app'`. The origin serving that path must forward requests to the independent Dashboard process; publishing or changing website proxy routes requires separate approval. Do not deploy or modify the main website as part of this configuration.

Do not mark email delivery complete until the Dashboard deployment has actual secrets, DNS is verified, migrations are applied, and an owner-operated registration and recovery email has been received. Never expose keys in logs or commit them.

## Codespaces and local development

Add a Codespaces secret named `DASHBOARD_EMAIL_API_KEY` containing the authorized Resend key. Restart the Codespace so the secret is available. Do not paste the key into chat or commit it. On `feature/independent-dashboard`, run:

```sh
npm run dev:email:configure
npm run dev:serve -- --codespaces
```

The configure command defaults to `Averidi <support@averidi.com>` and detects this Codespace's HTTPS port 3000 origin. Optional `DASHBOARD_EMAIL_FROM` and `DASHBOARD_PUBLIC_URL` environment variables override those defaults. Outside Codespaces the URL defaults to `https://localhost:8443`; use `npm run dev:serve -- --identity` with the existing local TLS fixture.

Configuration is saved only in ignored `.local/development/email.json` with mode 600. The launcher reads only the three approved email values after selecting its identity mode and requires the email URL to match that mode's public origin. Other inherited Dashboard variables remain filtered. Web and worker receive the same validated runtime settings. Missing email.json leaves existing development behavior unchanged; malformed or insecure files stop startup. Reconfigure after changing Codespaces.

Run `npm run test:development-email` for configuration checks. This does not send mail. Confirm signup verification and password recovery from the running Dashboard before marking delivery complete.

## Test the complete account and trial flow

Use `npm run dev:accounts` after configuring development email. This uses the same independent development database and Codespaces URL, but selects GENERAL **only for the local development child processes**. `dev:serve -- --codespaces` and `dev:accounts` both run standalone account development, without identity fixtures. Neither command changes production release configuration. Customer OIDC/Keycloak setup and certificates are not required.

Test signup, receive verification, verify, sign in, create a business, and open its studio. The trial starts at the account's creation timestamp and ends one calendar month later; creating more workspaces does not restart it. Email and data remain independent of the website.
