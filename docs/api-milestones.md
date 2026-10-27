# API Contract — Milestones

Shared conventions (`/api/v1` prefix, envelopes, pagination, error format, auth,
security rules) live in `docs/api-conventions.md` and are not repeated here.
Product rules: `docs/PRD-milestones.md`. Runs: `docs/api-runs.md`; plans:
`docs/api-plans.md`.

A milestone is a project-scoped, dated checkpoint over **runs**. It owns neither
plans nor runs — attaching a run writes `runs.milestone_id`, and deleting a
milestone only clears that column. Its progress is derived on read, like a
plan's, and so is its `status`.

## Resource: Milestone
```json
{
  "id": "018f4c40-8d5f-7a80-9c13-8d9e0f123456",
  "project_id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
  "name": "Release 2.4",
  "description": "Ship 2.4 to production.",
  "due_date": "2026-11-14",
  "status": "open",
  "run_count": 4,
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
  "created_at": "2026-10-28T09:00:00Z",
  "updated_at": "2026-10-28T09:00:00Z"
}
```

- `counts` is the rollup over **all items in all attached live runs**: each item
  counted once by its latest result, a `completed` run still counted, a
  soft-deleted run excluded. `percent_complete = round((total - untested) /
  total * 100)`, and is `0` when `total = 0`. This is the plan rollup
  (`docs/api-plans.md`) applied to a different set of runs.
- `status` is **derived, never stored**: `"completed"` when `run_count > 0` and
  every attached live run is completed (`completed_at` set), otherwise
  `"open"`. Attaching an open run — or reopening a run — makes a completed
  milestone `open` again. A milestone with no runs is `"open"`.
- `run_count` counts attached **live** runs (completed ones included); a
  soft-deleted run drops out of it.
- `due_date` is a plain calendar date (`YYYY-MM-DD`), never an instant, so it
  cannot shift with a timezone. "Days left" is computed by the client from this
  field and is not part of the API.

### Validation
| Field | Rules |
|---|---|
| `name` | required, trimmed 1–120 chars, unique per project (case-insensitive) among live milestones |
| `description` | optional, ≤ 1,000 chars; `null` clears it |
| `due_date` | optional `YYYY-MM-DD`; `null` clears it |
| `run_ids` | attach endpoint only: 1–50 distinct UUIDs of live runs of this project with `milestone_id: null` |

## Endpoints

### `GET /api/v1/projects/:projectId/milestones` — any authenticated role
Paginated list, for the milestones screen and for the New run dialog's milestone
select.

| Query param | Rules |
|---|---|
| `query` | optional, case-insensitive substring on `name` |
| `status` | optional: `open` or `completed` (derived, see above) |
| `sort` | optional: `due_date` (default), `created_at`, `updated_at`, `name`; prefix `-` for descending. Undated milestones (`due_date` null) sort last in both directions |
| `page`, `limit` | per api-conventions (default 25, max 100) |

- `200` → `{ "data": [ ...milestone ], "meta": { ... } }`
- `404` `NOT_FOUND` — unknown project, or archived project for a non-Admin.

### `POST /api/v1/projects/:projectId/milestones` — Admin, Lead
```json
// request
{
  "name": "Release 2.4",
  "description": "Ship 2.4 to production.",
  "due_date": "2026-11-14"
}
```
Create is **fields only**; runs are attached afterwards
(`POST /milestones/:id/runs`, or `PATCH /runs/:id`). A milestone with no runs is
valid — it is a target, not a container that must be filled (PRD decision 4).
- `201` → `{ "data": { ...milestone } }` with `run_count: 0`, `status: "open"`
  and zeroed counts.
- `400` `VALIDATION_ERROR` — bad fields.
- `409` `CONFLICT` — duplicate name in the project (field `name`), or project
  archived.
- `403` for Tester and Viewer.

### `GET /api/v1/milestones/:id` — any authenticated role
- `200` → `{ "data": { ...milestone } }` (with `counts`, `run_count`, `status`).
  Its runs come from the runs list with `milestone_id=<id>` (see
  `docs/api-runs.md`), not embedded here — the same choice as a plan.
- `404` — unknown or deleted milestone; archived project for a non-Admin.

### `PATCH /api/v1/milestones/:id` — Admin, Lead
```json
// request — any non-empty subset
{ "due_date": "2026-11-21", "description": null }
```
- `200` → `{ "data": { ...milestone } }`
- `400` `VALIDATION_ERROR` — empty body or invalid fields.
- `404`; `409` — duplicate name or project archived; `403` — non-writer.
- Changing the due date never touches a run's own dates (PRD decision 8).

### `DELETE /api/v1/milestones/:id` — Admin, Lead
Soft-deletes the milestone and **detaches** its runs (`milestone_id = null`) in
the same transaction; no run, item, result or attachment is deleted (PRD
lifecycle; same rule as deleting a plan, slice 3 decision 7).
- `204` — no body.
- `404` — already deleted or unknown; `409` — project archived; `403`.

### `POST /api/v1/milestones/:id/runs` — Admin, Lead
Attaches runs that have no milestone yet.
```json
// request
{ "run_ids": ["018f3b22-5c4d-7e6f-8a91-6b7c8d9e0f12"] }
```
- Rules, all checked inside one transaction with `SELECT … FOR UPDATE` on the
  requested runs:
  - every id must be a **live run of this project** — unknown, soft-deleted and
    other-project ids are all reported as `run_ids[i]` `"unknown run"`, so the
    endpoint never reveals another project's ids;
  - the run must have `milestone_id: null`; a run already in a milestone is
    `run_ids[i]` `"already in a milestone"` (detach it first with
    `DELETE /milestones/:id/runs/:runId` or `PATCH /runs/:id
    { "milestone_id": null }`) — attaching never moves work silently;
  - the same id twice in one request is `run_ids[i]` `"duplicate in request"`;
  - shape errors (not an array, empty, more than 50, non-UUID) are `400` on
    `run_ids`.
