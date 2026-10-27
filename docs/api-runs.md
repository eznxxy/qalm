# API Contract — Test Runs, Results & Attachments

Shared conventions (`/api/v1` prefix, envelopes, pagination, error format,
auth, security rules) live in `docs/api-conventions.md` and are not repeated
here. Product rules: `docs/PRD-plans-runs.md`. Plans: `docs/api-plans.md`.
Cases referenced here are defined in `docs/api-cases.md`.

## Resource: Run (list item & detail)
```json
{
  "id": "018f3b22-5c4d-7e6f-8a91-6b7c8d9e0f12",
  "project_id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
  "plan_id": "018f3a10-4b2c-7d3e-8f40-5a6b7c8d9e0f",
  "milestone_id": "018f4c40-8d5f-7a80-9c13-8d9e0f123456",
  "milestone_name": "Release 2.4",
  "name": "Release 2.4 smoke",
  "description": "Smoke pass over Payments and Accounts.",
  "status": "open",
  "start_date": "2026-11-01",
  "due_date": "2026-11-14",
  "completed_at": null,
  "completed_by": null,
  "counts": {
    "total": 50,
    "passed": 31,
    "failed": 4,
    "blocked": 2,
    "retest": 0,
    "skipped": 0,
    "untested": 13,
    "percent_complete": 74
  },
  "assignee_ids": ["018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e"],
  "suite_ids": ["018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f"],
  "created_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "updated_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "created_at": "2026-10-26T08:00:00Z",
  "updated_at": "2026-10-26T12:30:00Z"
}
```

- `status` is `open │ completed`, derived from `completed_at`.
- `counts` counts each **run item** once, by its **latest** result (or
  `untested` when it has none). `percent_complete = round((total - untested) /
  total * 100)`, `0` when `total = 0`.
- `assignee_ids` are the distinct non-null assignees among the run's items.
- `suite_ids` are the distinct non-null `case_suite_id` snapshots among the
  run's items — the sections this run actually touches. Order is unspecified;
  clients that need the tree order sort against
  `GET /projects/:projectId/suites`. This is what the run detail's Section
  filter offers: a suite the run has no items from is not an option.
- `start_date` and `due_date` are plain calendar dates (`YYYY-MM-DD`), never
  instants, so they cannot shift with a timezone. Both are optional and
  independent of each other except for the ordering rule below.
- `milestone_id` is the milestone this run works towards (`null` = none; one
  milestone per run), and `milestone_name` is its current name, resolved by a
  join like a result's `created_by_name`, so a renamed milestone needs no client
  cache. Both are `null` together. A milestone's own status and rollup are in
  `docs/api-milestones.md`; deleting a milestone clears this column and never
  deletes the run.
- A run's `due_date` and its milestone's `due_date` are unrelated: there is no
  cross-field rule (PRD-milestones decision 8).

### Validation
| Field | Rules |
|---|---|
| `name` | required, trimmed 1–120 chars; **unique per project, case-insensitive**, among live runs — a soft-deleted run frees its name (enforced on create and rename) |
| `description` | optional, ≤ 1,000 chars; `null` clears |
| `plan_id` | optional UUID of a plan in the same project; `null` detaches |
| `milestone_id` | optional UUID of a **live milestone in the same project**; `null` detaches, a different id moves the run. An unknown, deleted or other-project milestone is `400` on `milestone_id` |
| `due_date` | optional `YYYY-MM-DD`; `null` clears |
| `start_date` | optional `YYYY-MM-DD`; `null` clears; when both dates are set, `start_date` must be **on or before** `due_date` (`400` otherwise) |
| `selection` | create-only; `{ "case_ids"?: [uuid], "suite_ids"?: [uuid], "include_descendants"?: bool (default true) }`. Omit for an empty run. `suite_ids` holds 1–20 distinct suites of the project; every listed suite's subtree is unioned with `case_ids`. Always plural: there is no singular `suite_id` alias |

A run may hold at most **2,000 items**; exceeding it is `400`.

