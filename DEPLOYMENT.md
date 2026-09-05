# Production deployment

Requirements: Node.js **24**, MySQL **8**, a writable application directory, an SMTP provider or Gmail API token file, and HTTPS.

## GoDaddy cPanel: MySQL and Node 24

1. In **cPanel → MySQL Databases**, create a database and database user. cPanel normally prefixes both names with the account name.
2. Add the user to the database with **All Privileges**. Do not reuse the cPanel account password.
3. In **cPanel → Setup Node.js App** (or **Application Manager**), create a production app using Node.js 24, point the application root at this project, and use `npm start` as the start command. If Node 24 is not offered, ask GoDaddy to enable it or use a Node-24-capable plan; do not deploy this Next.js 16 app on an older runtime.
4. Copy the project to the application root and run `npm ci` from cPanel Terminal.
5. In the Node app environment-variable UI, set:
   - `MYSQL_URL=mysql://PREFIX_USER:URL_ENCODED_PASSWORD@localhost:3306/PREFIX_DATABASE`
   - `APP_URL=https://your-domain`
   - `EMAIL_FROM`, `QUOTE_NOTIFICATION_TO`, and SMTP variables (or `GMAIL_OAUTH_TOKENS_PATH`)
   - `MAX_EMAIL_MESSAGE_BYTES` and `SESSION_COOKIE_SECURE=true`
6. From cPanel Terminal, run `npm run db:init`, `npm run create-owner -- owner@your-domain`, and `npm run build`.
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

Standard SMTP works with cPanel email and third-party SMTP providers. Gmail API remains available through `GMAIL_OAUTH_TOKENS_PATH`; keep that token file outside the web root with mode `0600`.

## Reliability and operations

- `/api/health` returns 200 only when MySQL responds and mail delivery is configured.
- Point an uptime monitor at `https://your-domain/api/health` every five minutes.
- `scripts/backup.sh` uses `mysqldump --single-transaction`; it puts credentials only in a temporary mode-`0600` defaults file and removes it afterward.
- `scripts/maintenance.mjs --apply` removes expired sessions and used/expired reset tokens.

Example cron entries on a VPS (use cPanel Cron Jobs with equivalent absolute paths):

```cron
15 2 * * * /path/to/app/scripts/backup.sh >> /path/to/private-logs/spe-backup.log 2>&1
30 3 * * * cd /path/to/app && node --env-file-if-exists=.env.local scripts/maintenance.mjs --apply >> /path/to/private-logs/spe-maintenance.log 2>&1
```

Keep backups and logs outside `public/` and the document root. Test a restore before launch.

## Launch checks

1. Run static/unit checks and build. Run MySQL verification only against a disposable `MYSQL_TEST_URL` whose database name ends in `_test`.
2. Enter owner-approved prices and review every manual option.
3. Submit differently configured files and confirm one notification contains every attachment and complete metadata.
4. Test password recovery and sign-out on the production domain.
5. Confirm a catalog item used by a quote can be deactivated but cannot be deleted through the portal.
6. Confirm backup, restore, maintenance, uptime monitoring, HTTPS, and cPanel application restart behavior.
