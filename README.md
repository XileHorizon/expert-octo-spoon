# Ship Print eSell

Portable print-quote intake built with Next.js 16, Node.js 24, TypeScript, MySQL 8, and standard SMTP or the Gmail API.

## What it preserves

- Customer quote intake with per-file configuration, server-side catalog/minimum validation, idempotency, and price snapshots.
- Owner login, hashed sessions, expiring single-use password resets, and forced sign-out after password changes.
- One validated transaction for the complete multi-table pricing draft. Catalog rows referenced by quote history can be deactivated but not deleted through the owner API.
- Original files are transient: they are attached to one notification email and are not retained as an artwork archive. Failed delivery never reports customer success.
- `/api/health` reports ready only when MySQL responds and either SMTP or Gmail API delivery is configured.

## Upload and email limits

- 25 MB per file; 75 MB raw combined per request.
- `MAX_EMAIL_MESSAGE_BYTES` validates the estimated complete MIME message, including base64 overhead.
- Provider acceptance means accepted for processing, not guaranteed inbox delivery.

## Local macOS setup

Requires Node.js 24 and Homebrew. The guided setup detects Homebrew MySQL, creates separate app/test databases and a least-scope app user, writes `.env.local` mode `0600`, and never displays generated database credentials.

```bash
npm install
brew install mysql                 # once, if missing
brew services start mysql          # once, if the daemon is not running
npm run setup:local
npm run create-owner -- owner@example.com
npm run dev:local
```

If Homebrew MySQL already runs, `npm run setup:local` is the only database setup command. `npm run dev:local` reruns the additive schema/seeds before starting Next.js.

For non-macOS development, create MySQL 8 databases for the app and tests, ensure the disposable test database name ends in `_test`, then set `MYSQL_URL` and `MYSQL_TEST_URL` in `.env.local` and run `npm run db:init`.

## Email portability

Set `EMAIL_FROM`, `QUOTE_NOTIFICATION_TO`, and either:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, plus `SMTP_USER`/`SMTP_PASS` when required; or
- `GMAIL_OAUTH_TOKENS_PATH` pointing to a mode-`0600` Gmail OAuth token file.

SMTP remains provider-neutral (cPanel mail, SES, Postmark, SendGrid, Resend SMTP, etc.). Credentials stay in environment configuration, never the database or browser.

## Owner portal

The protected, unlinked `/admin` portal provides request search/filter/detail/status, pricing configuration and preview, business settings, and password recovery. Pricing supports size base prices, paper surcharges, billing bases, minimums, manual quotes, finishing, and bulk discounts.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run verify:e2e     # real MySQL 8; resets only MYSQL_TEST_URL ending in _test
npm run verify:ops     # real MySQL 8 maintenance behavior
npm run verify:full    # real MySQL 8 + local SMTP + complete HTTP workflow
npm run build
```

The MySQL suites fail with a clear prerequisite message when `MYSQL_TEST_URL` is absent, unreachable, not MySQL 8, or does not end in `_test`; they never substitute a mock database.

See [DEPLOYMENT.md](DEPLOYMENT.md) for GoDaddy cPanel and VPS deployment.
