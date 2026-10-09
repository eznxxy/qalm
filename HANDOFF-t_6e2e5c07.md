# Handoff — t_6e2e5c07: typography + type scale + tabular-nums + focus ring (design step 5)

## Goal
Put DESIGN.md §2.4 (IBM Plex Sans 400/500/600, type scale, tabular-nums) and
§8 (2px `--brand` focus ring, 2px offset) onto the current /web app, and apply
Daedalus's amended values from t_5fa1c284 where step 5 touches them.

## Files changed (branch feature/t_6e2e5c07-typography, 5 commits, pushed — tip 6d58ec1)
- `web/src/app/fonts.ts` — NEW: IBM Plex Sans 400/500/600 via `next/font/google`,
  self-hosted at build time, exposed as `--font-plex-sans` (latin, display swap).
- `web/src/app/layout.tsx` — font variable on `<html>`; **tokens.css imported
  app-wide** (see the fix commit — this was the root cause of a dead focus ring).
- `web/src/app/globals.css` — §2.4 type roles (h1 22/28 600, h2 16/24 600, new
  `.t-page-title/.t-section-title/.t-body/.t-caption/.t-nums` helpers); ad-hoc
  sizes replaced: table cells 14/20, table headers 13/18 600, badges/captions/
  field errors/meta 12/16, control labels 13/18 w500; `tabular-nums` on tables
  and `code` (w500, the §2.4 case-ID treatment); §8 ring 2px `--brand` 2px
  offset on inputs, selects, buttons, links, `[role=button]`, summary,
  textarea, `.linklike`, `a.button-link`.
- `web/src/app/users/page.tsx`, `web/src/app/projects/page.tsx` — pagination
  count strings get `.t-nums`.
- `web/scripts/contract-stub-api.mjs` — read-only `GET /projects`,
  `GET /projects/:id` per docs/api-projects.md + 5 seed projects, so the
  projects table is screenshotable (the auth-only stub predated the projects
  contract; writes untouched, test double only).
- Commits: 09a8fa2 (stub routes) → 10f9d5e (font) → b33e1d9 (type scale) →
  81c6dbc (tnums + ring) → 6d58ec1 (tokens import fix).

## Assumptions / decisions
- **Theme untouched (deliberate).** The app still renders its legacy dark
  palette; the light-theme flip + real tokens.css is card t_62938355 (step 1).
  Consequences handled here: (a) `--ink-500`/`--ink-700` from the light §2.1
  table are NOT applied to text colours — captions/headers stay on the app's
  `--text-muted` (a light-theme value on the dark app would have failed
  contrast); the swap is a one-line change when step 1 lands. (b) The ring
  uses `--brand` (#263FA0) per §8 even on dark — it is a UI element, and 2px
  offset keeps it off the text. (c) t_5fa1c284's ink-500/badge-text decisions
  required no change in this slice: step 3's badge card owns badge colours,
  and captions are colour-tokenised at the step-1 flip.
- **Weight on `.field label` is 500, not the header role's 600** — it is a
  control label (§5 form field), not a table header; size/line 13/18 match
  the header role.
- `.linklike` needed an explicit ring (its `font: inherit` shorthand resets
  outline) and `a.button-link` previously restyled on `:focus-visible`, which
  drowned the ring — both now carry the §8 ring explicitly.
- DataTable's ring (from t_e3495ddb) already used 2px `--brand`; kept its
  documented −2px inset (cells would clip a positive offset inside the
  bordered root).

## Verification actually run
- `npx tsc --noEmit` exit 0; `npm run lint` clean; `npm test` 151/151.
- Dev server (3000) + stub (3001), `NEXT_PUBLIC_API_URL=/api/v1` proxy; real
  browser (CDP keyboard events):
  - BEFORE (ebe6d55): body font `system-ui,…,Roboto`, h1 24/36 w700, table
    `font-variant-numeric: normal`, ring rules with 1px offset.
  - AFTER (6d58ec1): `<html class>` carries the next/font module; body
    computes `"IBM Plex Sans", "IBM Plex Sans Fallback", system-ui, …` (exact
    §2.4 stack); self-hosted woff2 served 200 from `/_next/static/media/…`
    (zero runtime Google requests); h1 22/28 w600; `.field label` 13/18 w500;
    Tab through login: `ring=2px solid rgb(38,63,160) offset=2px` on input
    and button (focus-visible=true); projects table
    `font-variant-numeric: tabular-nums`.
  - Browser probing caught a real bug: the first ring build computed
    `0px none` everywhere — `--brand` resolved to nothing outside DataTable
    because tokens.css wasn't imported app-wide. Root-fixed in 6d58ec1
    (import the stub in layout.tsx), then re-verified.
- Screenshots (before/after) — `shots/` on the branch, also attached to the
  card: before-login, after-login, before-projects, after-projects.

## Open risks / notes for next cards
- Step 1 (t_62938355): when the real tokens land, swap the caption/header
  colours from `--text-muted` to `--ink-500`/`--ink-700` in globals.css
  (commented in the typography block), and keep or replace my app-wide
  `import "../styles/tokens.css"` — CSS custom properties are idempotent, so
  the double import with DataTable is harmless.
- The 1.05rem `.secret-value` (one-time password display) stays 16.8px on
  purpose: it is a transcribe-correctly value, like an input, not prose.
- Badge geometry (999px pill, pre-§5) is step 3's card (t_328401f8); only the
  caption type size was aligned here.
- Stub now serves read-only /projects; the auth-stub fidelity self-check
  (`scripts/verify-stub-fidelity.mjs`) still passes and is unaffected.
