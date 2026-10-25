# Qalm — Slice 2 Backlog: Test Suites & Cases

Status: APPROVED for planning (Arif answered the open questions, 2026-10-25).
Phase 0 (F1, F2) is done and merged. Phase 1 contracts were drafted on
2026-10-25 (`docs/PRD-suites-cases.md`, `docs/api-suites.md`,
`docs/api-cases.md`) and await Arif's approval before Phase 2 starts.
Owner routing: Daedalus (contracts), Hephaestus (server), Iris (web), Argus (QA).
Spec source: docs/DESIGN.md §4.2 (two-pane cases screen), MVP scope in AGENTS.md.

---

## Slice goal

The core of the app: a project-scoped tree of test suites containing test
cases, with the two-pane browse experience from DESIGN.md §4.2. After this
slice, a tester can organise cases inside a project; the next slice (runs)
consumes them.

---

## Phase 0 — prerequisites (small)

### Card 0.1 — Design-review follow-ups F1 + F2 (Iris, small)
- F1 (BUG): `app-shell.tsx:94` — `PROJECT_SWITCHER_LIMIT = 200` exceeds the
  contract cap (`limit ≤ 100`) → switcher 400s once >100 projects. Fix: limit 100.
- F2 (SPEC): create `web/src/lib/dates.ts` (locale + user timezone, relative
  <7d rule per amended §9) and route `projects/[id]/page.tsx` through it.
- DoD: switcher works with 150 projects; dates render in user locale; gates green.

### Card 0.2 — DESIGN.md notes cleanup (Daedalus, small)
Decide and write down (docs only):
- N1: uppercase/letter-spacing on `.help-dialog h3` and `.project-key-input` —
  amend §2.4 (ID-like data exemption) or restyle.
- N3: row height is min-height, wraps exceed 36px — pick fixed-clipped vs
  line-clamp for the cases table (will matter immediately).
- N4/N7/N8: document spoken-order rule for runs slice; sidebar Projects entry
  decision; root-forward `?project=` handling.

---

## Phase 1 — contracts (Daedalus)

### Card 1.1 — PRD: suites & cases (docs/PRD-suites-cases.md)
- Suite: name, description, parent suite (nesting, **capped at 3 levels**),
  project-scoped; ordering.
- Case: title, preconditions, steps (ordered: step + expected result),
  priority (Critical/High/Medium/Low), type (**fixed list for MVP: Functional,
  Regression, Smoke, Exploratory, Other — revisit as project-configurable
  post-MVP**), tags, estimate (**numeric, in minutes**); belongs to a suite;
  case IDs `C1042` (project-scoped counter).
- Roles: who can create/edit/delete suites and cases (proposal: Admin+Lead
  write, Tester+Viewer read — matches projects pattern).
- Delete semantics: deleting a suite with cases **is blocked** (must be empty;
  cases moved or deleted first). Deleting a case = confirm dialog, results
  history kept per DESIGN.md §6.
- Acceptance criteria per feature.

### Card 1.2 — API contract: suites & cases (docs/api-suites.md, docs/api-cases.md)
- Endpoints: suites CRUD + tree listing (project-scoped), cases CRUD + list
  within suite, bulk move cases between suites, case history (read-only).
- Pagination for cases list (large suites), filters (priority/type/tag).
- Key shapes: tree payload (**max depth 3**), step array validation,
  ID allocation scheme, error codes; estimate is integer minutes.
- Consistency with api-conventions.md (envelopes, errors, pagination, roles).

---

## Phase 2 — backend (Hephaestus)

### Card 2.1 — Suites: DB migration + API (small/medium)
- Migration: `suites` table (self-referencing parent_id, project_id FK,
  ordering), indexes for tree queries.
- Endpoints per contract 1.2: CRUD + tree listing.
- Unit + e2e tests per module; migrations up/down clean.

### Card 2.2 — Cases: DB migration + API (medium)
- Migration: `cases` table + `case_steps` (ordered), project-scoped case
  counter for `C####` IDs, tags (jsonb or join table — per contract).
- Endpoints: CRUD, list w/ pagination + filters, bulk move.
- Case history table (who changed what, when — minimal audit per PRD).
- Unit + e2e tests; lint/tsc clean.

---

## Phase 3 — frontend (Iris)

### Card 3.1 — Suites tree component (medium)
- ARIA treeview per DESIGN.md §5: arrow keys, counts right-aligned, drag
  handle, expand/collapse states.
- Consumes the suites tree API; keyboard + drag both work.

### Card 3.2 — Two-pane cases screen (medium/large)
- §4.2 layout: tree 280px left, case list right (DataTable from slice 1),
  filter bar (priority/type/tags), bulk action bar on selection.
- Case detail drawer (480px, tabs: Details/History/Linked-runs placeholder).
- All §6 states; URL-as-state for selected suite/filters.

### Card 3.3 — Case editor (medium)
- Create/edit form: title, preconditions, steps editor (reorderable rows:
  step + expected), priority/type/tags/estimate fields per contract.
- Validation per contract; errors inline per DESIGN.md form rules.

---

## Phase 4 — QA (Argus)

### Card 4.1 — E2E verification of suites & cases
- Bring up stack; verify PRD acceptance criteria as each role.
- Verify tree operations (create/nest/move/delete guards), case CRUD,
  steps editor, filters, pagination, bulk move, history entries.
- Report + failure cards if any.

---

## Sizing summary

| Phase | Cards | Est. total |
|---|---|---|
| 0 — prerequisites | 2 small | ~1h |
| 1 — contracts | 2 (docs) | ~1–2h |
| 2 — backend | 2 medium | ~2–3h |
| 3 — frontend | 3 medium/large | ~3–4h |
| 4 — QA | 1 | ~1h |
| **Total** | **10 cards** | **~8–11h agent time** |

Phases 2 and 3 can partially overlap (Iris builds tree against the contract
while Hephaestus finishes cases API — same pattern as slice 1).

---

## Decisions (Arif, 2026-10-25)

1. **Suite nesting** — capped at 3 levels for MVP. Server rejects a create/move
   that would exceed depth 3 (contract error, e.g. 400 `DEPTH_LIMIT_EXCEEDED`);
   the tree UI disables "Add suite" at depth 3.
2. **Deleting a non-empty suite** — blocked. DELETE returns 409/400 with a
   "move or delete its cases first" message; no cascade, no fallback suite.
3. **Case types** — fixed list for MVP: Functional, Regression, Smoke,
   Exploratory, Other. Stored as an enum-less string so a per-project list can
   replace it post-MVP without a migration.
4. **Estimate** — numeric, in minutes (integer ≥ 0). UI accepts `90` or `1h 30m`
   and normalises to minutes on save.
