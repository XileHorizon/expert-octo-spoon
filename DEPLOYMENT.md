# Production deployment technical reference

Start with [DEPLOYMENT-HANDBOOK.md](DEPLOYMENT-HANDBOOK.md). It is the qualification-first, human-run procedure for selecting hosting, collecting access, staging, launch, rollback, and customer handoff.

Requirements: Node.js **24**, MySQL **8**, HTTPS, and Resend HTTPS, SMTP, or a qualified Gmail API token path. Resend is the preferred filesystem-free Airo/GoDaddy transport because Airo blocks outbound SMTP. Gmail API is supported only when the exact plan provides a private persistent writable token path that survives builds and restarts. **Do not assume ordinary GoDaddy cPanel satisfies these requirements:** qualify the customer's exact plan before following any provider-specific steps below.

## GoDaddy Node.js Hosting ZIP upload

GoDaddy's current Node.js Hosting FAQ requires a top-level `package.json` with non-empty `name`, `version`, and `main`; `build` and `start` scripts; use of `process.env.PORT`; runtime/build packages in `dependencies`; and no uploaded `node_modules`. This project meets those package-shape requirements. `next start` reads the assigned `PORT` automatically.

GoDaddy's current product page says its apps run on **Node.js 22**, while this release and Next.js version are qualified for **Node.js 24**. The package therefore declares `engines.node=24.x`. Stop if the preview build does not offer Node 24; do not override the engine or downgrade the runtime without a separate compatibility change and full release retest.

### Prepare and upload

1. On the release workstation, run `npm ci`, the release gates, and then `npm run package:godaddy`. For a distinct tester artifact, run `npm run package:godaddy -- ship-print-esell-tester.zip` instead.
2. Upload the exact newly generated ZIP from `release-artifacts/` through **GoDaddy Node.js Hosting → Upload zip**. Do not add a wrapper directory; `package.json` is already at the ZIP root.
3. Select the private preview. GoDaddy should install dependencies, run `npm run build`, and start with `npm start`; inspect build and runtime logs. Do not publish yet.

### Environment and database

In GoDaddy's encrypted secrets/environment UI, configure exactly one database form: `MYSQL_URL`, or all of `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` (`DB_PORT` defaults to `3306`). `MYSQL_URL` takes precedence when present so existing local development remains compatible. Partial `DB_*` configuration is rejected without echoing values. Also configure `APP_URL`, `QUOTE_NOTIFICATION_FROM`, `CUSTOMER_CONFIRMATION_FROM`, `QUOTE_NOTIFICATION_TO`, `MAX_EMAIL_MESSAGE_BYTES`, `SESSION_COOKIE_SECURE=true`, a mail-provider configuration, the one-time `FIRST_OWNER_SETUP_SECRET`, and the separate `RESET_DELIVERY_WORKER_SECRET`. Existing deployments may retain `EMAIL_FROM` as the fallback for either new sender variable that is absent. Set `DATABASE_SSL=true` only if the database provider requires TLS.

For Airo, configure `RESEND_API_KEY` and `MAX_EMAIL_MESSAGE_BYTES=40000000`. Resend HTTPS takes precedence whenever its API key is present, even if stale SMTP or Gmail settings remain. Production sending requires every configured From domain or subdomain and sender to be verified/authorized in Resend. The shop notification uses the customer as Reply-To; the customer confirmation uses its customer-facing sender as Reply-To. Both HTML messages embed `src/app/assets/ship-print-email-logo.png` as an inline Content-ID image so Outlook does not need to render an SVG or data URI. Resend's Free tier currently allows 3,000 emails/month and 100/day; each successful quote normally uses two messages, so plan for roughly 50 quote requests/day before password-reset traffic. The 40,000,000-byte setting is an encoded-message ceiling, not a raw upload allowance: the existing estimator lowers the customer-visible and server raw cap automatically. Use a lower value if the recipient mailbox requires it.

GoDaddy supplies the runtime `PORT`; do not override it. The start command supplies `NODE_ENV=production`. GoDaddy does **not** automatically invent this application's database, owner-setup, mail, reset-worker, or base-URL variables. Do not upload an `.env` file and do not define `MYSQL_TEST_URL`, `ENABLE_LOCAL_DEV_INTAKE`, or `NEXT_PUBLIC_ENABLE_DEMO_PRICING` in production. No session-signing or application-encryption secret is required: session tokens are random, stored only as SHA-256 hashes in MySQL, and artwork is not persisted after mail handoff.

