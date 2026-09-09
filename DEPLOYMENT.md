# Production deployment technical reference

Start with [DEPLOYMENT-HANDBOOK.md](DEPLOYMENT-HANDBOOK.md). It is the qualification-first, human-run procedure for selecting hosting, collecting access, staging, launch, rollback, and customer handoff.

Requirements: Node.js **24**, MySQL **8**, a writable application directory, an SMTP provider or Gmail API token file, and HTTPS. **Do not assume ordinary GoDaddy cPanel satisfies these requirements:** qualify the customer's exact plan before following any provider-specific steps below.

## GoDaddy Node.js Hosting ZIP upload

GoDaddy's current Node.js Hosting FAQ requires a top-level `package.json` with non-empty `name`, `version`, and `main`; `build` and `start` scripts; use of `process.env.PORT`; runtime/build packages in `dependencies`; and no uploaded `node_modules`. This project meets those package-shape requirements. `next start` reads the assigned `PORT` automatically.

GoDaddy's current product page says its apps run on **Node.js 22**, while this release and Next.js version are qualified for **Node.js 24**. The package therefore declares `engines.node=24.x`. Stop if the preview build does not offer Node 24; do not override the engine or downgrade the runtime without a separate compatibility change and full release retest.

### Prepare and upload

1. On the release workstation, run `npm ci`, the release gates, and then `npm run package:godaddy`.
2. Upload `release-artifacts/ship-print-esell-godaddy-node24.zip` through **GoDaddy Node.js Hosting → Upload zip**. Do not add a wrapper directory; `package.json` is already at the ZIP root.
3. Select the private preview. GoDaddy should install dependencies, run `npm run build`, and start with `npm start`; inspect build and runtime logs. Do not publish yet.

### Environment and database

In GoDaddy's encrypted secrets/environment UI, enter the production values from `.env.example`: `MYSQL_URL`, `DATABASE_SSL`, `APP_URL`, `EMAIL_FROM`, `QUOTE_NOTIFICATION_TO`, `MAX_EMAIL_MESSAGE_BYTES`, `SESSION_COOKIE_SECURE=true`, a mail-provider configuration, `FIRST_OWNER_SETUP_SECRET`, and a separate `RESET_DELIVERY_WORKER_SECRET`. Use the preview HTTPS origin for `APP_URL` during preview, then change it to the final origin and restart before publish. Do not upload an `.env` file and do not define `MYSQL_TEST_URL`, `ENABLE_LOCAL_DEV_INTAKE`, or `NEXT_PUBLIC_ENABLE_DEMO_PRICING` in production.

Create a dedicated managed MySQL 8 database and least-privilege application user in GoDaddy's **Database** UI. Then use exactly one of these paths:

- **Preferred no-terminal first run:** leave the selected database completely empty. Open `/admin/setup`, enter the 32+ character setup secret only in its masked field, and create the owner. After the secret is validated, the app takes a database advisory lock, rechecks that the database has no tables, applies the schema, migrations, and rerunnable catalog seeds, verifies the expected table set, and only then creates the first owner. It refuses unknown or partial databases and never drops tables or overwrites owner-entered prices.
- **Database import fallback:** in GoDaddy **Database → SQL/import**, import the archive's `db/godaddy-import.sql` once into an empty MySQL 8 database. After the import succeeds, open `/admin/setup` to create the owner. Use this fallback if the host blocks runtime DDL, the empty-database bootstrap was interrupted, or tables already exist. Never import over an unreviewed populated database.

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
   - `MYSQL_URL=mysql://PREFIX_USER:URL_ENCODED_PASSWORD@localhost:3306/PREFIX_DATABASE`
   - `APP_URL=https://your-domain`
   - `EMAIL_FROM`, `QUOTE_NOTIFICATION_TO`, and SMTP variables (or `GMAIL_OAUTH_TOKENS_PATH`)
   - `MAX_EMAIL_MESSAGE_BYTES` and `SESSION_COOKIE_SECURE=true`
   - a generated `FIRST_OWNER_SETUP_SECRET` of at least 32 random characters for first-run setup
6. From cPanel Terminal, run `npm run db:init` and `npm run build`, then create the owner with the masked CLI prompt or `/admin/setup`. Remove `FIRST_OWNER_SETUP_SECRET` from the host after successful setup; the database marker keeps the route closed.
7. Restart the Node application in cPanel and map the domain/subdomain to it. Confirm `https://your-domain/api/health` returns HTTP 200.

Percent-encode special characters in the MySQL URL username/password. Do not paste the URL into shell commands: the scripts read it from cPanel’s environment or a private `.env.local` file. `MYSQL_TEST_URL` is not required in production and must never point verification at production data.

## VPS / PM2 deployment

```bash
cp .env.example .env.local
chmod 600 .env.local
# Fill in MYSQL_URL, APP_URL, mail settings, and message-size limit.
./scripts/deploy.sh
npm run create-owner -- owner@your-domain
pm2 startup   # run the one command it prints, once
pm2 save
```

`deploy.sh` requires Node 24, checks MySQL without exposing credentials, applies rerunnable schema/seeds, builds, and reloads PM2.

## Mail and upload validation

All originals are attached to one message and then released from memory; the app stores quote metadata and delivery status only. Set `MAX_EMAIL_MESSAGE_BYTES` to the lower complete-message limit of the sender and recipient. Test a near-limit request through the actual production providers before launch.

The app-level checks run after the hosting layer accepts the HTTP request. GoDaddy Node.js Hosting request-body limits, proxy timeouts, writable build behavior, Node version, MySQL compatibility, outbound SMTP, runtime DDL, and scheduler support remain platform assumptions that must be verified on the exact plan. The setup-secret-protected web route can initialize only a completely empty database; use the generated SQL import fallback when runtime DDL is unavailable.

Standard SMTP works with cPanel email and third-party SMTP providers. Gmail API remains available through `GMAIL_OAUTH_TOKENS_PATH`; keep that token file outside the web root with mode `0600`.

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