## Resource: Run item
```json
{
  "id": "018f3c33-6d5e-7f70-8b92-7c8d9e0f1234",
  "run_id": "018f3b22-5c4d-7e6f-8a91-6b7c8d9e0f12",
  "case_id": "018f2c55-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
  "case_display_id": "C1042",
  "case_title": "Pay with saved card",
  "case_priority": "high",
  "case_suite_id": "018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f",
  "assignee_id": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "position": 1,
  "status": "passed",
  "result_count": 2,
  "latest_result": {
    "id": "018f3d44-7e6f-7a81-9c03-8d9e0f123456",
    "status": "passed",
    "comment": null,
    "elapsed_minutes": 12,
    "defect_url": null,
    "attachment_count": 0,
    "created_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
    "created_at": "2026-10-26T12:30:00Z"
  },
  "created_at": "2026-10-26T08:00:00Z",
  "updated_at": "2026-10-26T12:30:00Z"
}
```

- `case_title`, `case_priority`, `case_suite_id` are **snapshots** taken when the
  item is created (PRD decision 3, 2026-10-26); `case_display_id` is the case's
  `C####` at creation. The ordered steps snapshot is returned only by
  `GET /runs/:id/items/:itemId` (the result drawer needs them), not in lists.
- `status` is the latest result's status, or `untested`; `latest_result` is
  `null` when there are none.
- `case_id` may become `null` only if the case row is later hard-deleted by an
  Admin audit path — the snapshot keeps the item readable.

## Resource: Result
```json
{
  "id": "018f3d44-7e6f-7a81-9c03-8d9e0f123456",
  "run_item_id": "018f3c33-6d5e-7f70-8b92-7c8d9e0f1234",
  "status": "failed",
  "comment": "Card declined but the order was still created.",
  "elapsed_minutes": 9,
  "defect_url": "https://tracker.example.com/browse/BUG-412",
  "attachments": [
    {
      "id": "018f3e55-8f70-7b92-9d14-9e0f12345678",
      "filename": "declined.png",
      "content_type": "image/png",
      "size_bytes": 48213,
      "created_at": "2026-10-26T12:30:00Z"
    }
  ],
  "created_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "created_by_name": "Tess Tester",
  "created_at": "2026-10-26T12:30:00Z"
}
```

- `created_by_name` is the author's current display name, resolved by a join on
  `users` (added 2026-10-27, QA card 3.16). It is read-only, is not part of any
  request body, and follows a later rename — the result records who wrote it,
  not a frozen label. `created_by` stays the stable id (the edit and attachment
  rules compare against it); clients show the name and keep the id for audit.
  `updated_by`/`updated_by_name` are not exposed: results are append-only and
  only the latest one's metadata is editable.

### Validation
| Field | Rules |
|---|---|
| `status` | required: `passed │ failed │ blocked │ retest │ skipped` (immutable after creation) |
| `comment` | optional ≤ 4,000 chars; **required when `status = failed`**; plain text with line breaks and auto-linked URLs ("markdown-lite") |
| `elapsed_minutes` | optional integer 0–10,080 |
| `defect_url` | optional `http(s)` URL, ≤ 500 chars |

## Endpoints

### `GET /api/v1/projects/:projectId/runs` — any authenticated role
Paginated list for the runs screen (§4.3).

| Query param | Rules |
|---|---|
| `plan_id` | optional UUID; restrict to one plan. `plan_id=none` selects runs with no plan |
| `milestone_id` | optional UUID; restrict to one milestone. `milestone_id=none` selects runs with no milestone |
| `status` | optional: `open │ completed` |
| `query` | optional, case-insensitive substring on `name` |
| `sort` | optional: `created_at` (default), `updated_at`, `start_date`, `due_date`, `name`; prefix `-` for descending. Null `start_date`/`due_date` sort last in both directions |
| `page`, `limit` | per api-conventions |

- `200` → `{ "data": [ ...run ], "meta": { ... } }`
- `404` — unknown/archived project (non-Admin).

