# Qalm — Slice 3 Backlog: Test Plans & Runs

Status: **APPROVED for planning** (Arif signed off all ten proposals,
2026-10-26). Phase 1 contracts are **approved**: `docs/PRD-plans-runs.md`,
`docs/api-runs.md`, `docs/api-plans.md`. Next: Phase 2 backend, then Phase 3
frontend (they overlap against the frozen contract, as in slice 2).
Owner routing: Daedalus (contracts), Hephaestus (server), Iris (web), Argus
(QA). Spec source: `docs/PRD-plans-runs.md` + `docs/api-runs.md` +
`docs/api-plans.md` + `docs/DESIGN.md` §4.3/§4.4/§4.5 (and §5, §6, §8, §9).

---

## Slice goal

A case is a definition; a run is evidence. After this slice a team can select
cases into a run, assign them, execute them and record what happened
(Passed / Failed / Blocked / Retest / Skipped) with a comment, time, defect link
and attachments — and read progress from a status bar anywhere a run or plan
appears. This is the data every remaining MVP slice (milestones, dashboards,
CSV export) reads from.

Out of scope: milestones, reports/dashboards, CSV, integrations, custom result
statuses, external file storage.

---

## Phase 1 — contracts (Daedalus) — DONE 2026-10-26

### Card 1.1 — PRD + API contracts (docs) — DONE
- `docs/PRD-plans-runs.md` (14 acceptance criteria, 10 decisions),
  `docs/api-runs.md` (runs, items, results, attachments, close/reopen, bulk
  assign, `GET /cases/:id/runs`), `docs/api-plans.md`.
- `docs/README.md` slice index updated.

---

## Phase 2 — backend (Hephaestus)

### Card 2.1 — Slice-3 schema + runs & items API (large) — PENDING
- **Migration** `20261026000001_runs_schema.js`, all five tables in one step
  (as slice 2 landed `cases` with 2.1, because counts need the child tables):
  `plans`, `runs`, `run_items`, `results`, `result_attachments` — columns,
  checks, indexes and FKs exactly as in `api-runs.md` / `api-plans.md`
  "Implementation notes". Partial unique indexes where `deleted_at is null`;
  `run_items` partial unique `(run_id, case_id)`; `results` check
  "failed ⇒ comment non-empty"; `run_items.case_steps jsonb`.
- **Endpoints**: `GET/POST /projects/:projectId/runs`, `GET/PATCH/DELETE
  /runs/:id`, `POST /runs/:id/close`, `POST /runs/:id/reopen`,
  `GET /runs/:id/items`, `GET /runs/:id/items/:itemId`, `POST /runs/:id/items`,
  `PATCH /runs/:id/items/:itemId`, `POST /runs/:id/assign`,
  `DELETE /runs/:id/items/:itemId`.
- **Selection materialisation**: union of explicit `case_ids` and the suite
  subtree (reuse the slice-2 recursive CTE, `include_descendants`), de-duped,
  one `run_items` row per live case with the case snapshot, `position` by
  `case_number`. Cap 2,000 items (400 beyond).
- **Latest-status derivation**: lateral join to newest `results` row per item
  (no stored `status` on `run_items`); counts + `percent_complete` per
  `api-runs.md`.
- **Item status/counts before results exist** read as all-`untested` — 2.2
  wires results in; design the queries so 2.2 only adds the join.
- Tests: `run-counts.spec.ts` (pure rollup/percent rules),
  `runs.service.spec.ts` (selection de-dup, cap, close/reopen guard, item
  delete-with-results 409), `dto.spec.ts`, `test/runs.e2e-spec.ts`.
- DoD: endpoints per contract; unit + e2e green; lint/tsc/build clean.

### Card 2.2 — Results & attachments (large) — PENDING
- **No new migration** (2.1 created `results`/`result_attachments`).
- **Endpoints**: `POST /runs/:id/items/:itemId/results`,
  `GET /runs/:id/items/:itemId/results`, `PATCH /results/:id`,
  `POST /results/:id/attachments`, `GET /attachments/:id`,
  `DELETE /attachments/:id`.
- **Rules**: `failed` requires a comment (400 naming `comment`); run must be
  `open` (409 otherwise); Tester may only write an item assigned to them (403);
  status is immutable on PATCH; only the item's **latest** result is editable /
  attachable (409 otherwise).
- **Attachments storage**: `STORAGE_DIR` env (default `./storage`), bytes at
  `<STORAGE_DIR>/attachments/<projectId>/<attachmentId>`, metadata row in the
  same request; serve only through `GET /attachments/:id` (401 without token);
  no static route. Add the storage dir to `.gitignore`; never log the path.
  Limits: type allow-list, ≤ 10 MB, max 5 per result.
