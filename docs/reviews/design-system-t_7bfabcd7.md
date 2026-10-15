# Design-system review — t_7bfabcd7 (2026-10-16)

Reviewer: Daedalus. Spec: `docs/DESIGN.md` (amended in 6e0dd78).
Target: master @ 04a6a63 (merge tip 68c52c6 = design-2d).

## Verdict: PASS WITH NOTES — no FAIL. The "design system fully
implemented" claim is confirmed for the implemented surface (tokens,
typography, status components, DataTable, shell, shortcuts), with two
spec violations and several notes to resolve before the cases/runs
screens build on it.

## Gates (run by me on master, not trusted from merge reports)

| Gate | Result |
|---|---|
| jest | 247/247, 16 suites |
| eslint | clean (0 problems) |
| tsc --noEmit | clean |
| next build | green (10 routes, PPR) |

Follow-up cards: F1 → t_5c2b7488, F2 → t_c0da9abe,
N1+N3 (decisions amended into DESIGN.md) → t_f427c73d,
N2+N6 (+N7/N8 rule) → t_d54d04db.

Runtime: API :3002 + web dev + scratch DB `qalm_design_review`
(migrations applied, bootstrapped admin, 9 projects, 3 users seeded).
All findings below reproduced against that live stack.

## Area verdicts

