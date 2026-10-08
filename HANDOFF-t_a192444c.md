# Handoff — t_a192444c (qalm-design-2a: app shell scaffold)

Branch: `feature/t_a192444c-app-shell` (local, stacked on the design stack tip `85aeb73` = tokens + typography + badges + DataTable; master does NOT carry the prerequisites). Tip: `0c58e34`, 4 commits.

## Goal

DESIGN.md §3 shell as scaffolding: 48px top bar (brand, project switcher, search, help, avatar), 232px sidebar (§3 items, active = --brand-tint + 2px --brand bar, collapse to 56px icons below 1280), not-yet-built sections on a one-sentence placeholder, auth screens outside the shell (40px controls), users + projects migrated into the full-width content area.

## Files changed

- `web/src/app/layout.tsx` — root layout stripped to SessionProvider (chrome-less)
- `web/src/app/(app)/layout.tsx` — NEW: AppShell + RequireAuth + banner slot
- `web/src/app/(auth)/layout.tsx`, `(auth)/login/page.tsx` — NEW group: login renders outside the shell
- `web/src/components/app-shell.tsx` — NEW: the shell (top bar, sidebar, project scope, avatar menu)
- `web/src/components/require-auth.tsx` — gate now Suspense-wraps its usePathname (Next 16 prerender req)
- `web/src/app/(app)/wip/[slug]/page.tsx` — NEW §6 placeholder (one sentence, no fake screens)
- `web/src/app/(app)/{users,projects,projects/[id],page,change-password}` — moved; pages export directly; per-page RequireAuth/Suspense wrappers removed (layout owns both)
- `web/src/app/globals.css` — shell CSS block replaces .app-nav; .page uncentred (max-width none); banner full-width; auth 40px controls; collapse breakpoint max-width 1279px
- `web/src/components/app-nav.tsx` — DELETED
- Tests: `app-shell.test.tsx` NEW (15 tests), `role-gating.test.tsx` rewritten (shell replaces nav; gate covered), page suites updated (imports, gate+page pairing)
- `shots/t_a192444c-final-shell-1440.png` — vision-checked final screenshot

## Assumptions / decisions (flag for Daedalus)

1. **Users in the sidebar (admin-only):** §3 has no Users item, but the old nav linked to /users — without it, admin user management was unreachable. Added as an admin-only item below the separator, next to Settings. Its final home (likely Settings) is an IA decision for Daedalus.
2. **Project scope = `?project=<id>` URL param** (shareable, survives reload; top-bar switcher writes it, sidebar links carry it). Screens are not yet project-scoped readers; that lands with the screens themselves.
3. **Unbuilt sections route to `/wip/[slug]`** (real 200 route) instead of 404ing on `/cases` etc. When real screens land, they replace the routes and the sidebar hrefs flip to the real paths (one line each in `navGroups`).
4. **Route groups (`(app)`/`(auth)`) for inside/outside the shell** — standard Next 16 mechanism, confirmed against the bundled docs; full page loads between groups are a known Next trade-off (login → app only).
5. **Next 16 finding:** `use(params)` on an async server-page param NEVER retries under jsdom — tested via probe and abandoned; the placeholder reads `useParams` (client) like the detail screen does. Anyone adding async-params pages should unit-test the shape, not assume act() flushes it.

## How to run and verify

```bash
cd web && npm run build && npx next start -p 3000 &
node scripts/contract-stub-api.mjs 3001   # then bootstrap or use existing seed
```
Login (bootstrap admin) → lands on /projects inside the shell: sidebar 232px, top bar 48px, switcher lists the stub's 5 projects and writes `?project=`, search submits to /projects?query=, avatar menu (account settings, logout), Users item only for admins, Overview/Cases/Runs/Plans/Milestones/Reports → one-sentence placeholder, Settings → placeholder. At ≤1279px wide the sidebar collapses to a 56px icon rail (labels stay for screen readers); at exactly 1280 it is full. Login keeps 40px controls and no chrome. Keyboard: first Tab = "Skip to content"; focus ring is 2px --brand, 2px offset everywhere.

Gates at tip: eslint 0 findings, tsc clean (inside next build), jest 197/197 (14 suites), `next build` green — 8 static + 2 partial-prerender routes.

## Open risks

- Sub-1280 breakpoints (1024 rail check, 768 read-only) are OUT OF SCOPE here (follow-up card); only the 1280 collapse ships.
- Search wiring is the card's "if trivial" case: submits to the projects list with `?query=`; no case/run search until those resources exist.
- The stub API's in-memory state resets on restart (bootstrap again if 409 "bootstrap is closed" appears after a restart with a fresh process — actually the opposite: state is empty on restart, bootstrap reopens).
- Push gate: branch is local-only like the rest of the stack; `QALM_PUSH_APPROVED=1 git push -u origin feature/t_a192444c-app-shell` when Arif approves.
