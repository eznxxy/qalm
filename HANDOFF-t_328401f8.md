# Handoff — t_328401f8 (qalm-design-3: status badge + segmented status bar + priority icon)

Branch: `feature/t_328401f8-status-components` (stacked on `feature/t_6e2e5c07-typography`,
tip of the design-series line that merges toward master). Commits: ed0cfd6, c901f55,
6bf87d3, 40582cb, 9715497, 1780f76.

## Goal
Status components per DESIGN.md §2.2 (as amended by t_5fa1c284) + §5: StatusBadge,
StatusBar, PriorityIcon in `web/src/components/ui/`, and replace every ad-hoc
status pill in the users/projects screens.

## Files changed
- NEW `web/src/components/ui/StatusBadge.tsx` / `.css` / `__tests__/StatusBadge.test.tsx`
- NEW `web/src/components/ui/StatusBar.tsx` / `.css` / `__tests__/StatusBar.test.tsx`
- NEW `web/src/components/ui/PriorityIcon.tsx` / `.css` / `__tests__/PriorityIcon.test.tsx`
- `web/src/components/ui/index.ts` — barrel exports for all three
- `web/src/app/users/page.tsx`, `web/src/app/projects/page.tsx`,
  `web/src/app/projects/[id]/page.tsx` — legacy pills → StatusBadge
- `web/src/app/globals.css` — legacy `.badge/.badge-ok/.badge-muted/.badge-warn` rules removed
- `web/src/app/projects/__tests__/projects-page.test.tsx` — selectors `.badge` → `.sb-badge`
- `web/src/app/design/page.tsx`, `web/src/components/app-nav.tsx` — demo page + nav updated
- `shots/t_328401f8-design.png` — after-screenshot (speed mode: one)

## Spec compliance (verified against COMPUTED styles in a real browser, not just code)
- Badge: tint background; text `--ink-900` w500 (13/9+ AA on every tint) — EXCEPT
  failed keeps solid `--failed` text (4.53:1, per the amendment); icon in the status
  solid — EXCEPT untested icon in `--ink-700`; 22px high, 4px radius, 12/16 caption
  type; icon shapes: check-circle / x-circle / minus-square / circular-arrow /
  forward-arrow / empty ring; icons aria-hidden (label carries the meaning, §1.3).
- Bar: 8px `.stb-small` (default) / 16px `.stb-large`; segments in §5 order
  Passed, Retest, Blocked, Failed, Skipped, Untested (never sorted); hover `title`
  shows counts; `role="img"` + aria-label "31 passed, 4 failed, 2 blocked, 13
  untested" (§5 example, verbatim, in tests); zero-count statuses render no segment;
  nonzero segments keep a 2px floor so 1-of-200 stays visible.
- Priority: Critical double-chevron-up in `--failed`, High up, Medium dash, Low down,
  all others `--ink-700`; icons aria-hidden, always paired with the visible word.
- All colours via token NAMES (`--passed`, `--passed-tint`, …) — converges with the
  tokens card (t_62938355) without value coupling.

## Assumptions / decisions flagged
1. aria-label PROSE order ≠ segment order: §5's example reads "passed, failed,
   blocked, untested" (severity-first), while segments render in the fixed §5 order.
   Implemented: visual order = segment order; spoken order = the §5 example order.
   Code comments on both constants; Daedalus can flip `SPEAK_ORDER` in one place if
   he wants audio to mirror geometry.
2. Untested/Deactivated/Archived/temp-password use `status="skipped"` + custom label —
   they are non-run statuses and DESIGN.md defines no dedicated tint for them; skipped
   is the neutral grey. Revisit if the tokens card introduces a neutral-badge token.
3. Fixed a latent a11y bug pattern from the DataTable card: never put `title` (or any
   accessible name) on an `aria-hidden` element — browsers then UN-hide it. Badges put
   titles on the badge span, never the svg.
4. `StatusBadge` renders only the six §2.2 statuses (typed). Roles/user-account states
   are label overrides, not new enum values — no invented statuses.

## How to run and verify
```
cd web && npm test                      # 180/180 (29 new for these components)
cd web && npx tsc --noEmit && npx eslint src   # both exit 0
node scripts/contract-stub-api.mjs 3001        # contract stub (matches next.config rewrite)
npx next dev -p 3000                           # IMPORTANT: browse http://localhost:3000
```
- Log in (bootstrap the first admin once via POST /api/v1/auth/bootstrap), then:
  - `/design` — all six badges, both bar sizes, priority legend, and a live table
    whose Status/Priority columns use the primitives. Screenshot: `shots/t_328401f8-design.png`.
  - `/projects?status=archived` (as admin) — Archived badge; `/users` — Active badge.
  - Screen reader: run rows announce "…: 31 passed, 4 failed, …" via role="img".
- Note for future browser verification: Next 16 dev blocks cross-origin dev
  resources — browsing `http://127.0.0.1:3000` silently disables hydration (native
  form submits, GET ?password=… URLs). Always use `localhost`.

## DoD sweep evidence
`grep -rn "badge-ok|badge-muted|badge-warn" web/src --include=*.tsx` → 0 matches;
no `.badge` classes remain in globals.css. Browser check: users + archived projects
render `.sb-badge`, legacy count 0.

## Open risks
- The dark-chrome app still runs until the tokens card merges; badges/bars look
  light-on-dark until then (deliberate: components reference names, not values —
  same approach as the DataTable card).
- StatusBar min-width floor (2px) can make segments sum to slightly more than 100%
  with many tiny statuses; acceptable for read-only display now, revisit with the
  runs slice if it ever backs a percentage readout.
- No dark-theme values exist yet for status tokens (§2.3 is the tokens card's scope);
  amendment's "pick text/icon colours per §2.3" will need a badge variant check when
  that lands.
