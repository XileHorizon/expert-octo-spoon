# Ship Print eSell — Go Live Checklist

Everything you need to change, in order, with exactly where it goes.
You will not touch a single line of code. All of this happens in the GoDaddy
control panel and in your browser.

You need the site URL, database credentials, a verified sending domain/address,
a recipient address, and a Resend API key. This sheet tells you which box each
one goes in.

> **Shared-database warning:** GoDaddy Preview and Published use the same database.
> Preview is a non-destructive release check, not isolated staging. Never reset,
> truncate, drop, re-import over, or blindly reseed this database from Preview.

---

## Step 0 — Make the database exist (5 min, GoDaddy)

Before any variable matters, there has to be a real, empty MySQL database.

In GoDaddy, find the database section (cPanel: **MySQL Databases**; Node.js
hosting: the **Database** tab).

1. **Create a database.** Name it something like `ship_print_esell`.
   GoDaddy will usually prefix it with your account name, so the real name ends
   up looking like `abc123_ship_print_esell`. **Write down the real full name.**
2. **Create a database user.** Give it its own password — not your GoDaddy
   password, not your email password. A password manager generated one is ideal.
   Again, note the real prefixed username, e.g. `abc123_shipapp`.
3. **Add the user to the database** and grant **ALL PRIVILEGES**.
   This step is easy to skip and it is the #1 cause of "access denied" later.
4. **Note the host.** On cPanel it is almost always `localhost`. On GoDaddy's
   newer Node hosting they give you a real hostname — copy it exactly.

You now have four facts: **host**, **database name**, **user**, **password**.

> **Version check while you're in there:** this app needs **MySQL 8.0+** and
> **Node 24**. If GoDaddy shows MySQL 5.7 or a Node version below 24, stop and
> tell me — we solve that before anything else, because no amount of config
> fixes it.

---

## Step 1 — Choose exactly one database connection form

The app supports either of these forms. Configure **one form only**, never a
mixture of the two.

### Form A — one connection URL

Set `MYSQL_URL` using the four facts from Step 0:

```
mysql://USER:PASSWORD@HOST:3306/DATABASE
```

Percent-encode special characters in the username or password. Do not paste the
URL into chat, tickets, screenshots, or shell commands.

### Form B — separate GoDaddy fields

Set all four required fields:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

`DB_PORT` is optional and defaults to `3306`. If any required `DB_*` field is
missing, the app rejects the partial configuration. Do not also set `MYSQL_URL`.

---

## Step 2 — Enter the environment variables (the main event)

In GoDaddy, open your app's **Environment Variables** / **Secrets** panel.
cPanel calls it "Application Manager → your app → Environment Variables."
Node.js hosting calls it "Settings → Environment Variables."

Add each value as a separate **Name / Value** pair. Names are case-sensitive.
For the database, add **either** the single `MYSQL_URL` row **or** the complete
component group; do not add both.

