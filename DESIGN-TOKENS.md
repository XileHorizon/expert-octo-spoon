# Editing the Ship Print eSell design

The visual system is intentionally split into two files:

- **`src/app/design-tokens.css`** — the shared knobs you are expected to edit.
- **`src/app/globals.css`** — component layout and state rules. Change this when one specific component needs different geometry or behavior.

`globals.css` imports the token file, so there is only one global stylesheet import in `src/app/layout.tsx`.

## The edits you will make most often

### Brand colors

Change these in `design-tokens.css`:

```css
--color-brand: #dd0f14;
--color-brand-hover: #c20d12;
--color-brand-soft: #fff8f8;
```

The customer quote form uses those three variables for primary buttons, selections, focus accents, and soft branded surfaces.

The owner pricing workspace deliberately has its own accent so it can be adjusted independently:

```css
--color-portal-brand: #d92d20;
```

### Typography

The font files are selected in `src/app/layout.tsx`. Editable fallback stacks live in `design-tokens.css`:

```css
--font-fallback-body: Inter, Arial, sans-serif;
--font-fallback-display: Manrope, Arial, sans-serif;
```

`globals.css` combines those fallbacks with the optimized `next/font` variables on `<body>`. Keep that combination on `body`: the generated font variables are scoped there, not on `:root`.

Use the `--font-size-*` scale for reusable interface text. Large, one-off display headings remain beside their component rules so their intent is obvious.

### Spacing and corner roundness

Use `--space-1` through `--space-12` for repeated spacing and `--radius-xs` through `--radius-2xl` for reusable corner styles. `--radius-pill` is for chips and pill-shaped controls.

Changing a spacing or radius token changes every component using it. If you only want to change one card, edit that component's rule in `globals.css` instead of changing a global token.

### Page widths and controls

The main layout knobs are:

```css
--layout-quote-max: 1280px;
--layout-admin-max: 1240px;
--layout-sidebar-width: 232px;
--control-height: 42px;
--control-height-lg: 44px;
--control-height-submit: 58px;
```

### Shadows and focus rings

Shared elevation and keyboard-focus appearance live under **Shape and elevation**. Keep focus rings visible when changing brand colors.

## Responsive behavior

Responsive rules are grouped at the end of their related section in `globals.css`. Search for:

- `@media(max-width:1340px)` — narrower desktop quote layout
- `@media(max-width:980px)` — single-column quote layout
- `@media(max-width:900px)` — owner portal tablet/mobile layout
- `@media(max-width:680px)`, `760px`, `480px`, and `440px` — smaller-screen refinements

CSS custom properties cannot be used reliably as media-query thresholds, so breakpoints remain readable literals in `globals.css` rather than fake tokens.

## What is intentionally not tokenized

One-off structural measurements—such as a logo's exact rendered size, a particular grid column, or a single illustration dimension—stay in the component rule. Turning every number into a variable would make edits harder, not easier.

All shared colors are tokens. A raw color in `globals.css` should be treated as a sign that a new semantic token may be needed.

## Safe editing checklist

1. Change the smallest relevant token or component rule.
2. Run `npm run typecheck && npm run lint && npm test && npm run build`.
3. Start the app and check both `/` and `/admin` at desktop and mobile widths.
4. If changing pricing-workspace styles, run `node --env-file=.env.local .artifacts/visual-admin-review.mjs`.
