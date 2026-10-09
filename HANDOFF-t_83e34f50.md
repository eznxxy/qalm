# Handoff — t_83e34f50 (qalm-design-2d: shell polish + a11y sweep)

## Goal

Final design-system card: verify the whole §3 shell against DESIGN.md §3/§6/§8,
close the residue, and state whether the design system is fully implemented.

## Checklist (each item: pass / fixed)

- **Focus order sidebar → top bar → content; 2px brand ring everywhere** —
  PASS, verified by code inspection + live DOM walk (skip link → topbar
  brand/switcher/search/?/avatar → sidebar toggle + nav → screen content).
  The §8 ring is one global rule (`a/button/input/select/textarea/[role=
  button]/summary/[tabindex]:focus-visible` → `outline: 2px var(--accent)`,
  offset 2) plus restatements where `font:inherit` or table cells override it
  (`.linklike`, DataTable cells). Live check: `2px solid rgb(38,63,160)
  offset 2px` on a nav link.
- **prefers-reduced-motion** — FIXED. The chevron rotation (t_df4894c3) and
  the DataTable skeleton pulse were already gated behind
  `no-preference`; the rail width change was not — added a 120ms
  `flex-basis/width` transition under `@media (prefers-reduced-motion:
  no-preference)`, so reduced-motion users get instant collapse/expand.
  There are no other shell animations (nav transitions are route swaps).
