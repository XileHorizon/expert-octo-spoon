# Ship Print eSell — Human Deployment Handbook

This is the operator runbook for deploying the application yourself. Do not begin production deployment until Section 1 is complete.

## Current position

The application itself passes its local production build and complete MySQL/HTTP/email test workflow. The production host is **not selected or qualified yet**.

Do not assume that a GoDaddy account can run this application. GoDaddy's current standard Web Hosting (cPanel) documentation lists MySQL 5.6/5.7 and does not list Node.js as a supported component. Current cPanel Application Manager documentation lists Node.js packages only through Node 22. This project currently requires Node 24 and MySQL 8.

## 1. Qualify the customer's hosting before launch day

Ask the customer for the exact product/plan name and a screenshot of its hosting dashboard. Do not ask them to send passwords. Have them invite you as a delegated administrator or sit with them while they sign in.

The plan must provide all of the following:

- [ ] Linux hosting capable of running a persistent Node.js application.
- [ ] Node.js 24.x, or approval to change and retest this project for an available supported version.
- [ ] MySQL 8.0 or 8.4. MySQL 5.6/5.7 and MariaDB are not currently qualified.
- [ ] A way to define private environment variables/secrets.
- [ ] A build step (`npm ci` and `npm run build`) and a persistent start command (`npm start`).
- [ ] The assigned port is supplied through `PORT` and routed to the public domain.
- [ ] HTTPS with a valid certificate.
- [ ] Sufficient request-body and timeout limits for the agreed artwork uploads.
- [ ] Outbound SMTP or HTTPS access for email delivery.
- [ ] Database backup/export and restore capability.
- [ ] Application logs and a restart control.
- [ ] A scheduler for maintenance and backups, or a separate written operations plan.

If any item is unavailable or support cannot confirm it, stop. Choose a compatible managed Node host or a VPS before changing DNS.

### Hosting evidence to collect

Record these items in the project notes:

- Provider and exact plan name
- Control panel/product name
- Available Node versions
- Database engine and exact version
- Memory, process, request-size, and request-timeout limits
- How applications are restarted
- How secrets are entered
- How logs are viewed
- How backups are created and restored
- Whether custom domains and automatic SSL are supported
- Whether a staging/preview URL is available

### Known GoDaddy paths

**Standard GoDaddy Web Hosting (cPanel):** treat as incompatible until GoDaddy confirms a persistent Node runtime and a supported database version for that exact account. Its published component list does not establish that this app can run there.

**GoDaddy Node.js Hosting (currently beta):** advertises Next.js, GitHub import, secrets, previews, custom domains, logs, and a database UI. Before choosing it, confirm the available Node version, that its database accepts this project's MySQL schema and driver, upload limits, outbound email support, backup/restore, and scheduled maintenance. The repository will also need to satisfy GoDaddy's packaging requirements before import.

**VPS:** supports the app when you can administer Node 24, MySQL 8, HTTPS, a reverse proxy, PM2, firewalling, backups, and updates. Choose this only if you are prepared to own those operational duties or they are covered by a maintenance agreement.

## 2. Decisions and access to obtain from the customer

Use customer-owned accounts wherever practical, consistent with the service agreement.

### Access

- [ ] Delegated access to the hosting account
- [ ] Delegated DNS/domain access
- [ ] Permission to create a database and database user
- [ ] Permission to create/configure the Node application
- [ ] Permission to add a subdomain and SSL certificate
- [ ] Permission to configure the sending email service
- [ ] Customer billing remains on customer-owned accounts

Never collect account passwords in chat or email. Use provider invitations, password-manager sharing, or an in-person masked entry.

### Business decisions

Get written approval for:

- [ ] Final public URL or subdomain
- [ ] Owner portal email address
- [ ] Quote-notification recipient
- [ ] Authorized `From` address
- [ ] SMTP/email provider
- [ ] Per-file and total upload limits
- [ ] Maximum complete email-message size supported by both sender and recipient
- [ ] Final product catalog, pricing, minimums, finishing options, discounts, and manual-quote items
- [ ] Contact details and turnaround copy
- [ ] Who receives uptime and delivery-failure alerts
- [ ] Who owns backups, security updates, monitoring, and future maintenance

### Critical upload/email decision

The current application accepts up to 25 MB per file and 75 MB raw in one request, then sends the originals as MIME email attachments. MIME/base64 encoding increases the message size. Normal mail systems often accept much less than the application's raw cap; Gmail API uploads are commonly limited to about 35 MiB for the complete encoded request, and recipient limits may be lower.

Before launch, test the real sender and recipient with a near-limit message and set `MAX_EMAIL_MESSAGE_BYTES` to the lower proven complete-message limit. If the customer truly needs larger artwork, do not merely raise the number: implement approved secure file storage/download links instead of email attachments.

## 3. Production values you must prepare

Enter these through the hosting provider's secrets/environment-variable UI or a private mode-`0600` environment file. Never put values in Git, deployment commands, screenshots, tickets, or chat.

