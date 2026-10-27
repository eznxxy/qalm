# Qalm — Slice 4 Backlog: Milestones

Status: **in progress** (2026-10-27). Phase 1 contracts are approved
(`docs/PRD-milestones.md`, `docs/api-milestones.md`, plus the additive run link
in `docs/api-runs.md` and the note in `docs/api-plans.md`).
Owner routing: Daedalus (contracts), Hephaestus (server), Iris (web), Argus
(QA). Spec source: `docs/PRD-milestones.md` + `docs/api-milestones.md` +
`docs/api-runs.md` + `docs/DESIGN.md` §4.3/§4.5/§5/§6/§7/§8/§9.

---

## Slice goal

Runs already say what was tested and plans group runs, but a release is a
dated checkpoint across several runs. After this slice a team can create a
milestone per project, attach existing runs to it (one milestone per run), read
the same rollup a plan shows, and see days left — with completion derived from
the runs, never set by hand.

Out of scope: milestone membership for plans, a stored open/closed state,
reminders, burndown/velocity, templates, per-milestone permissions, custom
fields, and date rules between a run and its milestone (PRD decisions 1–9).

---

## Phase 1 — contracts (Daedalus) — DONE 2026-10-27

### Card 1.1 — PRD + API contract + additive run link (small/medium) — DONE
- `docs/PRD-milestones.md` (13 acceptance criteria, 9 decisions),
  `docs/api-milestones.md` (one resource, seven endpoints, role matrix,
  implementation notes).
- Additive edits: `docs/api-runs.md` (`milestone_id`/`milestone_name`,
  `?milestone_id=` including `none`, create/PATCH rules), `docs/api-plans.md`
  (an embedded run rejects `milestone_id`), `docs/DESIGN.md` §4.3/§4.5/§7,
  `docs/README.md` slice index.
- Committed as `7d2d9de` on `feature/slice4-milestones`.

---

## Phase 2 — backend (Hephaestus)

### Card 2.1 — Milestones schema, module and run link (medium) — TODO
- **Migration** `20261027000003_milestones.js`: `milestones` (`id`, `project_id`
  fk, `name`, `description`, `due_date date`, `created_by`/`updated_by`,
  `deleted_at`, timestamps), partial unique `(project_id, lower(name)) where
  deleted_at is null`; `runs.milestone_id uuid null fk` plus a partial index on
  `(milestone_id) where deleted_at is null`. `down` drops the column first.
- **Endpoints** (`server/src/milestones/`): `GET/POST
  /projects/:projectId/milestones`, `GET/PATCH/DELETE /milestones/:id`,
  `POST /milestones/:id/runs`, `DELETE /milestones/:id/runs/:runId` — roles per
  the contract matrix, archived-project rules as in `api-projects.md`.
- **Derived fields**: `run_count`, `counts` and `status` from one grouped
  aggregate per page over `runs → run_items →` latest result (reuse
  `LATEST_RESULT_JOIN`); `status` filter is a `HAVING`, never stored.
- **Run link**: `runColumns`/`runSelect` join `milestones` for `milestone_name`;
  `milestone_id` in both run DTOs; `?milestone_id=<id>|none` list filter;
  `create`/`PATCH /runs/:id` validate a live same-project milestone (400
  otherwise); plan-embedded runs reject `milestone_id`.
- **Delete/attach semantics**: attach in one transaction with `FOR UPDATE`,
  naming `run_ids[i]` for unknown / already-attached / duplicate ids; delete
  soft-deletes and detaches (`milestone_id = null`) in the same transaction.
- Tests: milestone service/store/dto specs and `test/milestones.e2e-spec.ts`,
  plus run-link cases in the existing runs specs.
- DoD: endpoints per contract; unit + e2e green; lint/tsc/build clean.

---

## Phase 3 — frontend (Iris)

### Card 3.1 — Milestones list and detail (medium) — TODO
- `/milestones` list: name, runs, status, status bar + `% complete`, due date,
  days left; search, Open/Completed filter, sort (due date default, undated
  last), pagination; empty state with **New milestone**.
- `/milestones/[id]`: rollup, due date, countdown, runs table (Plan column,
  Milestone column dropped), New/Edit dialog, Add runs picker, per-row Detach,
  Delete confirm that names the kept runs.
- Shared milestones dialog and hooks; `web/src/lib/dates.ts` for days left.

### Card 3.2 — Run surfaces (small/medium) — TODO
- Milestone select in `RunFormDialog`; Milestone column (link or `—`) between
  Plan and Status in the shared runs table; milestone link on run detail.
- Sidebar Milestones item, `g m` shortcut and `?` dialog entry; remove the
  `/wip/milestones` placeholder; Tester/Viewer see no write controls.

---

## Phase 4 — QA (Argus)

### Card 4.1 — Acceptance pass (medium) — TODO
- Walk acceptance criteria 1–13 as Admin, Lead, Tester and Viewer, UI-only;
  record pass/fail/not-run and findings.

---

## Leftovers / follow-ups

- QA 4.2 findings 2 and 3 (the Admin-only `GET /users` root behind the
  owner picker) remain open from slice 3; they are not milestone regressions.
- The five throwaway QA projects from slices 3 and 4 and `.playwright-mcp/`
  are still awaiting explicit approval before deletion.