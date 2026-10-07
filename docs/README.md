# Qalm Docs

Contracts first — no implementation before the relevant `api-<feature>.md`
exists and is approved (see `/AGENTS.md`).

## Cross-feature
- `api-conventions.md` — base URL, envelopes, pagination, error format,
  auth mechanism, security rules. Applies to every API contract.

## Feature slice qalm-1 (auth + projects) — status: awaiting human approval
- `PRD-auth.md` / `api-auth.md` — login, JWT sessions, roles, user management.
- `PRD-projects.md` / `api-projects.md` — project CRUD + archive/restore.

## Later slices (no docs yet)
Test suites & cases → plans & runs → milestones → dashboards/reports →
CSV import/export.