Required:

- `MYSQL_URL` — least-privilege application user, production database only
- `APP_URL` — exact public HTTPS origin only; no credentials, path, query, or fragment
- `EMAIL_FROM` — provider-authorized sender
- `QUOTE_NOTIFICATION_TO` — shop recipient
- `MAX_EMAIL_MESSAGE_BYTES` — tested complete-message limit
- `SESSION_COOKIE_SECURE=true`
- `FIRST_OWNER_SETUP_SECRET` — at least 32 random characters, used only in the masked `/admin/setup` form and removed after first owner creation
- `RESET_DELIVERY_WORKER_SECRET` — a separate permanent 32+ character secret shared only by the application and scheduled maintenance process

Choose one email path:

- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, and when required `SMTP_USER` and `SMTP_PASS`
- Gmail API: `GMAIL_OAUTH_TOKENS_PATH` to a private persistent token file

Optional policy values:

- `SESSION_TTL_HOURS`
- `PASSWORD_RESET_TTL_MINUTES`
- `PASSWORD_RESET_RESPONSE_FLOOR_MS` — bounded neutral-response floor; defaults to 750 ms and is clamped to 250–5000 ms
- `BACKUP_DIR`
- `BACKUP_RETAIN_DAYS`
- `PORT` only when the host does not assign it automatically

Production must not enable `ENABLE_LOCAL_DEV_INTAKE` or `NEXT_PUBLIC_ENABLE_DEMO_PRICING`.

Do not define `MYSQL_TEST_URL` in production. Verification databases must remain separate from customer data.

## 4. Prepare a release on your computer

From the repository root:

```bash
npm ci
npm run rehearse:deploy
npm run package:godaddy
```

Do not proceed unless every gate passes:

- TypeScript
- ESLint
- 146 Vitest unit/component tests
- 14 MySQL migration/intake integration checks
- 19 MySQL schema/data checks
- 8 operations checks
- 95 complete HTTP/email workflow checks
- 4 Playwright browser checks passing (plus 1 live-admin check skipped unless its disposable-server variables are configured)
- Production build

Then:

- [ ] Confirm `git status` contains only intentional release files.
- [ ] Review the release diff.
- [ ] Commit the release.
- [ ] Push it to the deployment branch.
- [ ] Create a release tag so rollback identifies an exact known-good revision.
- [ ] Record the previous production tag if this is an update.

Never deploy `.env.local`, `.local-data`, `node_modules`, test artifacts, logs, or customer uploads.

For GoDaddy Node.js Hosting, upload only `release-artifacts/ship-print-esell-godaddy-node24.zip`. The ZIP has `package.json` at its root and includes a generated `db/godaddy-import.sql` fallback. GoDaddy's public product page currently advertises Node.js 22; this release declares and requires Node 24. Treat an offered Node 24 runtime as a hard qualification gate.

## 5. Use staging before production

The safest first deployment is a provider preview URL or dedicated staging subdomain.

1. Create a separate staging database and least-privilege staging user.
2. Configure staging secrets with a staging `APP_URL` and a controlled notification recipient.
3. Deploy the exact release commit.
4. Run the schema initializer.
5. Build and start the app.
6. Create a staging owner through the masked terminal prompt.
7. Complete the smoke test in Section 8.
8. Fix problems and repeat the local release gates before producing a new release commit.

Never point staging at the production database.

## 6. Generic managed-host deployment

Use this path only after the provider passes Section 1.

1. Create the production MySQL database and a unique least-privilege application user in the provider UI.
2. Create/import the Node application from the exact release commit. Do not upload `node_modules` or local environment files.
3. Set the build command to `npm run build` when the platform does not detect Next.js automatically.
4. Set the start command to `npm start`.
5. Enter the production environment values from Section 3 in the provider's secrets UI.
6. Apply the database schema through the provider console, release hook, or database import facility, then build the app. When a console is available, run:

```bash
npm ci
npm run db:init
npm run build
```

7. Create the first owner at `/admin/setup` using the owner email, a new password, and the deployment setup secret in masked fields. The route works only while no owner exists and permanently closes after creation. Remove `FIRST_OWNER_SETUP_SECRET` from the provider secrets UI afterward. If a terminal is available, `npm run create-owner -- owner@example.com` remains an alternative masked flow.

8. Start or restart the application from the provider UI.
9. Inspect runtime logs for startup/database/email errors.
10. Attach the staging domain first. Attach the production domain only after staging passes.
11. Confirm the provider has issued a valid HTTPS certificate.

With `FIRST_OWNER_SETUP_SECRET` configured, `/admin/setup` can initialize a **completely empty** MySQL 8 database, apply the rerunnable schema/seeds, and then create the first owner. It refuses unknown or partial databases and never drops data. If runtime DDL is blocked or initialization is interrupted, import the ZIP's `db/godaddy-import.sql` once through GoDaddy's Database SQL/import UI into a new empty database, then return to `/admin/setup`. MySQL DDL auto-commits, so never retry against a partial database by deleting or overwriting tables without an operator review.

