# API Contract — Test Plans

Shared conventions (`/api/v1` prefix, envelopes, pagination, error format,
auth, security rules) live in `docs/api-conventions.md` and are not repeated
here. Product rules: `docs/PRD-plans-runs.md`. Runs: `docs/api-runs.md`.

A plan is a thin container over runs. This contract is small on purpose.

Plans are not created on their own: `POST /projects/:projectId/plans` takes the
plan **and its runs** in one request, and requires at least one run. There is no
plan-only create, so a plan cannot be born empty.

## Resource: Plan
```json
{
  "id": "018f3a10-4b2c-7d3e-8f40-5a6b7c8d9e0f",
  "project_id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
  "name": "Release 2.4",
  "description": "Regression sweep before the 2.4 release.",
  "due_date": "2026-11-14",
  "run_count": 3,
  "counts": {
    "total": 120,
    "passed": 71,
    "failed": 4,
    "blocked": 2,
    "retest": 3,
    "skipped": 5,
    "untested": 35,
    "percent_complete": 71
  },
  "created_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "updated_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "created_at": "2026-10-25T09:00:00Z",
  "updated_at": "2026-10-26T11:20:00Z"
}
```

`counts` is the rollup over **all items in all of the plan's runs** (a run that
is `completed` still counts). `percent_complete` = `round((total - untested) /
total * 100)`, and is `0` when `total = 0`.

### Validation
| Field | Rules |
|---|---|
| `name` | required, trimmed 1–120 chars, unique per project (case-insensitive) |
| `description` | optional, ≤ 1,000 chars; `null` clears it |
| `due_date` | optional `YYYY-MM-DD`; `null` clears it |
| `runs` | **required on create**, 1–20 entries (a plan needs at least one run) |
| `runs[].name` | required, trimmed 1–120 chars; unique per project (case-insensitive), exactly like a standalone run — including across the runs of one request |
| `runs[].description` | optional, ≤ 1,000 chars |
| `runs[].start_date`, `runs[].due_date` | optional `YYYY-MM-DD`; `start_date` may not be after `due_date` |
| `runs[].plan_id` | not accepted — every run inherits the new plan's id |

Run fields follow `docs/api-runs.md`; the embedded run has no
`selection`/`case_ids`. Runs created this way start empty (`0` items) — cases
are added afterwards from the run screen.

## Endpoints

### `GET /api/v1/projects/:projectId/plans` — any authenticated role
Paginated list, newest first (`created_at desc`, `id` tiebreak), for plan
pickers (the Plan column and the Plan filter on the runs screen) and the plan
detail screen.

| Query param | Rules |
|---|---|
| `query` | optional, case-insensitive substring on `name` |
| `sort` | optional: `created_at` (default), `updated_at`, `name`, `due_date`; prefix `-` for descending. Rows with a `null` `due_date` sort last |
| `page`, `limit` | per api-conventions (default 25, max 100) |

- `200` → `{ "data": [ ...plan ], "meta": { ... } }`
- `404` `NOT_FOUND` — unknown project, or archived project for a non-Admin.

### `POST /api/v1/projects/:projectId/plans` — Admin, Lead
A plan is a collection of runs, so it is created **together with its runs**, in
one request, with at least one run.
```json
// request
{
  "name": "Release 2.4",
  "description": "Regression sweep before 2.4.",
  "due_date": "2026-11-14",
  "runs": [
    { "name": "Smoke — checkout", "start_date": "2026-11-02", "due_date": "2026-11-06" },
    { "name": "Full regression", "description": "All suites" }
  ]
}
```
- `201` → `{ "data": { ...plan } }` with `run_count` equal to the number of runs
  created and zeroed `counts` (each new run has no items).
- `400` `VALIDATION_ERROR`; `409` `CONFLICT` — duplicate plan name in the
  project, a run name already in use in the project (or repeated inside this
  request), or project archived; `403` for Tester and Viewer.

#### Atomicity
The plan and all of its runs are inserted in **one transaction**. If any run is
rejected — bad field, `start_date` after `due_date`, a plan-name or run-name
conflict — the whole request rolls back: no plan and no runs. Retrying the same
request is safe because nothing was written.

#### Validation details
- Errors are reported per field, including the index:
  `runs` (missing, empty, more than 20), `runs[0].name`,
  `runs[1].start_date`, and so on.
- A plan's `name` uniqueness is checked once per request, and each embedded
  run's name is checked too: it must not match a live run already in the
  project, nor an earlier run in the same request. Both are `409` with the
  offending index (`runs[1].name`), so the dialog can point at that run; the
  plan is not created.

#### "At least one run" applies to create only
Runs can be deleted (`DELETE /runs/:id`) or detached
(`PATCH /runs/:id { "plan_id": null }`) later, so a plan may end up with
`run_count: 0`. That plan stays visible and is not deleted implicitly — the
rule guards creation, not the plan's lifetime.

### `GET /api/v1/plans/:id` — any authenticated role
- `200` → `{ "data": { ...plan } }` (with `counts`). Runs are fetched from the
  runs list with `plan_id=<id>` (see `docs/api-runs.md`), not embedded here.
- `404` — unknown or deleted plan; archived project for a non-Admin.

### `PATCH /api/v1/plans/:id` — Admin, Lead
```json
// request — any non-empty subset
{ "name": "Release 2.4 (final)", "due_date": null }
```
- `200` → `{ "data": { ...plan } }`
- `400` `VALIDATION_ERROR` — empty body or invalid fields.
- `404`; `409` — duplicate name or project archived; `403` — non-writer.

### `DELETE /api/v1/plans/:id` — Admin, Lead
Removes the plan. Its runs are **detached** (`plan_id` set to `null`), never
deleted (PRD decision 7, 2026-10-26).
- `204` — no body.
- `404`; `409` — project archived; `403` — non-writer.

## Role matrix

| Endpoint | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| `GET /projects/:projectId/plans` | ✔ | ✔ | ✔ | ✔ |
| `POST /projects/:projectId/plans` | ✔ | ✔ | – | – |
| `GET /plans/:id` | ✔ | ✔ | ✔ | ✔ |
| `PATCH /plans/:id` | ✔ | ✔ | – | – |
| `DELETE /plans/:id` | ✔ | ✔ | – | – |

## Implementation notes (Hephaestus)
- Migration `plans`:
  `id uuid pk`, `project_id uuid not null fk → projects`,
  `name text not null`, `description text null`, `due_date date null`,
  `created_by`/`updated_by uuid fk → users`,
  `deleted_at timestamptz null`, `created_at`/`updated_at timestamptz`.
  Uniqueness: partial unique index on `(project_id, lower(name))` where
  `deleted_at is null` (a deleted plan frees its name).
- `plan.counts` / `run_count` are computed on read with a join to `runs` →
  `run_items` → latest-per-item result; do not denormalise in MVP. Keep one
  query per list page (aggregate in SQL, not per row in the app).
- Deleting a plan runs `update runs set plan_id = null where plan_id = $1` in the
  same transaction as the `deleted_at` update.
- `POST /projects/:projectId/plans` inserts the plan row first, then every
  `runs[i]` with that `plan_id`, inside the store's transaction. Reuse
  `RunsStore.insertRun`/`PlansStore.transaction` so there is exactly one
  transaction and no second code path for run inserts; roll back the lot on the
  first rejected run.
- The create response is re-read with `findWithCounts` inside the same
  transaction, so `run_count` reflects the runs just written.
- `GET /projects/:projectId/plans` backs `run_count` with a grouped count
  `left join`; a plan with zero runs still appears.