- **§6 states at shell level** —
  - saving/saved mount: FIXED — `#shell-save-indicator` (`role="status"`,
    aria-live polite, `.topbar-save-slot`, hidden while empty) in the top
    bar. Visual mount point only; no autosave exists yet, per the card.
    First screen with save behaviour mounts "Saving…"/"Saved" into it
    (a portal or `document.getElementById` render is fine — the slot is
    stable).
  - error boundary with Retry: FIXED — new `web/src/app/(app)/error.tsx`
    wraps the (app) segment's pages below the layout, so a screen crash
    keeps the §3 chrome intact. §6 copy ("Couldn't load this page. Check
    your connection and retry."), `role="alert"`, Retry calls the
    framework `retry` (Next 16 signature — bundled docs; NOT `reset`).
    digest shown as "Error reference" for log correlation.
- **Sidebar ARIA** — PASS (was already right from 2a/2b; verified):
  `<nav aria-label="Main navigation">` landmark; `aria-current="page"` on
  the active item (unit-tested); collapse button has `aria-expanded` and a
  visible label that now FLIPS with state (fix below); icon-only rail keeps
  labels in the a11y tree (`display:none` spans + `title` attributes).
- **Project switcher** — FIXED for announcements. Keyboard operability was
  already free (native `<select>`). Added an sr-only `role="status"` live
  region ("Project: <name>") that announces the effective scope — including
  scope changes that never see a change event (?project= URL edits,
  back/forward, nav links). Live check: switching to Cart announces
  "Project: Cart" and rewrites ?project=p-cart.
- **Shell-level landmark sweep** — FIXED. The shell now owns the page's
  single `<main class="shell-main">`; the 10 screen-level
  `<main className="page">` were demoted to `<div>` (5 files) — a page
  exposed two main landmarks before this card. The search `<form
  role="search">` gained an accessible name (unnamed landmarks are noise in
  the rotor). Live check: exactly one `main`, one `navigation`, one
  `search`, one `banner`.
- **Sidebar collapse accessible name** — FIXED. The button's visible label
  (its accessible name) said "Collapse sidebar" in both states; it now
  reads Expand/Collapse from `collapsed`, matching the existing
  `aria-expanded` and `title`. In the icon rail it is the sr-only fallback.

## Verification (SPEED MODE: code inspection + spot-checks)

- Unit + a11y smoke: jest **247/247 across 16 suites** (+5: landmark
  structure incl. exactly-one-main, save slot present/empty/announced,
  switcher announcement from URL scope and after a change, error fallback
  renders + Retry calls retry). Collapse tests updated for the flipping
  label.
- `npx eslint src --max-warnings=0` → 0 findings; `npx tsc --noEmit` →
  clean; `next build` → green, same route shapes (8 static + 2 PPR).
- Live on a rebuilt prod build (this branch) against the stub API
  (:3000 / :3001): DOM focus-order walk, landmark counts, live-region
  announcement on switch, computed focus ring, collapse label flip. One
  after-screenshot: `shots/t_83e34f50-shell-1440.png` (vision-checked: top
  bar complete, single content area, no glitches; no active nav item on
  /projects is correct — §3's nav has no Projects entry).
- Screen-reader smoke (spot-check, per the card's speed note): structural
  SR semantics verified via the accessibility tree implications of the DOM
  (landmark roles, aria-current, labelled controls, polite live regions);
  no physical NVMA/VoiceOver run was available in this environment.

## Files changed

- `web/src/components/app-shell.tsx` — main landmark, named search
  landmark, save-slot mount, switcher live region, flipping collapse label
- `web/src/app/(app)/error.tsx` (new) — content-area error boundary
- `web/src/app/globals.css` — `.shell-main`, `.topbar-save-slot`,
  `.shell-error`, reduced-motion sidebar transition
- `web/src/app/(app)/{projects,projects/[id],users,change-password,wip/[slug]}/page.tsx`
  — `<main className="page">` → `<div className="page">`
- `web/src/components/__tests__/app-shell.test.tsx` — +5 a11y tests,
  collapse-label expectations updated

## Assumptions

- The saving/saved indicator is a mount point only (card explicitly says
  visual mount is enough); its styling (muted caption) will be revisited
  when the first real consumer lands.
- Next 16's error.tsx `retry` prop (not `reset`) was confirmed against the
  bundled docs (`node_modules/next/dist/docs/.../error.md`), not training
  data.
- No active sidebar item on /projects, /users, /settings is by design —
  those routes are not §3 nav items.

## How to run and verify

1. `node web/scripts/contract-stub-api.mjs 3001` (bootstrap an admin on
   first run: 8+ chars, letter + digit)
2. `cd web && npm run build && npx next start -p 3000`
3. Log in at http://localhost:3000 (localhost, not 127.0.0.1 — Next 16
   cross-origin hydration block).
4. Keyboard-only pass: first Tab = "Skip to content"; Tab through top bar →
   sidebar → content; `?` opens the shortcuts dialog; collapse toggle
   announces Expand/Collapse correctly via screen reader.
5. Turn the project switcher with a screen reader on: "Project: <name>"
   is announced politely.
6. Emulate `prefers-reduced-motion: reduce` and toggle the sidebar: the
   rail snaps (no width animation).

## Open risks

- The streaming-residue quirk seen once after client-side login redirect
  (a hidden `main.auth-page` left in the body by Next's streaming runtime,
  outside the React root) is a Next 16 internal, not our markup; it is
  `display:none`, carries no focusables, and is gone after any full-page
  navigation. Watch it when the cases screen lands; not actionable here.
- First save-bearing screen must actually mount into `#shell-save-indicator`
  (nothing enforces it yet) — flagged for the result-form slice card.

## Design system status

**The shell-level design system is fully implemented per DESIGN.md** —
§2 tokens + light theme (t_62938355), §3 shell incl. responsive collapse
(t_a192444c, t_df4894c3), §7 shortcuts + help dialog (t_6ce021c1), and this
card's §6/§8 sweep. What remains is per-screen work that ships with its own
slice, not shell debt: §4 screens beyond Projects/Users (cases, runs, run
detail, plans, milestones, reports), the §5 primitives that only exist once
those screens need them (Tree, Tabs, Drawer), §2.3 dark theme (phase 2, out
of MVP scope per §11), and DataTable virtualisation (deliberately deferred,
documented on t_e3495ddb — both consumers paginate at 25 rows).
