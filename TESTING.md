# Testing and local verification

This documents the test paths currently present in the repository. Listed commands are package scripts; listing a command is not evidence that it has passed.

## Prerequisites

- Node.js 24.x and dependencies installed with npm ci (or npm install).
- MySQL 8.0/8.4 for integration checks; the helper rejects other versions.
- Docker/Podman with permission to run MySQL 8.4, or a running native MySQL 8 server, for npm run setup:local.
- No real SMTP account is needed for automated full-stack verification: it starts an in-process SMTP sink. Never commit credentials.

## Test paths

| Goal | Command | Scope |
| --- | --- | --- |
| Unit/component tests | npm test | Vitest; no database or mail |
| Browser E2E harness | npm run test:e2e | Playwright Chromium; local fixture-mode server by default |
| Browser E2E UI runner | npm run test:e2e:ui | Interactive Playwright UI; same server policy |
| Static gates | npm run typecheck; npm run lint | No external services |
| Schema, migrations, seeds, constraints | npm run verify:e2e | Resets every table in MYSQL_TEST_URL |
| Maintenance behavior | npm run verify:ops | Resets every table in MYSQL_TEST_URL |
| Full HTTP/portal/quote/email workflow | npm run verify:full | Resets test DB; starts its own Next dev server and SMTP sink |
| Production compilation | npm run build | Writes ignored Next output |
| Requested local test bundle | npm run test:all | Typecheck, lint, Vitest, MySQL integration, and Playwright |
| Deployment rehearsal bundle | npm run verify:all | Typecheck, lint, unit, schema, ops, full HTTP workflow, and build |

npm run rehearse:deploy first runs db:init against MYSQL_URL, then verify:all; use it only with a disposable/local application database.

## First-time local setup

    npm ci
    npm run setup:local
    # Optional owner email; password is entered through a masked prompt:
    npm run setup:local -- owner@example.test

The setup script first reuses a reachable MYSQL_URL in .env.local. Otherwise it starts/reuses a private MySQL 8.4 container named ship-print-esell-mysql on 127.0.0.1:3307, or uses native MySQL 8. It creates ship_print_esell and ship_print_esell_test, gives the local app user access to both, writes credentials to ignored mode-0600 .env.local, applies schema/migrations/seeds, and optionally creates an owner.

    npm run dev:local

dev:local reruns additive initialization against MYSQL_URL before starting Next.js (normally port 3000). For UI-only work, npm run dev:ui needs no database, email, or owner account and uses fixture pricing.

### Existing-server safety

setup:local and db:init are mutating commands. Because setup reuses a reachable .env.local database, inspect the target without printing credentials before running them:

    node -e 'const u=process.env.MYSQL_URL;if(!u)throw Error("MYSQL_URL is unset");const x=new URL(u);console.log(x.hostname+":"+(x.port||3306)+"/"+x.pathname.slice(1))'

Use only a local/disposable database. Never point MYSQL_URL or MYSQL_TEST_URL at staging/production, and never run rehearse:deploy against customer data. db:init is not a rollback tool.

verify:full does not use or stop a normal dev server: it uses a separate high app port, NEXT_DIST_DIR=.next-verify, MYSQL_TEST_URL, and a temporary .env.verify removed on exit. It still needs its selected port and SMTP port 32525 to be free.

## Isolated MySQL test database

The helper reads MYSQL_TEST_URL from the process environment, .env.local, or .env. The database name must end in _test. Each reset-based run checks connectivity and MySQL 8, drops all tables in that database, applies db/schema.sql, db/migrations/001-minimum-order-total.sql, db/migrations/002-same-day-release.sql, db/migrations/003-delivery-hardening.sql, and (when requested) both seed files. The suffix is a guard, not proof that a database is disposable; use a dedicated test database/user.

The safe reference template is docs/test-env.example. It is not automatically loaded. Export it in a disposable shell after replacing its placeholder password, or let setup:local create .env.local:

    set -a
    . ./docs/test-env.example
    set +a
    npm run verify:e2e

Do not edit and commit the template with real values.

## Local email capture

verify:full starts smtp-server on 127.0.0.1:32525 with optional auth and STARTTLS disabled. The app receives EMAIL_FROM=quotes@example.test and QUOTE_NOTIFICATION_TO=shop@example.test; raw messages are kept only in an in-memory inbox array. The verifier checks both messages, shop recipient, customer Reply-To, summary, three shop-only attachments, an attachment-free provisional customer acknowledgment, and transactionally prepared delivery records updated to provider_accepted. For password recovery it closes SMTP to force the first handoff to fail, confirms the durable queued state, restarts SMTP, rejects an unauthenticated worker call, and confirms an authenticated scheduled retry is delivered on attempt two. It finally closes SMTP again and checks that a failed shop handoff returns HTTP 502 while leaving the request visible in request_received.