1. Tokens — PASS. All §2.1/§2.2/§2.5 tokens present in
   `tokens.css`; ink-500 = #5C6B82 per amendment; dark placeholder
   block under `[data-theme="dark"]` covers every token; spacing,
   radius and elevation tokens match §2.5. Hex grep over src finds
   only a doc comment (#C23A3A inside StatusBadge's docblock) — no
   hard-coded colour in any rule. Globals.css adds semantic aliases
   (--bg/--text/--accent) that resolve into §2 tokens; acceptable.
2. Typography — PASS. IBM Plex Sans 400/500/600 self-hosted via
   next/font, spec fallback stack, applied app-wide; type scale
   (22/28 h1, 16/24 h2, 14/20 body, 13/18 headers 600 ink-700,
   12/16 captions ink-500) verified in computed styles; tabular-nums
   on tables/counts/IDs; focus ring 2px --brand 2px offset verified
   live. Two letter-spacing/uppercase violations — see N1.
3. Status components — PASS. StatusBadge matches the amended §2.2
   exactly (verified in computed styles on /users: ink-900 500 text
   on tints; solid icon per status; skipped icon ink-700; 22px/4px).
   StatusBar: segment order per §5, role=img + aria-label, 8/16px,
   2px min segment width; SPEAK_ORDER deviation is a documented,
   reasonable reading (severity order) — accepted, see N4.
   PriorityIcon: chevrons/dash, ink-700 + critical --failed — has no
   consumer yet (no priority data in the app) — N5.
4. DataTable — PASS with notes. Sticky header, real-button sort with
   aria-sort + SR hints, selection incl. indeterminate (attr + DOM
   property), 36/32/44 densities via --dt-row-height, §6 states with
   skeleton tbody role=status, <768 in-container scroll (verified:
   no page h-scroll at 768). Notes: N2 (nested tbody = invalid HTML,
   sibling CSS selectors dead) and N3 (rows grow past 36 with
   wrapped content; 36 behaves as min-height).
5. App shell — PASS with notes. 48px top bar (verified 48), 232px
   sidebar (verified 232→56 on toggle), collapse persisted in
   localStorage + pre-paint script (no flash), matchMedia listener
   collapses live at ≤1279 (verified at 1000/1024), --brand-tint +
   2px --brand active nav, auth screens outside the shell with 40px
   controls, single <main>, save-slot, (app) error.tsx with Retry,
   reduced-motion respected (0s transition under emulation).
   Notes: N6 (switcher limit=200 → contract 400 → "Projects
   unavailable", FAIL-grade UX bug), N7 (no active nav item on
   /projects), N8 (default landing forward drops ?project= scope).
6. Keyboard — PASS. Verified live: `/` → topbar search, `n` opens
   create form + focuses first field, `g c` → /wip/cases (scope
   carried), `?` opens dialog (aria-modal, labelled), capture-phase
   shield blocks g-c under the dialog, Tab trapped, Esc closes and
   restores focus to the `?` button. `n` is projects-only today, as
   designed for the current surface.

## Findings for Iris (becoming follow-up cards)

F1 (BUG, fix before cases screen) — `app-shell.tsx:94`:
`PROJECT_SWITCHER_LIMIT = 200` comments "api-conventions.md hard
cap", but the contract cap is `limit ≤ 100` (api-conventions.md:34).
GET /projects?limit=200 returns 400 VALIDATION_ERROR, so the top-bar
switcher shows "Projects unavailable" forever while the page table
works. Reproduced: curl 400 + live switcher. Fix: limit 100.
Card: t_5c2b7488.

F2 (SPEC VIOLATION, small) — amended §9 (t_5fa1c284) requires all
dates through `web/src/lib/dates.ts` (locale + user timezone; the
only allowed Intl site). The file does not exist, and
`projects/[id]/page.tsx` has a local `formatDateTime` hard-coding
`timeZone: "UTC"` (renders "4:26 PM" when the user's local time is
00:26). Create `lib/dates.ts` and route the detail page through it.
Card: t_c0da9abe.

N1 — §2.4 "sentence case everywhere, no all-caps labels, no
letter-spacing tricks" violated twice in globals.css:
`.help-dialog h3` (uppercase + 0.04em) and `.project-key-input`
(uppercase + 0.05em). Decision (amended into §2.4): the rule covers
labels and prose; identifiers typed/read as a code (case IDs,
project keys) may be uppercase mono — `.project-key-input` stays,
`.help-dialog h3` reverts to sentence case. Card: t_f427c73d.

N2 — DataTable.tsx:418: skeleton `<tbody role=status>` renders
nested INSIDE the data `<tbody>` (invalid HTML; browsers/serializers
may re-parent it). The guard CSS `.dt-table >
tbody.dt-skeleton-tbody:hover ~ tbody …` in DataTable.css can never
match the actual DOM. Unwrap the nested tbody (conditional sibling,
or render skeleton rows inside the single tbody with role=status on
the tbody). Card: t_d54d04db.

N3 — Row height: §2.5 defines 36/32/44 row heights; td height
behaves as min-height, so any wrapping cell (2-line description =
40px content) yields 41px rows. At 1440 with the current copy every
projects row renders 41px. Decision (amended into §2.5): row height
is a floor, not a clip — rows grow with wrapped content; tables that
must hold the line clamp long cells (descriptions) to one line with
ellipsis + title. Card: t_f427c73d (also fixes the live 41px rows in
the projects table via the description clamp).

N4 — StatusBar aria-label speaks in severity order
(passed, failed, blocked, retest, skipped, untested) while segments
render in §5 order. Documented in-code; accepted. Note for the runs
slice: the §4.4 headline copy must match this spoken order.

N5 — PriorityIcon has no consumer yet. When cases land, wire it in
the cases table + filter chips; keep the icon visible next to the
word in tables (§1.3). No card — for the future cases slice.

N6 — Top-bar search is wired to /projects?query=… (fine for now);
its placeholder says "Search cases, runs…" while it searches
projects — re-wire when cases search lands or copy "Search projects"
until then. Copy fix: card t_d54d04db.

N7 — No sidebar item highlights on /projects (nav has no Projects
entry; §3's sidebar list is project-feature-scoped). Consider a
Projects/Overview entry or an agreed rule that non-sidebar screens
have no active item.
N8 — `/` root forwards to /projects dropping `?project=` (per-screen
scope re-applies after the switcher loads; cosmetic).
Projects also aren't yet reachable from the sidebar (Users is) —
fold into N7's decision.
N7/N8 decision (no code change): non-sidebar screens carry no active
nav item; no Projects sidebar entry for MVP; the dropped `?project=`
on the root forward is accepted. Recorded in card t_d54d04db.

## Not reviewed (out of scope per card)
Dark theme values (placeholders by design, §2.3/§11), virtualisation
(deliberately deferred, documented in the DataTable handoff — both
consumers paginate at 25 « 200 threshold), tree/drawer/tabs (not
built), speed-mode per-card history (trusted via final-state
verification here).

## Visual evidence
/tmp/qalm-dr/shots/: login-1440, projects-1440, projects-1440-
collapsed, projects-1024, projects-768, users-1440,
project-detail-1440, wip-runs-1440.