| Name | Value to enter |
|---|---|
| `MYSQL_URL` | **Form A only:** the URL from Step 1 |
| `DB_HOST` | **Form B only:** the exact database hostname |
| `DB_USER` | **Form B only:** the full, possibly prefixed database username |
| `DB_PASSWORD` | **Form B only:** the database user's password |
| `DB_NAME` | **Form B only:** the full, possibly prefixed database name |
| `DB_PORT` | **Form B optional:** omit it to use `3306` |
| `APP_URL` | Your HTTPS site origin with no trailing slash |
| `SESSION_COOKIE_SECURE` | `true` |
| `DATABASE_SSL` | `false`, unless GoDaddy says this database requires TLS |
| `RESEND_API_KEY` | Your Resend API key, entered only in GoDaddy's private secrets UI |
| `QUOTE_NOTIFICATION_FROM` | Internal sender authorized under the verified Resend domain/subdomain, such as `quotes@notify.shipprintesell.com` |
| `CUSTOMER_CONFIRMATION_FROM` | Customer-facing authorized sender, such as `info@shipprintesell.com` |
| `EMAIL_FROM` | Optional compatibility fallback; omit when both split senders above are set |
| `QUOTE_NOTIFICATION_TO` | The address that receives quote requests |
| `MAX_EMAIL_MESSAGE_BYTES` | `40000000` (Resend's encoded-message ceiling, not 40 MB raw files) |
| `FIRST_OWNER_SETUP_SECRET` | A newly generated random value of at least 32 characters |
| `RESET_DELIVERY_WORKER_SECRET` | A different newly generated random value of at least 32 characters |

Generate both secrets in a password manager and enter them only in GoDaddy's
private secrets UI. Never store real values in this checklist. Remove
`FIRST_OWNER_SETUP_SECRET` immediately after owner creation; keep the reset
worker secret private and permanent.

### Resend requirements and precedence

Airo blocks outbound SMTP, so use Resend's filesystem-free HTTPS API. When
`RESEND_API_KEY` is present, the app always chooses Resend before any stale SMTP
or Gmail settings. Production sending requires a verified Resend domain and an
both configured From senders authorized for their domain or subdomain. Internal
notifications use the customer as Reply-To; customer confirmations use
`CUSTOMER_CONFIRMATION_FROM` as Reply-To.

Resend's Free tier currently permits **3,000 emails/month and 100/day**. Each
successful quote normally sends two messages: the shop notification with the
original files and an attachment-free customer confirmation. That is roughly 50
quote requests/day before password-reset messages.

The `40000000` message limit includes estimated base64/MIME overhead. The form
and server automatically reduce the allowed raw upload size; do not treat it as
a 40 MB raw attachment allowance. A recipient mailbox may require a lower value.

SMTP and Gmail API remain supported for other hosts. On Airo, do not configure
Gmail API unless the exact plan provides a private persistent writable token
path that survives builds and restarts.

---

## Step 3 — Restart the app

Environment variables do not take effect until the app restarts. In cPanel this
is the **Restart** button in Application Manager. On Node hosting it's **Restart**
or a fresh deploy.

If there is no restart button, stopping and starting the app works too.

---

## Step 4 — Check your work before going further

Open this in your browser:

```
https://your-site-url/api/health
```

You'll get back a small block of JSON. Find `checks.database` and read it:

- **`ok`** — you're good. Go to Step 5.
- **`not_configured`** — neither database form reached the app. The selected
  form did not save, a name has a typo, or the app did not restart.
- **`failed`** — credentials were rejected, TLS is wrong, or the selected form is
  partial or invalid. Recheck Step 0 privileges and every value in that one form.

Also check `checks.email`. If it is `not_configured`, recheck `RESEND_API_KEY`
and both split sender variables (or their `EMAIL_FROM` fallback), then restart. Database health must work before the rest, so fix
`checks.database` first.

**Do not skip this step.** It takes ten seconds and it tells you exactly which of
the two things is wrong, instead of you guessing.

---

## Step 5 — Create your owner login

Open:

```
https://your-site-url/admin/setup
```

Fill in three fields:

1. **Owner email** — the address you want to log into the admin portal with
2. **Owner password** — pick a strong one now, this is your real admin login
3. **Setup secret** — the private `FIRST_OWNER_SETUP_SECRET` value you generated

Submit. This one action builds all the database tables, seeds the product
catalog, and creates your account. It only works once, by design.

---

## Step 6 — Close the door behind you

Go back to the environment variables panel and **delete `FIRST_OWNER_SETUP_SECRET`**
entirely. Then restart the app one more time.

Leave `RESET_DELIVERY_WORKER_SECRET` in place — that one is permanent and the
password-reset system needs it.

The setup page stays locked even if you forget, because the database records that
setup already ran. Deleting it is belt-and-suspenders, and it's good practice.

---

## Step 7 — Prove it actually works

1. Log in at `https://your-site-url/admin` with the email and password from Step 5.
2. Go to the public site and submit a real quote request with a small file attached.
3. Confirm the shop notification, including the original file, lands in the `QUOTE_NOTIFICATION_TO` inbox.
4. Confirm the customer receives a separate confirmation without the original file attached.
5. Confirm the request also shows up in the admin portal.

If email does not arrive, confirm the Resend dashboard shows an accepted message,
both From senders and their domains/subdomains are verified, and the daily/monthly quota remains.
Provider acceptance does not by itself prove inbox placement, so also check spam.

---

## Quick troubleshooting

**"There is no database" when submitting a form**
The selected database form is not reaching the app. Confirm that you set either
`MYSQL_URL` or all four required `DB_*` fields, not both, then restart. Step 4
distinguishes missing configuration from a rejected or invalid connection.

**Access denied for user**
The database user exists but was never granted privileges on the database.
Back to Step 0.3.

**Unknown database**
You used the short name instead of GoDaddy's prefixed real name. It's
`abc123_ship_print_esell`, not `ship_print_esell`.

**Email health is `not_configured`**
`RESEND_API_KEY`, `QUOTE_NOTIFICATION_FROM`, or `CUSTOMER_CONFIRMATION_FROM` is
missing from the running app (unless `EMAIL_FROM` supplies the missing sender fallback).
Save the values in the private environment UI and restart.

**Resend rejects the message**
Verify both sending addresses and their domains/subdomains, check the 100/day and 3,000/month
Free-tier quotas, and confirm the encoded message stays within 40,000,000 bytes.
Do not paste provider response bodies or the API key into chat.

---

## What I need from you if you get stuck

Send me the raw output of `https://your-site-url/api/health` and tell me which
step you were on. That's enough for me to tell you what's wrong.

**Never send me** the database password, Resend API key, or the contents of the
environment variable values. I don't need them and they shouldn't travel through
chat.