- Wire `results` into the run/plan counts (2.1 left them all-untested).
- Tests: `results.service.spec.ts` (failed-without-comment, immutability,
  latest-only edit, Tester guard, completed-run 409), attachment unit +
  `test/results.e2e-spec.ts` (upload → download → 401 without token → limits).
- DoD: green unit + e2e; a stored file survives a restart; no secrets in code
  or logs.

### Card 2.3 — Plans, rollups & linked runs (medium) — PENDING
- **Endpoints**: `GET/POST /projects/:projectId/plans`,
  `GET/PATCH/DELETE /plans/:id`.
- Plan delete detaches its runs (`plan_id = null`) in the same transaction.
- `plan.counts` / `run_count` rollup and run-list `assignee_ids` via grouped
  aggregates per page (no per-row queries).
- `GET /cases/:id/runs` — runs containing a case, newest first, excluding
  soft-deleted runs (fills the drawer's Linked runs tab).
- Tests: `plans.service.spec.ts` (unique name, detach-on-delete, rollup),
  `test/plans.e2e-spec.ts`, `test/case-runs.e2e-spec.ts`.

---

## Phase 3 — frontend (Iris)

Read `web/node_modules/next/dist/docs/` before writing code (this Next.js has
breaking changes vs. older versions — see `web/AGENTS.md`). Reuse the existing
primitives: `StatusBar`, `StatusBadge`, `PriorityIcon`, `DataTable`, `Drawer`,
`Combobox`, `Dialog` from `web/src/components/ui/`.

### Card 3.1 — Runs list screen (medium) — PENDING
- Route `/runs` (project-scoped), replacing the `/wip/runs` placeholder; update
  the shell shortcut/`g r` target and the app-shell test.
- §4.3 table: name, plan, **status bar** (per row, from `counts`), `% complete`,
  assignee(s), due date; `Open`/`Completed` filter; empty/loading/error/no-perm
  states (§6).
- **New run** dialog: name, description, plan (optional), due date, and a case
  selection (explicit cases and/or a suite + descendants); POST then open the
  run.

### Card 3.2 — Run detail + result drawer (large — the most-used screen) — PENDING
- Route `/runs/[id]`: header (name, status bar + "62% done · N passed · …",
  `[Assign] [Close run]`/`[Reopen]`), filter bar (Status / Assignee / Section /
  search, §4.4), items table (ID `C####`, title, Status badge, assignee,
  Updated).
- Result **drawer** (480px): case steps, `[Add result]` form — status segmented
  buttons with `P F B R S`, comment (`failed` ⇒ required, shown **inline**),
  elapsed time, defect link, attachment drop-zone; "Save and next"
  (`Ctrl+Enter`) advances to the next `untested` row; item result history.
- Assign / bulk assign; remove item (disabled with a reason once results exist).

### Card 3.3 — Plans screen (medium) — PENDING
- Route `/plans` replacing `/wip/plans`; plans table with an aggregate status
  bar; plan detail listing its runs (reuses the runs table); New/Edit/Delete
  plan (delete confirm names the "runs will be kept" consequence).

### Card 3.4 — Cases ↔ runs integration (small/medium) — PENDING
- Cases bulk bar: wire **Add to run** (§4.2) to `POST /runs/:id/items`.
- Replace the `CaseDrawer` "Linked runs" placeholder with the real list from
  `GET /cases/:id/runs`.
- Update the shell search placeholder/`g r`/`g p` targets and the help dialog
  once the routes are real.

---

## Phase 4 — QA (Argus)

### Card 4.1 — E2E verification of plans & runs (medium) — PENDING
- Bring up the stack; verify PRD acceptance criteria 1–14 as each role
  (Admin/Lead/Tester/Viewer), UI end-to-end only (no DevTools, console, network
  or API probing).
- Cover: run creation selection, de-dup, status bar exactness, failed-comment
  requirement, Tester-on-assigned-item, append-only results, Save-and-next +
  shortcuts, close/reopen guard, item add/remove guard, attachment upload +
  survives reload, plan rollup + detach-on-delete, Linked runs tab, §6 states.
- Report + failure cards with repro steps if any.

---

## Sizing summary

| Phase | Cards | Est. total |
|---|---|---|
| 1 — contracts | 1 (docs) | done |
| 2 — backend | 3 (2 large, 1 medium) | ~5–7h |
| 3 — frontend | 4 (1 large, 2 medium, 1 small) | ~6–8h |
| 4 — QA | 1 | ~1–1.5h |
| **Total** | **9 cards** | **~12–17h agent time** |

Phases 2 and 3 overlap: Iris builds the runs list and plans screen against the
frozen contract while Hephaestus finishes results/attachments. Card 3.2 (run
detail) is the long pole on the frontend and needs 2.2 in place first.