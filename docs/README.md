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

## Later slices (no docs yet)
Plans & runs → milestones → dashboards/reports → CSV import/export.
