# Production deployment

The application belongs entirely to the client and needs only Node.js 20+, PostgreSQL 14+, an SMTP provider, and a domain.

## Deploy

```bash
cp .env.example .env.local
# Fill in DATABASE_URL, APP_URL, SMTP_*, EMAIL_FROM,
# QUOTE_NOTIFICATION_TO, and MAX_EMAIL_MESSAGE_BYTES.
./scripts/deploy.sh
npm run create-owner -- owner@theirdomain.com
pm2 startup   # run the one command it prints
pm2 save
```

`deploy.sh` checks PostgreSQL and mandatory SMTP settings, applies the schema and required catalog mapping without overwriting existing prices, builds, and starts under PM2.

## Email-size validation

All uploaded originals are attached to one message. Confirm both:

1. the SMTP sender's maximum complete message size;
2. the receiving mailbox's maximum complete message size.

Set `MAX_EMAIL_MESSAGE_BYTES` to the lower value in bytes. The app preserves the 75 MB raw combined upload cap but also rejects a request whose estimated base64/MIME encoded message would exceed this configured service limit. Send a near-limit test through the chosen production providers before launch.

## Reliability

- PM2 restarts crashes and can restore the app after reboot.
- `/api/health` returns 200 only when PostgreSQL responds and SMTP is configured.
- Point an uptime monitor at `https://your-domain/api/health` every five minutes.
- Run metadata backups nightly:

```cron
15 2 * * * /path/to/app/scripts/backup.sh >> /var/log/spe-backup.log 2>&1
30 3 * * * cd /path/to/app && node scripts/maintenance.mjs --apply >> /var/log/spe-maintenance.log 2>&1
```

`backup.sh` backs up request/catalog/auth metadata only. Artwork is intentionally not stored by the web app; the client retains it from their mailbox. `maintenance.mjs` removes expired sessions and reset tokens.

## Reverse proxy

A Caddy example:

```caddy
quotes.theirdomain.com {
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 80MB
    }
}
```

The proxy limit must remain above the 75 MB raw request cap plus multipart overhead.

## Launch checks

1. Run `npm run verify:all`.
2. Enter owner-approved prices and review every manual/unconfigured option.
3. Submit three differently configured files.
4. Confirm one email arrives with every original attachment and complete metadata.
5. Test close-to-limit attachments against the actual sender and recipient.
6. Test password recovery from the production domain.
7. Test a database restore and configure off-box metadata backups.
