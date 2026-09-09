# Ship Print eSell

Portable print-quote intake built with Next.js 16, Node.js 24, TypeScript, MySQL 8, and standard SMTP or the Gmail API.

## What it preserves

- Customer quote intake with per-file configuration, server-side catalog/minimum validation, idempotency, and price snapshots.
- Owner login, hashed sessions, expiring single-use password resets, and forced sign-out after password changes.
- One validated transaction for the complete multi-table pricing draft. Catalog rows referenced by quote history can be deactivated but not deleted through the owner API.
- Original files are transient: they are attached to the shop notification and are not retained as an artwork archive. After provider acceptance, the customer receives a separate attachment-free acknowledgment; its delivery failure is recorded without duplicating or failing the accepted request.
- `/api/health` reports ready only when MySQL responds and either SMTP or Gmail API delivery is configured.

## Upload and email limits

- 25 MB per file; 75 MB raw combined per request.
- `MAX_EMAIL_MESSAGE_BYTES` validates the estimated complete MIME message, including base64 overhead.
- Provider acceptance means accepted for processing, not guaranteed inbox delivery.

## Local UI development

If you are working on the public-facing UI, you do **not** need MySQL, Docker, email, or an owner account:

```bash
npm install
npm run dev:ui
```

Open <http://localhost:3000>. The public quote form uses the built-in fixture catalog, so layout, styling, responsive behavior, and most form interactions work immediately. Database-backed submission and the owner portal are intentionally unavailable in this mode.

## Full local setup (Windows, macOS, or Linux)

Use the full setup only when you need database-backed quote submission, admin features, or integration tests. Install Node.js 24 and Docker Desktop/Docker Engine, then run:

```bash
npm install
npm run setup:local
npm run dev:local
```

`setup:local` works the same on Windows, macOS, and Linux. It:

1. reuses a working `MYSQL_URL` when one is already configured;
2. otherwise starts a persistent private `mysql:8.4` Docker container;
3. otherwise uses an installed native MySQL 8 server;
4. creates isolated app/test databases and a least-scope app user;
5. writes credentials to ignored mode-`0600` local files without displaying them;
6. applies the schema/seeds and prompts for the first owner email/password.

You can supply the owner email up front with `npm run setup:local -- owner@example.com`. The only remaining prerequisite is starting/installing Docker or native MySQL if neither is available; the script prints the exact platform-specific step. `npm run dev:local` reruns the additive schema/seeds before starting Next.js.

## Email portability

Set `EMAIL_FROM`, `QUOTE_NOTIFICATION_TO`, and either:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, plus `SMTP_USER`/`SMTP_PASS` when required; or
- `GMAIL_OAUTH_TOKENS_PATH` pointing to a mode-`0600` Gmail OAuth token file.

SMTP remains provider-neutral (cPanel mail, SES, Postmark, SendGrid, Resend SMTP, etc.). Credentials stay in environment configuration, never the database or browser.

Delivery audit rows are created transactionally with each quote before email is attempted. A `queued` row means the outcome needs owner reconciliation; `provider_accepted` confirms only that SMTP accepted at least one recipient or that the Gmail API returned a message ID, not inbox placement. For Gmail notifications, use a recipient mailbox different from the authenticated sender when an ordinary unread incoming notification is required. Gmail can file a message sent to the same account in both Inbox and Sent and mark the shared copy as seen.

## Owner portal

The protected, unlinked `/admin` portal provides request search/filter/detail/status, pricing configuration and preview, business settings, and password recovery. Pricing supports size base prices, paper surcharges, per-mode color/orientation surcharges, billing bases, minimums, manual quotes, finishing, and bulk discounts. Workflow values are `request_received`, `quote_sent`, `in_progress`, `awaiting_payment`, and `fulfilled`, displayed as Request received, Quote sent, In progress, Awaiting payment, and Fulfilled.

On a new deployment with no owners, `/admin/setup` creates the first owner using the masked `FIRST_OWNER_SETUP_SECRET` field and the existing password policy. Creation is transactionally one-time and leaves a permanent database marker. Existing terminal-based owner creation and email recovery remain available. Password-reset links require `APP_URL` to be an HTTPS origin with no credentials, path, query, or fragment; development verification permits HTTP only on loopback.

## GoDaddy Node.js Hosting upload

Create the source-only upload archive with:

```bash
npm run package:godaddy
```

The deterministic output is `release-artifacts/ship-print-esell-godaddy-node24.zip`. It has `package.json` at the ZIP root, declares Node 24, and supplies GoDaddy's required `main`, `build`, and `start` metadata. It excludes dependencies, builds, tests, local databases/data, environment files other than the placeholder-only `.env.example`, logs, uploads, caches, editor files, and credential/key paths. The archive also contains `db/godaddy-import.sql` as a one-step MySQL 8 fallback import.

See [DEPLOYMENT.md](DEPLOYMENT.md#godaddy-nodejs-hosting-zip-upload) for the exact upload, environment, database, owner setup, scheduler, and preview checks. GoDaddy's public Node.js Hosting page currently states that apps run on Node.js 22. This Next.js release is qualified for Node 24 and intentionally declares `engines.node=24.x`; do not publish it there unless the selected GoDaddy environment actually offers Node 24.

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

Start with the human-run [deployment handbook](DEPLOYMENT-HANDBOOK.md) to qualify the customer's hosting, collect access, stage, launch, verify, roll back, and hand off. Use [DEPLOYMENT.md](DEPLOYMENT.md) as the lower-level technical reference only after the hosting plan passes qualification.