### `POST /api/v1/projects/:projectId/runs` — Admin, Lead
```json
// request — a run over two suites and one extra case
{
  "name": "Release 2.4 smoke",
  "description": "Smoke pass over Payments and Accounts.",
  "plan_id": "018f3a10-4b2c-7d3e-8f40-5a6b7c8d9e0f",
  "milestone_id": "018f4c40-8d5f-7a80-9c13-8d9e0f123456",
  "start_date": "2026-11-01",
  "due_date": "2026-11-14",
  "selection": {
    "case_ids": ["018f2c57-2b3c-7d4e-9f50-6a7b8c9d0e1f"],
    "suite_ids": [
      "018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f",
      "018f2a42-8d4e-7b2f-8c30-5b6c7d8e9f01"
    ],
    "include_descendants": true
  }
}
```
- Materialises one run item per live case in `selection` — the union of
  `case_ids` and every `suite_ids` subtree — deduplicated, `position` = case
  order (`case_number` ascending). An omitted `selection` or empty result
  creates an **empty** run (items can be added later).
- `suite_ids` is deduplicated by the server; selecting a parent and one of its
  children is therefore allowed and still yields one item per case. The same
  `include_descendants` applies to every listed suite.
- `201` → `{ "data": { ...run } }` with `counts.total` = items created.
- `400` `VALIDATION_ERROR` — bad fields, more than 20 `suite_ids`, an unknown
  suite (`selection.suite_ids`, or `selection.suite_ids[i]` when the bad id can
  be named), `start_date` after `due_date`, an unknown/deleted/other-project
  `milestone_id`, or more than 2,000 items.
- `409` `CONFLICT` — the project is archived, or a live run in the project
  already has this name (case-insensitive; details name the field `name`).
- `404` — project or referenced case/suite unknown; `403` — non-writer.

### `GET /api/v1/runs/:id` — any authenticated role
- `200` → `{ "data": { ...run } }` (with `counts`). Items come from the items
  list below, not embedded.
- `404` — unknown or soft-deleted run; archived project for a non-Admin.

### `PATCH /api/v1/runs/:id` — Admin, Lead
```json
// request — any non-empty subset (move a run between plans or milestones)
{ "name": "Release 2.4 smoke (final)", "plan_id": null, "milestone_id": null }
```
- `200` → `{ "data": { ...run } }`
- `400` `VALIDATION_ERROR` — including a `start_date` that would land after the
  run's (existing or new) `due_date`, or a `milestone_id` that is unknown,
  deleted or in another project; `404`; `409` — project archived, or the
  new `name` is already used by another live run in the project (renaming a run
  to a different case of its own name is allowed); `403`.
- Moving a run with `milestone_id` is an explicit act and is allowed even when
  the run is in another milestone; the bulk attach
  (`POST /milestones/:id/runs`) is stricter and refuses an already-attached run
  (see `docs/api-milestones.md`).

### `POST /api/v1/runs/:id/close` — Admin, Lead
Sets `completed_at`/`completed_by`. Items may be left untested (the status bar
shows them).
- `200` → `{ "data": { ...run } }` with `status: "completed"`.
- `409` `CONFLICT` — already completed; project archived.
- `404`; `403` — non-writer.

### `POST /api/v1/runs/:id/reopen` — Admin, Lead
Clears `completed_at`/`completed_by`.
- `200` → `{ "data": { ...run } }` with `status: "open"`.
- `409` — already open; project archived. `404`; `403`.

### `DELETE /api/v1/runs/:id` — Admin, Lead
Soft delete (`deleted_at`). The run leaves the runs list, the plan rollup and a
case's Linked runs, but its results are **kept** (PRD Q6).
- `204` — no body.
- `404` — already deleted or unknown; `409` — project archived; `403`.

### `GET /api/v1/runs/:id/items` — any authenticated role
Paginated item list for the run detail table (§4.4).