There is no mailbox UI, durable .eml artifact, or external delivery. For manual development, use a local capture service and set SMTP_HOST, SMTP_PORT, SMTP_SECURE=false, EMAIL_FROM, and QUOTE_NOTIFICATION_TO in ignored configuration. Never use production SMTP credentials for test submissions.

## Commands

    npm run typecheck
    npm run lint
    npm test
    npm run test:integration
    npm run test:e2e
    npm run test:all
    npm run build

    npm run verify:e2e
    npm run verify:ops
    npm run verify:full
    npm run verify:all

The full verifier exercises health, anonymous access, owner login/session, catalog editing, public catalog, quote submission/idempotency/validation, email handoff, portal review/status, password reset, sign-out, and failed-email behavior. Unit coverage also checks bounded known/unknown reset timing and strict APP_URL validation.

### Playwright browser commands

The current package also defines npm run test:e2e and npm run test:e2e:ui. Playwright is configured for Chromium, writes HTML output under playwright-report/, and retains traces/screenshots/videos under test-results/ on failure. Without E2E_BASE_URL it starts a local Next dev server on 127.0.0.1:3100 with ENABLE_LOCAL_DEV_INTAKE=true and NEXT_PUBLIC_ENABLE_DEMO_PRICING=true; this is fixture/on-disk intake mode, not the MySQL/SMTP integration stack. With E2E_BASE_URL it targets an already-running server and does not start one. The browser specs cover customer validation/submission and admin login/request status; the live admin request test is skipped unless disposable-server variables are configured.

## Artifacts and cleanup

- Vitest and verification scripts print results to the terminal; no test-results directory is defined.
- Verification scripts print per-check PASS/FAIL lines and a final count.
- verify:full uses ignored .next-verify/ and removes .env.verify; an interrupted run may leave the build directory.
- Playwright writes HTML output under playwright-report/ and failure traces/screenshots/videos under test-results/; these are review artifacts, not pass evidence, and must not be committed unless the project later chooses to track them.
- npm run build writes ignored .next/.
- .env.local, .local-data/, .local-test-db/, logs, databases, uploads, and generated output are ignored. Do not add them to Git.

## Troubleshooting

- Missing MYSQL_TEST_URL: run setup:local or export a dedicated MySQL 8 URL ending in _test in the same shell.
- Wrong suffix/version/unreachable MySQL: intentional safety/prerequisite failures. Start MySQL 8 and correct the test URL; do not bypass the guard or use staging/production.
- Wrong database targeted: stop immediately, preserve evidence, inspect .env.local, and follow the appropriate backup/recovery process. Do not reset that database.
- Port conflict: dev:local normally uses 3000; verify:full needs its selected high port and 127.0.0.1:32525. Stop only a process you have identified.
- Full verifier timeout: inspect its captured Next log, confirm dependencies/database/ports, and keep the app database disposable.
- Mail failure: for verify:full, check port 32525 and that real SMTP variables are not overriding the harness. For manual testing, check local sink settings and EMAIL_FROM.

## Actual limitations

- npm test is Vitest, not browser automation; it does not prove MySQL, SMTP, hosting, or deliverability.
- Integration tests require real MySQL 8; they do not mock it.
- verify:full uses next dev, not next start, and its SMTP sink is not a real provider/mailbox. It cannot prove DNS, TLS, provider limits, deliverability, restart behavior, or production request limits.
- The SMTP capture is memory-only. Original artwork is not retained as an archive; it is handed to email and released.
- Uploads are limited to 25 MB per file and 75 MB raw per request, while MAX_EMAIL_MESSAGE_BYTES must reflect the lower proven complete MIME limit.
- Reset-based checks are unsafe for shared test data.

## Readiness criteria

For local release readiness, record a fresh run's date, commit, exact commands, target environment (never secrets), exit codes, and final counts. Require:

- [ ] npm run typecheck, npm run lint, npm test, and npm run build exit 0.
- [ ] npm run verify:e2e exits 0 against dedicated MySQL 8 _test.
- [ ] npm run verify:ops exits 0 against disposable data.
- [ ] npm run verify:full exits 0, including successful and failed email handoff.
- [ ] Output has no FAIL or aborted verification.
- [ ] git status contains only intentional changes; no credentials, customer files, databases, or generated artifacts are included.

This is local release readiness, not production launch approval. Production also requires qualified Node/MySQL hosting, HTTPS, real provider/mailbox near-limit testing, backups/restore, monitoring, and owner smoke tests.
