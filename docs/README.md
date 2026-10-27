# Qalm Docs

Contracts first — no implementation before the relevant `api-<feature>.md`
exists and is approved (see `/AGENTS.md`).

## Cross-feature
- `api-conventions.md` — base URL, envelopes, pagination, error format,
  auth mechanism, security rules. Applies to every API contract.

## Feature slice qalm-1 (auth + projects) — status: approved by Arif 2026-10-07
- `PRD-auth.md` / `api-auth.md` — login, JWT sessions (15 min / 30 d),
  roles, user management. Self-registration stays off.
- `PRD-projects.md` / `api-projects.md` — project CRUD + archive/restore;
  archive-only (no hard delete). Leads may create and archive projects;
  edit/restore are Admin-only (decision 2026-10-07).

## Slice 2 (suites & cases) — status: contracts approved (Arif, 2026-10-25)
- `PRD-suites-cases.md` / `api-suites.md` / `api-cases.md` — project-scoped
  suite tree (max depth 3, non-empty delete blocked), cases with ordered
  steps, fixed type list, estimate in minutes, project-scoped `C####` ids,
  history, bulk move.

## Slice 3 (plans & runs) — status: contracts approved (Arif, 2026-10-26)
- `PRD-plans-runs.md` / `api-runs.md` / `api-plans.md` — test plans (thin
  containers over runs), test runs over selected cases, run items with a case
  snapshot and assignee, append-only results (Passed/Failed/Blocked/Retest/
  Skipped; failed needs a comment), attachments on the API server's disk, run
  close/reopen, and the case drawer's Linked runs feed. Ten decisions (Q1–Q10)
  are recorded in the PRD.

## Slice 4 (milestones) — status: contracts approved (Arif, 2026-10-27)
- `PRD-milestones.md` / `api-milestones.md` — project-scoped, dated checkpoints
  over runs (one milestone per run), with a derived status and a rollup over the
  milestone's runs, editable attach/detach, and no plan-level milestone. The run
  link is additive in `api-runs.md`; `api-plans.md` records that an embedded run
  does not take one.

## Slice 5 (project overview) — status: proposed, awaiting approval
- `PRD-project-overview.md` / `api-project-overview.md` — the project page gains
  a tab strip (Overview / Milestones / Test runs / Test cases live, Reports
  disabled), a 14-day results trend backed by the new
  `GET /projects/:projectId/reports/trend`, a Milestones card and a Test Runs
  card, and moves the description into Overview. One new read-only endpoint and
  one index; no existing resource changes.

## Later slices (no docs yet)
Dashboards/reports → CSV import/export.
