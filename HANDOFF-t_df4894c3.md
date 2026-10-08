# Handoff — t_df4894c3 (qalm-design-2b: shell responsive breakpoints)

Branch: `feature/t_df4894c3-shell-breakpoints` (stacked on the 2a shell,
`feature/t_a192444c-app-shell` @ ca1d1a3). Local commits, push gated as usual:
`QALM_PUSH_APPROVED=1 git push -u origin feature/t_df4894c3-shell-breakpoints`.

## Goal

DESIGN.md §3 breakpoints on the 2a shell: 1280+ full layout; 1024 sidebar
auto-collapsed to the 56px icon rail with the state persisted in localStorage;
below 768 read-only friendly (tables scroll inside their own container, never
the page body). Check every existing screen at 1440/1024/768; fix layout
breakage only.

## Files changed

- `web/src/lib/use-sidebar-collapse.ts` (new) — collapse state: stored
  preference (`localStorage["qalm.sidebar.collapsed"]`, "1"/"0") wins over the
  `(max-width: 1279px)` media query; writes the `sidebar-collapsed` class on
  `<html>` and mirrors it into React state for the toggle button.
- `web/src/components/app-shell.tsx` — pre-paint inline script (no 232px
  flash on load), sidebar toggle button (chevron, `aria-expanded`, `title`),
  `sidebar-collapsed` class now drives the rail. Also fixes the 2a inversion:
  the project switcher was `disabled` exactly when the project list was ready
  (`disabled={!switcherStatus}`); it is now disabled only while loading /
  error / empty, with regression tests.
- `web/src/app/globals.css` — the 1279px media query became the
  `html.sidebar-collapsed` class (JS breakpoint is the single source of
  truth); `.sidebar-toggle` styles (reduced-motion respected). Below 768:
  body overflow-x guard, `.shell-content` held at the viewport width,
  `.page` padding tightened, `.toolbar .field` stacks. Below 576: the top
  bar wraps to two rows instead of overflowing. Removed the dead
  `.users-table` CSS (both screens are on DataTable since t_10da9c7a),
  including its 640px block that reflowed tables into the page body — the
  exact behaviour §3 forbids.
- `web/src/components/__tests__/app-shell.test.tsx` — 8 new collapse tests
  (auto-collapse/restore, persistence across mounts, explicit-over-breakpoint
  both ways, keyboard reachability in the rail) + 2 switcher regression tests;
  matchMedia stub with live `matches` getter.
- `web/jest.setup.ts` — jsdom `matchMedia` polyfill (role-gating suite renders
  the shell and needed it too).

## Assumptions

- An explicit collapse preference wins over the breakpoint at any width
  (expanded at 1024 stays expanded; collapsed at 1440 stays collapsed) —
  that is what "state persists" means mechanically; flip it in
  `use-sidebar-collapse.ts` if Daedalus wants breakpoint-forced rails.
- localStorage is per-browser, not per-user: the stub has one login per
  browser profile, so no user key suffix. Real multi-user sessions may want
  `qalm.sidebar.collapsed.<userId>` later.
- Removing the `.users-table` CSS: zero references in `src/` (screens moved
  to DataTable in t_10da9c7a); its 640px block contradicted this card's DoD.

## How to run and verify

1. `node web/scripts/contract-stub-api.mjs 3001` (bootstrap an admin on first
   run: any 8+ char password with a letter and a digit)
2. `cd web && npm run build && npx next start -p 3000` (or `npm run dev`)
3. Log in at http://localhost:3000 (use localhost, not 127.0.0.1 — Next 16
   cross-origin hydration block).
4. DevTools 1440: sidebar 232px, toggle present (`aria-expanded=true`).
5. 1024 (or any ≤1279): rail collapses to 56px icons; toggle clicks persist
   across reloads via localStorage; the toggle is the first sidebar control.
6. 768 / 390: no horizontal page scroll on /login, /projects, /users,
   /wip/cases; tables scroll inside their `.dt-root` container (give the
   users table >1 row to see the inner scrollbar).

Verified live (prod build, restart after `next build`): page overflow 0 at
1440/1024/768/390 on /login (40px auth controls intact), /projects, /users,
/wip/cases; sidebar 232@1440, 56@1024/768; toggle→`1`→reload keeps rail,
expand→`0`→reload keeps 232px; switcher enabled with 5 stub projects.
Artifact: `shots/t_df4894c3-projects-1024-collapsed.png` (vision-checked:
icon rail, chevron toggle, intact top bar/table, no clipping).

Gates: eslint 0 findings · tsc clean (inside next build) · jest 205/205
(14 suites, 10 new tests) · next build green (same 8 static + 2
partial-prerender routes as 2a).

## Open risks / flags for Daedalus

- **2a carryover (fixed here, review the fix):** the switcher inversion
  `disabled={!switcherStatus}` shipped in 2a and survived its gates because
  `fireEvent` bypasses jsdom disabled-semantics; 2a's live probe drove the URL
  instead of the control. Two regression tests now pin the behaviour.
- The stub on :3001 was restarted (bootstrap was closed on the long-lived
  instance; no seed credentials existed in its memory). It is stateless test
  infrastructure — but if another card's browser session was logged into the
  old instance, its refresh cookie is now invalid: just log in again.
- Sidebar collapse state is per-browser, not per-user (see Assumptions).
- Top bar wrap below 576px is layout survival, not a mobile design — §4
  mobile patterns are a later card.