GoDaddy Preview and Published use the same configured database. Treat Preview as a non-destructive release check, not an isolated staging environment: never reset, truncate, drop, re-import over, or blindly reseed that database. Use the preview HTTPS origin for `APP_URL` only while exercising password-reset links in Preview, then change it to the final origin and restart before publish.

Create a dedicated managed MySQL 8 database and least-privilege application user in GoDaddy's **Database** UI. Then use exactly one of these paths:

- **Preferred no-terminal first run:** leave the selected database completely empty. Open `/admin/setup`, enter the 32+ character setup secret only in its masked field, and create the owner. After the secret is validated, the app takes a database advisory lock, rechecks that the database has no tables, applies the schema, migrations, and rerunnable catalog seeds, verifies the expected table set, and only then creates the first owner. It refuses unknown or partial databases and never drops tables or overwrites owner-entered prices.
- **Database import fallback:** `db/godaddy-import.sql` is generated reproducibly inside the release ZIP by `npm run package:godaddy`; it is intentionally not a tracked checkout file. In GoDaddy **Database → SQL/import**, import it once into a completely empty MySQL 8 database, then open `/admin/setup`. Use this only when runtime DDL is blocked. Never import it over a populated or partially initialized database; preserve an interrupted database for review and either complete it with an operator-approved migration or select a new empty database.

MySQL DDL auto-commits. If web initialization fails partway through, the database is intentionally left in a refused partial state rather than guessed-at or reset. Preserve it for diagnosis, then use a new empty database or have an operator review and complete the one-step SQL import. After owner creation, remove `FIRST_OWNER_SETUP_SECRET` from GoDaddy's secrets UI and restart; the permanent database marker also keeps setup closed.

### Operations and preview smoke

If GoDaddy supplies scheduled jobs, run `node scripts/maintenance.mjs --apply` every five minutes from the application root with the same private environment as the app. It purges expired authentication records and calls the reset-delivery worker with `RESET_DELIVERY_WORKER_SECRET` in an authorization header, never a URL. Configure GoDaddy's database backup/export separately. If scheduled jobs are unavailable, password-reset delivery recovery and backup automation remain an unresolved operations requirement; do not claim the deployment is production-ready.

Before **Publish Now**, verify the preview: `/api/health` is HTTP 200; public form and catalog load; signed-out `/admin` redirects to login; owner login works; one small non-sensitive PDF submission reaches the shop mailbox and appears in admin; status persists after reload; password reset is delivered; sign-out protects admin; and logs contain no secrets. Also confirm the plan's request-size/time limits with a near-limit non-sensitive sample, outbound SMTP/HTTPS, database export/restore, custom-domain HTTPS, and restart behavior.

## Rehearse locally before touching production

Start the full local environment, then run the same schema, validation, integration, email-handoff, and production-build gates used to judge a release:

```bash
npm run dev:local
# In a second terminal:
npm run rehearse:deploy
```

A successful rehearsal ends with the production build passing after the complete 95-check HTTP workflow. It uses only the disposable database named by `MYSQL_TEST_URL`; the verification scripts refuse a test database whose name does not end in `_test`.

Then manually practice the operator flow at <http://localhost:3000/admin/login>: sign in, edit pricing, submit a quote through the public form, find it in the owner portal, change its status, test password recovery, and sign out. Local credentials belong in ignored private files, never in deployment commands or committed configuration.

This rehearses the application release. The final hosting exercise still requires the cPanel or VPS-specific steps below, including HTTPS, the real mail provider, process restart, backups, and a production health check.

## GoDaddy cPanel: provisional path only

GoDaddy's published standard cPanel component list currently documents MySQL 5.6/5.7 and does not establish Node 24 support. Use this section only if GoDaddy confirms that the customer's exact plan supplies Node 24, MySQL 8, persistent application processes, environment variables, and the required upload limits.

1. In **cPanel → MySQL Databases**, create a database and database user. cPanel normally prefixes both names with the account name.
2. Add the user to the database with **All Privileges**. Do not reuse the cPanel account password.
3. In **cPanel → Setup Node.js App** (or **Application Manager**), create a production app using Node.js 24, point the application root at this project, and use `npm start` as the start command. If Node 24 is not offered, ask GoDaddy to enable it or use a Node-24-capable plan; do not deploy this Next.js 16 app on an older runtime.
4. Copy the project to the application root and run `npm ci` from cPanel Terminal.
5. In the Node app environment-variable UI, set:
   - either `MYSQL_URL=mysql://PREFIX_USER:URL_ENCODED_PASSWORD@localhost:3306/PREFIX_DATABASE`, or `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and optional `DB_PORT`
   - `APP_URL=https://your-domain`
   - `QUOTE_NOTIFICATION_FROM`, `CUSTOMER_CONFIRMATION_FROM`, `QUOTE_NOTIFICATION_TO`, and preferably `RESEND_API_KEY`; `EMAIL_FROM` remains a backward-compatible sender fallback
   - `MAX_EMAIL_MESSAGE_BYTES=40000000` for Resend and `SESSION_COOKIE_SECURE=true`
   - a generated `FIRST_OWNER_SETUP_SECRET` of at least 32 random characters for first-run setup