## 7. VPS deployment path

Use a VPS only when the customer has approved the operational responsibility.

Before using the included `scripts/deploy.sh`, provision and verify:

- Node.js 24
- MySQL 8 with a local/private listener
- A non-root deployment/application user
- A firewall allowing only required public ports
- Nginx or Caddy as the HTTPS reverse proxy
- A valid certificate and renewal mechanism
- PM2 and startup persistence
- Private environment storage
- Backup destination outside the public web root
- Log rotation, security updates, monitoring, and recovery access

The included VPS script is a starting point, not a substitute for server provisioning. Review it before each use. It installs dependencies, applies the schema, builds, and starts/reloads PM2. Reverse proxy, SSL, firewall, MySQL installation, backup restore, and OS hardening are separate responsibilities.

## 8. Production smoke test

Immediately after start/restart:

- [ ] `https://PUBLIC-DOMAIN/api/health` returns HTTP 200 with database and email both `ok`.
- [ ] The public form loads over HTTPS without browser console/network errors.
- [ ] `/admin` redirects to `/admin/login` while signed out.
- [ ] The owner can sign in.
- [ ] Catalog and pricing load from production, not fixtures.
- [ ] Business settings show approved contact information.
- [ ] Submit a small, valid test PDF through the public form.
- [ ] The browser reports success only after provider acceptance.
- [ ] The shop mailbox receives the message and attachment.
- [ ] Reply-To is the test customer's address.
- [ ] The request appears in the owner portal with complete job details.
- [ ] Change the request status and reload to confirm persistence.
- [ ] Request a password-reset email, open the production-domain link, reset, and sign in again.
- [ ] Sign out and confirm the owner page is protected.
- [ ] Test one deliberately invalid file and one below-minimum quantity.
- [ ] Test a near-limit upload using non-sensitive sample artwork.
- [ ] Confirm application and error logs contain no secrets or unexpected stack traces.

If any check fails, do not announce launch. Keep the old site/link in place or roll back.

## 9. DNS and launch

Prefer a subdomain such as the customer-approved quote URL rather than replacing the main website.

- [ ] Lower DNS TTL at least a day before cutover when you control it.
- [ ] Record the old DNS values before changing anything.
- [ ] Add the provider-required DNS record.
- [ ] Wait for the provider to validate the domain and issue SSL.
- [ ] Update `APP_URL` to the final HTTPS URL and restart the app.
- [ ] Repeat the full production smoke test.
- [ ] Link the existing customer website to the new form only after it passes.
- [ ] Monitor logs, health, and mailbox delivery during the initial launch window.

## 10. Backups, maintenance, and monitoring

Before launch:

- [ ] Run one database backup.
- [ ] Restore it into a separate disposable database and verify it.
- [ ] Schedule `scripts/backup.sh` or provider-equivalent backups.
- [ ] Set a separate 32+ character `RESET_DELIVERY_WORKER_SECRET` and schedule `scripts/maintenance.mjs --apply` for expired sessions/reset tokens and durable reset-delivery retries while the application is running.
- [ ] Configure an external HTTPS monitor for `/api/health`.
- [ ] Configure log retention/rotation.
- [ ] Document who receives alerts and who responds.

The application does not retain original artwork after email handoff. Database backups protect metadata, pricing, owner records, and request history—not the original files.

## 11. Rollback

Before every update, retain the previous release tag and a current database backup.

For a code-only rollback:

1. Select the previous known-good release commit/tag.
2. Install that revision's exact dependencies with `npm ci`.
3. Build it with `npm run build`.
4. Restart/redeploy it.
5. Run the health check and smoke test.

Do not automatically reverse database schema changes. Current schema initialization is additive/rerunnable, but future migrations require a release-specific rollback decision. Restore a database only when the failure requires it and only after preserving the failed-state backup for diagnosis.

For DNS rollback, restore the recorded old DNS value and verify the former site before declaring recovery.

## 12. Customer handoff

Provide the customer with:

- Public form URL
- Owner portal URL
- Owner email and a secure password-establishment/reset process
- Hosting, domain, database, and email provider ownership record
- Backup and restore location/procedure
- Monitoring and alert ownership
- Basic owner-portal instructions
- Release tag and repository ownership/access
- Written support/warranty boundaries from the agreement

After acceptance:

- [ ] Remove your temporary access when it is no longer needed.
- [ ] Delete any customer credentials you temporarily held.
- [ ] Confirm the customer can sign in and restart/manage the application or knows who will.
- [ ] Confirm recurring hosting/email charges belong to the customer's account.
- [ ] Record launch date, deployed release tag, and final smoke-test result.

## 13. Your next action

Send the customer a hosting-information request asking for the exact plan name and delegated dashboard access. Once you can see the dashboard, complete Section 1 before selecting the final deployment branch. Do not buy, migrate, or modify DNS until the compatibility gate is answered.