| Query param | Rules |
|---|---|
| `status` | optional, repeatable (`status=untested&status=failed`); OR within; a repeatable `untested` matches items with no results |
| `assignee_id` | optional UUID; `assignee_id=none` matches unassigned items |
| `suite_id` | optional UUID; matches the item's snapshotted `case_suite_id` (with descendants) |
| `query` | optional, substring on the snapshotted `case_title` |
| `sort` | optional: `position` (default, ascending — the run's authored order), `case_display_id` (by numeric part), `status` (severity order `failed → blocked → retest → passed → skipped → untested`), `updated_at`; prefix `-` for descending |
| `page`, `limit` | per api-conventions (default 25, max 100) |

- `200` → `{ "data": [ ...item ], "meta": { ... } }`
- `404` — unknown run; `403` only if the run is in an archived project and the
  caller is not an Admin.

### `GET /api/v1/runs/:id/items/:itemId` — any authenticated role
The result drawer's data: the item resource **plus** the snapshotted
`case_steps` and the case's live `preconditions` (read-through, not snapshotted).
```json
{ "data": { "...": "item", "case_steps": [ { "position": 1, "text": "Open checkout", "expected_result": "Cart total is shown" } ], "case_preconditions": "Customer has a saved card" } }
```
- `404` — unknown run or item (or an item from another run).

### `POST /api/v1/runs/:id/items` — Admin, Lead
Add cases to an existing run (the case screen's "Add to run" action, §4.2).
```json
// request
{ "case_ids": ["018f2c58-3c4d-7e5f-8a61-7b8c9d0e1f20"] }
```
- `200` → `{ "data": { "added": 1, "skipped": 0, "item_ids": [ ... ] } }`
  (a case already in the run, or a deleted case, is **skipped**, not an error).
- `400` — empty list, > 200 ids, or the cap of 2,000 items would be exceeded.
- `404` — run unknown; `409` — run is completed or the project is archived;
  `403`.

### `PATCH /api/v1/runs/:id/items/:itemId` — Admin, Lead
Assign or reorder an item.
```json
// request — any non-empty subset
{ "assignee_id": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e", "position": 3 }
```
- `200` → `{ "data": { ...item } }`
- `400` — invalid assignee (must be an active `admin`/`lead`/`tester`) or
  position out of range.
- `404`; `409` — run completed or project archived; `403`.

### `POST /api/v1/runs/:id/assign` — Admin, Lead
Bulk assign the "Assign" button in the run header (§4.4).
```json
// request — omit item_ids to assign every item
{ "assignee_id": "018f1c2e-...", "item_ids": ["018f3c33-...", "018f3c34-..."] }
```
- `200` → `{ "data": { "assigned": 2 } }` (`assignee_id: null` unassigns).
- `400` — invalid assignee or item ids not in this run.
- `404`; `409` — run completed or project archived; `403`.

### `DELETE /api/v1/runs/:id/items/:itemId` — Admin, Lead
Remove a case from a run.
- `204` — no body.
- `409` `CONFLICT` — the item already has a result ("clear the assignee
  instead"); or the project is archived. `404`; `403`.

### `POST /api/v1/runs/:id/items/:itemId/results` — Admin, Lead, or the assigned Tester
Record a result (§4.4).
```json
// request
{ "status": "failed", "comment": "Card declined but the order was created.", "elapsed_minutes": 9, "defect_url": "https://tracker.example.com/browse/BUG-412" }
```
- `201` → `{ "data": { ...result } }` (the item's `status`/`updated_at` change
  accordingly).
- `400` `VALIDATION_ERROR` — bad status, `failed` without a `comment`, oversized
  fields; the comment error names `comment`.
- `403` `FORBIDDEN` — a Tester on an item not assigned to them (PRD acceptance
  criterion 5).
- `404` `NOT_FOUND` — unknown run/item.
- `409` `CONFLICT` — the run is completed, or the project is archived.

### `GET /api/v1/runs/:id/items/:itemId/results` — any authenticated role
The item's full result history, **newest first** (`created_at desc`, `id`
tiebreak), paginated.
- `200` → `{ "data": [ ...result ], "meta": { ... } }`
- `404` — unknown run/item.

### `PATCH /api/v1/results/:id` — the author, or Admin/Lead
Edit the **most recent** result of an item. `status` is immutable (PRD Q4):
```json
// request — any non-empty subset; `status` is not accepted
{ "comment": "Card declined; order still created.", "defect_url": null }
```
- `200` → `{ "data": { ...result } }`
- `400` — empty body, `status` present, or a `failed` result left without a
  comment.
- `403` — not the author and not an Admin/Lead.
- `404`; `409` — the result is not the item's latest, or the project is
  archived.

### `POST /api/v1/results/:id/attachments` — the author, or Admin/Lead
`multipart/form-data`, one file per request, field name `file` (DESIGN §4.4
drag-and-drop uploads one file at a time).
- `201` → `{ "data": { ...attachment } }`
- `400` `VALIDATION_ERROR` — missing file, a filename whose extension is not
  one of `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf` (case-insensitive; the
  extension alone decides — the part's `Content-Type` is ignored), file over
  10 MB, or the result already holds 5 attachments (field `file`).
- The stored `content_type` is canonical: `image/png`, `image/jpeg`,
  `image/webp`, `application/pdf`. Same rule on every OS, so a `.zip` or `.csv`
  is refused everywhere rather than only where the OS happens to report an
  allow-listed MIME string.
- `403`; `404`; `409` — the result is not the item's latest, or the project is
  archived.

### `GET /api/v1/attachments/:id` — any authenticated role
Streams the bytes with the stored `Content-Type` and a
`Content-Disposition: inline; filename="…"` header. **Never** served without a
token.
- `200` — the file body.
- `401` `UNAUTHENTICATED` — no/invalid token.
- `404` — unknown attachment, or archived project for a non-Admin.

### `DELETE /api/v1/attachments/:id` — the author, or Admin/Lead
- `204`; `403`; `404`; `409` — not the latest result's attachment, or archived
  project.

### `GET /api/v1/cases/:id/runs` — any authenticated role
Backs the case drawer's **Linked runs** tab (§4.2). Newest run first.
```json
{
  "data": [
    {
      "run_id": "018f3b22-...",
      "run_name": "Release 2.4 smoke",
      "run_status": "open",
      "plan_id": "018f3a10-...",
      "item_id": "018f3c33-...",
      "status": "passed",
      "updated_at": "2026-10-26T12:30:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 25, "total": 1, "total_pages": 1 }
}
```
- `200` → the envelope above; soft-deleted runs are excluded.
- `404` — unknown or deleted case; archived project for a non-Admin.

## Role matrix

| Endpoint | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| `GET /projects/:projectId/runs` | ✔ | ✔ | ✔ | ✔ |
| `POST /projects/:projectId/runs` | ✔ | ✔ | – | – |
| `GET /runs/:id` | ✔ | ✔ | ✔ | ✔ |
| `PATCH /runs/:id` | ✔ | ✔ | – | – |
| `POST /runs/:id/close` · `reopen` | ✔ | ✔ | – | – |
| `DELETE /runs/:id` | ✔ | ✔ | – | – |
| `GET /runs/:id/items` · `/items/:itemId` | ✔ | ✔ | ✔ | ✔ |
| `POST /runs/:id/items` | ✔ | ✔ | – | – |
| `PATCH /runs/:id/items/:itemId` | ✔ | ✔ | – | – |
| `POST /runs/:id/assign` | ✔ | ✔ | – | – |
| `DELETE /runs/:id/items/:itemId` | ✔ | ✔ | – | – |
| `POST /runs/:id/items/:itemId/results` | ✔ | ✔ | ✔¹ | – |
| `GET /runs/:id/items/:itemId/results` | ✔ | ✔ | ✔ | ✔ |
| `PATCH /results/:id` | ✔ | ✔ | ✔² | – |
| `POST /results/:id/attachments` | ✔ | ✔ | ✔² | – |
| `GET /attachments/:id` | ✔ | ✔ | ✔ | ✔ |
| `DELETE /attachments/:id` | ✔ | ✔ | ✔² | – |
| `GET /cases/:id/runs` | ✔ | ✔ | ✔ | ✔ |

¹ Tester only on an item whose `assignee_id` is that Tester.
² Tester only on their own result.

## Implementation notes (Hephaestus)
- Migrations, in order:
  1. `plans` — see `docs/api-plans.md`.
  2. `runs` — `id uuid pk`, `project_id uuid not null fk → projects`,
     `plan_id uuid null fk → plans (on delete set null)`,
     `name text not null`, `description text null`, `start_date date null`,
     `due_date date null`, `completed_at timestamptz null`,
     `completed_by uuid null fk → users`,
     `created_by`/`updated_by uuid fk → users`, `deleted_at timestamptz null`,
     `created_at`/`updated_at timestamptz`.
     Indexes: `(project_id, deleted_at, created_at)`, `(plan_id)`.
     Uniqueness: partial unique index on `(project_id, lower(name))` where
     `deleted_at is null` — one live run per name per project, ignoring case
     (same rule as plan names). Added by `20261027000002_runs_name_unique`,
     which first renames any live duplicate by appending ` (2)`, ` (3)`, … so
     existing data satisfies the index.
     `start_date` was added by the follow-up migration
     `20261027000001_runs_start_date` (additive, nullable, no backfill), which
     keeps existing rows valid.
  3. `run_items` — `id uuid pk`, `run_id uuid not null fk → runs (on delete
     cascade)`, `case_id uuid null fk → cases (on delete set null)`,
     `case_display_id text not null`, `case_title text not null`,
     `case_steps jsonb not null default '[]'`, `case_priority text not null`,
     `case_suite_id uuid not null`, `assignee_id uuid null fk → users`,
     `position int not null`, `created_at`/`updated_at timestamptz`.
     Uniqueness: partial unique index on `(run_id, case_id)` where
     `case_id is not null` (one item per case per run).
     Indexes: `(run_id, position)`, `(assignee_id)`.
  4. `results` — `id uuid pk`, `run_item_id uuid not null fk → run_items (on
     delete cascade)`, `status text not null`, `comment text null`,
     `elapsed_minutes int null check (elapsed_minutes between 0 and 10080)`,
     `defect_url text null`, `created_by uuid not null fk → users`,
     `created_at timestamptz not null`.
     Indexes: `(run_item_id, created_at desc, id desc)`.
     Check: `status <> 'failed' or (comment is not null and length(btrim(comment))
     > 0)`.
  5. `result_attachments` — `id uuid pk`, `result_id uuid not null fk →
     results (on delete cascade)`, `filename text not null`,
     `content_type text not null`, `size_bytes bigint not null`,
     `storage_key text not null unique`, `created_by uuid not null fk → users`,
     `created_at timestamptz`. Index `(result_id)`.
     Check: `size_bytes between 1 and 10485760`.
- **Milestone link** (slice 4, `docs/api-milestones.md`): `runs.milestone_id
  uuid null fk → milestones(id)`, added by the milestones migration (nullable,
  no backfill) with a partial index on `(milestone_id) where deleted_at is
  null`. `milestone_name` comes from one `left join milestones` in
  `runSelect()` — never a per-row query; the list's `milestone_id` filter is
  `runs.milestone_id = $1` or `is null` for `none`. Same-project validation is
  in the service (no composite FK, like `plan_id`). Deleting a milestone clears
  this column in its own transaction; deleting a run is unchanged.
- **Latest result per item** is never stored on `run_items`: derive it with a
  `lateral join` to `results` ordered by `(created_at desc, id desc) limit 1`.
  Counts, the item list's `status`, and the run/plan rollups all use that.
- **Selection on create**: reuse the suite-subtree recursive CTE from
  `docs/api-cases.md` (`include_descendants`) once per `suite_ids` row, union
  the subtrees with explicit `case_ids`; insert `run_items` with the case's
  `case_number` → `case_display_id`, title, priority, suite id and a jsonb
  snapshot of `case_steps`, in one transaction, ordered by `case_number` for
  `position`. Validating the suites can be one query over
  `suite_ids = any($1)`; the item count is then checked against 2,000.
- **Attachments**: store bytes under a configured `STORAGE_DIR` (env, default
  `./storage`) at `<STORAGE_DIR>/attachments/<projectId>/<attachmentId>` — the
  `attachmentId` is the storage key, so the original filename never becomes a
  path. Write the file **then** the metadata row in the same request; delete the
  file when the metadata row is deleted. Serve via `GET /attachments/:id` only —
  no static file route, no directory listing. `STORAGE_DIR` is configuration,
  never logged, and nothing under it is committed (add it to `.gitignore`).
- **Close/reopen** touches only `runs`; result writes check `completed_at is
  null` in the write transaction (reject → `409`).
- **Tester write guard**: resolve the item's `assignee_id` and compare with the
  caller's user id; a mismatch on a Tester is `403`. Admin/Lead bypass.
- Run list `assignee_ids` and `suite_ids`, and the plan rollup, are computed
  with grouped aggregates per page — never a query per row.