6. From cPanel Terminal, run `npm run db:init` and `npm run build`, then create the owner with the masked CLI prompt or `/admin/setup`. Remove `FIRST_OWNER_SETUP_SECRET` from the host after successful setup; the database marker keeps the route closed.
7. Restart the Node application in cPanel and map the domain/subdomain to it. Confirm `https://your-domain/api/health` returns HTTP 200.

Percent-encode special characters in the MySQL URL username/password. Do not paste the URL into shell commands: the scripts read it from cPanel’s environment or a private `.env.local` file. `MYSQL_TEST_URL` is not required in production and must never point verification at production data.

## VPS / PM2 deployment

```bash
cp .env.example .env.local
chmod 600 .env.local
# Fill in one database form, APP_URL, mail settings, and message-size limit.
./scripts/deploy.sh
npm run create-owner -- owner@your-domain
pm2 startup   # run the one command it prints, once
pm2 save
```

`deploy.sh` requires Node 24, checks MySQL without exposing credentials, applies rerunnable schema/seeds, builds, and reloads PM2.

## Mail and upload validation

All originals are attached only to the shop notification and then released from memory; the customer confirmation has no attachments. The app stores quote metadata and delivery status only. For Resend set `MAX_EMAIL_MESSAGE_BYTES=40000000`, then lower it if the recipient supports less. This value covers the estimated encoded message; it does not permit 40 MB of raw attachments because base64/MIME overhead automatically lowers the UI and server raw cap. Test a near-limit request through the actual production providers before launch.

The app-level checks run after the hosting layer accepts the HTTP request. GoDaddy Node.js Hosting request-body limits, proxy timeouts, writable build behavior, Node version, MySQL compatibility, outbound SMTP, runtime DDL, and scheduler support remain platform assumptions that must be verified on the exact plan. The setup-secret-protected web route can initialize only a completely empty database; use the generated SQL import fallback when runtime DDL is unavailable.

Resend HTTPS is the preferred filesystem-free Airo/GoDaddy transport. SMTP remains compatible on hosts that allow outbound SMTP. Gmail API remains available through `GMAIL_OAUTH_TOKENS_PATH` only when the exact plan provides a private persistent writable token path that survives builds and restarts; keep that file outside the web root with mode `0600`. If that path cannot be verified, do not configure Gmail API.

## Reliability and operations

- `/api/health` returns 200 only when MySQL responds and mail delivery is configured.
- Point an uptime monitor at `https://your-domain/api/health` every five minutes.
- `scripts/backup.sh` uses `mysqldump --single-transaction`; it puts credentials only in a temporary mode-`0600` defaults file and removes it afterward.
- `scripts/maintenance.mjs --apply` removes expired sessions and used/expired reset tokens, prunes old reset-delivery history, and retries the durable reset outbox through the running application.
- Set `RESET_DELIVERY_WORKER_SECRET` to a separate random value of at least 32 characters. The scheduled maintenance process and application must share it; never put it in a URL or log.

Example cron entries on a VPS (use cPanel Cron Jobs with equivalent absolute paths):

```cron
15 2 * * * /path/to/app/scripts/backup.sh >> /path/to/private-logs/spe-backup.log 2>&1
*/5 * * * * cd /path/to/app && node --env-file-if-exists=.env.local scripts/maintenance.mjs --apply >> /path/to/private-logs/spe-maintenance.log 2>&1
```

Keep backups and logs outside `public/` and the document root. Test a restore before launch.

## Launch checks

1. Run static/unit checks and build. Run MySQL verification only against a disposable `MYSQL_TEST_URL` whose database name ends in `_test`.
2. Enter owner-approved prices and review every manual option.
3. Submit differently configured files and confirm one notification contains every attachment and complete metadata.
4. Test password recovery and sign-out on the production domain.
5. Confirm a catalog item used by a quote can be deactivated but cannot be deleted through the portal.
6. Confirm backup, restore, maintenance, uptime monitoring, HTTPS, and cPanel application restart behavior.