- Attaching an open run to a milestone that currently reads `completed` is
  allowed: the milestone's derived status returns to `open`. There is no
  closed-milestone guard because there is no stored state (PRD decision 2).
- `200` → `{ "data": { "attached": 2 } }`
- `400` `VALIDATION_ERROR` — see above.
- `404` — unknown or deleted milestone; `409` — project archived; `403`.

### `DELETE /api/v1/milestones/:id/runs/:runId` — Admin, Lead
Detaches one run: `milestone_id = null`. The run, its items, results and
attachments are untouched, and it stays on the runs list.
- `204` — no body.
- `404` — unknown/deleted milestone, unknown run, or a run that is **not
  attached to this milestone** (the three are indistinguishable on purpose).
- `409` — project archived; `403` — non-writer.
- Detaching a run from its milestone is allowed while the run is `open` or
  `completed`; closing a run does not lock its milestone.

## Changes to the runs contract (`docs/api-runs.md`)
Additive; no existing field changes meaning.

| Where | Change |
|---|---|
| Run resource | + `milestone_id` (uuid or `null`), + `milestone_name` (`null` when none; current name from a join, like `created_by_name`) |
| `GET /projects/:projectId/runs` | + `milestone_id` query param: a UUID restricts to that milestone, `milestone_id=none` selects runs with no milestone |
| `POST /projects/:projectId/runs` | + optional `milestone_id`; a live milestone of the same project, else `400` on `milestone_id` |
| `PATCH /runs/:id` | + `milestone_id`; `null` detaches, another id moves the run (an explicit move is allowed here, unlike the bulk attach) |
| `POST /projects/:projectId/plans` | **not** accepted on `runs[i]` — an embedded run gets its milestone afterwards (documented in `docs/api-plans.md`) |
| Milestone delete | clears `runs.milestone_id`; it is not a run delete |

`GET /runs/:id/items`, results and attachments are unchanged. A run's
`due_date` is unrelated to its milestone's `due_date` (PRD decision 8).

## Role matrix

| Endpoint | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| `GET /projects/:projectId/milestones` | ✔ | ✔ | ✔ | ✔ |
| `POST /projects/:projectId/milestones` | ✔ | ✔ | – | – |
| `GET /milestones/:id` | ✔ | ✔ | ✔ | ✔ |
| `PATCH /milestones/:id` | ✔ | ✔ | – | – |
| `DELETE /milestones/:id` | ✔ | ✔ | – | – |
| `POST /milestones/:id/runs` | ✔ | ✔ | – | – |
| `DELETE /milestones/:id/runs/:runId` | ✔ | ✔ | – | – |

## Implementation notes (Hephaestus)
- One migration (next timestamp in the sequence, e.g.
  `20261027000003_milestones.js`):
  `milestones` — `id uuid pk`, `project_id uuid not null fk → projects`,
  `name text not null`, `description text null`, `due_date date null`,
  `created_by`/`updated_by uuid fk → users`, `deleted_at timestamptz null`,
  `created_at`/`updated_at timestamptz`; partial unique index on
  `(project_id, lower(name)) where deleted_at is null` (a deleted milestone
  frees its name). `runs` — `milestone_id uuid null fk → milestones(id)` plus a
  partial index on `(milestone_id) where deleted_at is null` for the runs-list
  filter and the rollups. `down` drops the column first, then the table.
- Project consistency (`milestone.project_id = run.project_id`) is enforced in
  the service, not by a composite FK — the same approach `runs.plan_id` uses.
  Validate on create, on `PATCH /runs/:id` and on attach; an unknown, deleted or
  other-project milestone is `400` on `milestone_id` (or `run_ids[i]` on
  attach).
- `counts`, `run_count` and `status` are computed on read: join `runs` →
  `run_items` → the latest-per-item result (reuse `LATEST_RESULT_JOIN` and the
  plan rollup from `plans.store.ts`). One grouped aggregate per list page — no
  per-row query. `status` comes from the same aggregate
  (`run_count > 0 AND completed_run_count = run_count`); the `status` filter is
  a `HAVING` on it. Do not denormalise any of the three.
- Attach: one `SELECT … WHERE id = ANY($1) AND deleted_at IS NULL FOR UPDATE`,
  then check project and `milestone_id is null`, reporting the failing index,
  then a single `UPDATE runs SET milestone_id = $milestone, updated_by =
  $caller, updated_at = now() WHERE id = ANY($1)`. `FOR UPDATE` keeps a
  concurrent attach from slipping between the check and the write.
- Delete runs `update runs set milestone_id = null, updated_by = $caller,
  updated_at = now() where milestone_id = $1` in the same transaction as the
  `deleted_at` update.
- `milestone_name` in the run list/detail comes from one `left join milestones`
  in `runSelect()` (no extra round trip, no per-row query); a soft-deleted
  milestone is not joined, so its runs read `milestone_id: null` after the
  detach that runs in the delete transaction.
- The New run dialog's milestone select and the Add runs picker share
  `GET /projects/:projectId/milestones` and `GET /projects/:projectId/runs?
  milestone_id=none&limit=100&query=…`; no new "runs of a milestone" endpoint.
- Days left is **not** a server concern: the web computes it from `due_date` in
  `web/src/lib/dates.ts`, the only place `Intl` formatting lives (DESIGN §9).