# Ship Print eSell

Portable print-quote intake built with Next.js, TypeScript, PostgreSQL, and standard SMTP.

## Current workflow

- A customer uploads up to 10 PDF/PNG/JPEG files.
- Every file has an independent collapsible configuration: size/custom dimensions, quantity, paper, color, sides, orientation, finishing, notes, and estimate.
- The seven required sizes and their exact paper mappings are seeded by `db/seed-required-catalog.sql`; existing owner-entered rates are never overwritten.
- Business cards enforce a 200 minimum in the UI and server.
- Unpriced materials remain manual quotes. A mixed request shows the priced-items subtotal and names every item awaiting a quote; it never labels a partial subtotal as the total.
- There are no turnaround, rush, fulfillment, or shipping selections or charges.
- Original files are attached to one notification email. The web app retains only request metadata and delivery status—not an artwork archive or download library.
- A submission is shown as successful only after SMTP accepts the message for processing. On failure, the browser keeps all form entries.

## Upload and email limits

- 25 MB per file
- 75 MB raw combined cap per request
- A second server/client check estimates base64, MIME wrapping, headers, and body overhead against `MAX_EMAIL_MESSAGE_BYTES`

Set `MAX_EMAIL_MESSAGE_BYTES` to the lower limit of the sender and receiving mailbox. Provider acceptance proves the message was accepted for processing; it cannot prove final inbox delivery. If files do not fit, customers must reduce the submission or contact the shop for another transfer method. Files are never compressed or silently omitted.

## Setup

```bash
npm install
cp .env.example .env.local
# Configure DATABASE_URL, APP_URL, SMTP values, recipient, and email-size limit
npm run db:init
npm run create-owner -- owner@example.com
npm run build
npm start
```

## Design editing

Shared colors, typography, spacing, radii, shadows, layout widths, and control heights live in `src/app/design-tokens.css`. Component layout stays in the readable `src/app/globals.css`.

See [`DESIGN-TOKENS.md`](./DESIGN-TOKENS.md) for the short human-editing guide, including the exact variables for brand colors, page widths, responsive behavior, and common visual changes.

## Owner portal

The protected, unlinked `/admin` portal provides:

- request dashboard, search/filter, complete metadata, delivery status, and status updates;
- Figma-matched Paper types, Sizes & pricing, Print options & finishing, and Bulk discounts workspaces;
- base pricing per size plus paper surcharges, billing/charge bases, minimums, manual-quote sizes, percentage thresholds, and size applicability;
- a Test a quote preview powered by the exact same pricing function as the customer form;
- staged edits, validation, explicit atomic saves, cancel/revert, unsaved-change warnings, and history-safe deactivation;
- business contact/copy settings and password recovery.

It contains no artwork download library. Customer originals belong in the recipient mailbox.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run verify:e2e
npm run verify:ops
npm run verify:full
npm run build
```

The full-stack suite starts temporary real PostgreSQL and SMTP services and drives authentication, owner catalog editing, three independently configured files, pricing, upload validation, email attachments, metadata review, status changes, and password recovery.

See [DEPLOYMENT.md](DEPLOYMENT.md) for unattended operation.
