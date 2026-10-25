# API Contract — Test Cases

Shared conventions (`/api/v1` prefix, envelopes, pagination, error format,
auth, security rules) live in `docs/api-conventions.md` and are not repeated
here. Product rules: `docs/PRD-suites-cases.md`. Suites: `docs/api-suites.md`.

## Resource: Case (detail)
```json
{
  "id": "018f2c55-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
  "project_id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
  "suite_id": "018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f",
  "case_number": 1042,
  "display_id": "C1042",
  "title": "Pay with saved card",
  "preconditions": "Customer has a saved card",
  "steps": [
    { "position": 1, "text": "Open checkout", "expected_result": "Cart total is shown" },
    { "position": 2, "text": "Pay with the saved card", "expected_result": "Order confirmed" }
  ],
  "priority": "high",
  "type": "functional",
  "tags": ["payments", "smoke"],
  "estimate_minutes": 15,
  "created_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "updated_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "created_at": "2026-10-25T09:00:00Z",
  "updated_at": "2026-10-25T09:12:00Z"
}
```

## Resource: Case (list item)
The cases table does not need step bodies, so list responses omit `steps` and
`preconditions` and carry `step_count` instead. Everything else is identical.
```json
{
  "...": "same fields as detail",
  "step_count": 2
}
```

### Validation
| Field | Rules |
|---|---|
| `title` | required, trimmed 1–200 chars |
| `preconditions` | optional, ≤ 2,000 chars; `null` clears it |
| `steps` | optional on create; when present 0–50 entries. On PATCH the array **replaces** the stored steps wholesale. `position` is derived from array order and ignored if sent. Each entry: `text` required 1–500; `expected_result` optional ≤ 500 |
| `suite_id` | required UUID, must belong to the same project (and be live) |
| `priority` | required on create: `critical │ high │ medium │ low` |
| `type` | required on create: `functional │ regression │ smoke │ exploratory │ other` |
| `tags` | optional array, 0–20 entries, each trimmed 1–30 chars, lowercased, de-duplicated; `[]` clears them |
| `estimate_minutes` | optional integer 0–10,080; `null` clears it |

### Case numbering
`case_number` is allocated per project from `project_case_counters` inside the
same transaction as the insert (`update … returning`, row-locked). It is
immutable, unique per project, and **never reused** — a rolled-back insert may
leave a gap, which is acceptable. The API always returns both the integer and
the display form (`display_id: "C1042"`); clients render `display_id`.

## Endpoints

### `GET /api/v1/projects/:projectId/cases` — any authenticated role
Paginated list for the case table.

| Query param | Rules |
|---|---|
| `suite_id` | optional UUID; restricts to that suite. `include_descendants` (default `true`) also matches its child/grandchild suites |
| `query` | optional, case-insensitive substring on `title` only |
| `priority` | optional, repeatable (`priority=high&priority=medium`); OR within the parameter |
| `type` | optional, repeatable; OR within |
| `tag` | optional, repeatable; **AND** across values (a case must carry every requested tag) |
| `sort` | optional: `case_number` (default, ascending), `updated_at`, `title`; prefix `-` for descending (`-updated_at`) |
| `page`, `limit` | per api-conventions (default 25, max 100) |

Filters combine with AND across different parameters. Soft-deleted cases are
never returned.
- `200` → `{ "data": [ ...list items ], "meta": { ... } }`
- `400` `VALIDATION_ERROR` for unknown enum values or malformed ids.
- `404` `NOT_FOUND` — unknown project, or archived project for a non-Admin.
- Access: every role reads.

### `POST /api/v1/projects/:projectId/cases` — Admin, Lead
```json
// request
{
  "suite_id": "018f2a41-...",
  "title": "Pay with saved card",
  "preconditions": "Customer has a saved card",
  "steps": [
    { "text": "Open checkout", "expected_result": "Cart total is shown" },
    { "text": "Pay with the saved card", "expected_result": "Order confirmed" }
  ],
  "priority": "high",
  "type": "functional",
  "tags": ["payments", "smoke"],
  "estimate_minutes": 15
}
```
- `201` → `{ "data": { ...detail } }` with `case_number` allocated,
  `display_id` formatted, history entry `created` written.
- `400` `VALIDATION_ERROR` — rules above; a bad step names its index
  (`{ "field": "steps[1].text", "issue": "…" }`).
- `404` — project or suite unknown / not in this project.
- `409` `CONFLICT` — project archived.
- `403` for Tester and Viewer.

### `GET /api/v1/cases/:id` — any authenticated role
- `200` → `{ "data": { ...detail } }`
- `404` `NOT_FOUND` — unknown or soft-deleted case; archived project for a
  non-Admin.

### `PATCH /api/v1/cases/:id` — Admin, Lead
```json
// request — any non-empty subset
{ "title": "Pay with saved card", "tags": ["payments"], "steps": [ ... ] }
```
- `200` → `{ "data": { ...detail } }`; one `updated` history entry lists the
  changed fields with from → to values (steps are summarised as
  `"steps": { "from": 2, "to": 3 }` — the full array is not duplicated in the
  audit row).
- `400` `VALIDATION_ERROR` — empty body or invalid fields.
- `404` `NOT_FOUND`; `409` — project archived; `403` — non-writer.
- `suite_id` may be changed here (single-case move); it writes a `moved`
  history entry **in addition to** the `updated` entry when other fields
  changed.

### `DELETE /api/v1/cases/:id` — Admin, Lead
Soft delete (`deleted_at` set). The case stops appearing in lists, counts,
filters and `GET /cases/:id`, and its `case_number` stays reserved.
- `204` — no body.
- `404` `NOT_FOUND` — already deleted or unknown; `409` — project archived;
  `403` — non-writer.
- Idempotency: a second DELETE returns `404` (documented, deliberate).

### `POST /api/v1/projects/:projectId/cases/bulk-move` — Admin, Lead
```json
// request
{ "case_ids": ["018f2c55-...", "018f2c56-..."], "suite_id": "018f2b17-..." }
```
- `200` → `{ "data": { "moved": 2, "case_ids": [ ... ] } }`
- Atomic: every id must be a live case in this project; any failure moves
  nothing and returns the error. Writes one `moved` history entry per case.
- `400` `VALIDATION_ERROR` — empty `case_ids`, more than 200 ids, unknown id,
  or target suite in another project.
- `404` — project or suite unknown; `409` — project archived; `403` — non-writer.

### `GET /api/v1/cases/:id/history` — any authenticated role
Paginated audit trail, newest first (`created_at desc`, stable via `id`).
```json
{
  "data": [
    {
      "id": "018f2d90-...",
      "case_id": "018f2c55-...",
      "actor_id": "018f1c2e-...",
      "action": "updated",
      "changes": {
        "priority": { "from": "medium", "to": "high" },
        "tags": { "from": ["payments"], "to": ["payments", "smoke"] }
      },
      "created_at": "2026-10-25T09:12:00Z"
    }
  ],
  "meta": { "page": 1, "limit": 25, "total": 3, "total_pages": 1 }
}
```
`action`: `created │ updated │ moved │ deleted`. `changes` is `{}` for
`deleted`; `moved` carries `{ "suite_id": { "from": "...", "to": "..." } }`.
`404` for unknown/deleted cases (non-Admin archived-project rules apply) —
history of a deleted case is reachable only through an Admin's audit path,
not this endpoint.

## Role matrix

| Endpoint | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| `GET /projects/:projectId/cases` | ✔ | ✔ | ✔ | ✔ |
| `POST /projects/:projectId/cases` | ✔ | ✔ | – | – |
| `GET /cases/:id` | ✔ | ✔ | ✔ | ✔ |
| `PATCH /cases/:id` | ✔ | ✔ | – | – |
| `DELETE /cases/:id` | ✔ | ✔ | – | – |
| `POST /projects/:projectId/cases/bulk-move` | ✔ | ✔ | – | – |
| `GET /cases/:id/history` | ✔ | ✔ | ✔ | ✔ |

## Implementation notes (Hephaestus)
- Migrations, in order:
  1. `project_case_counters` — `project_id uuid pk fk → projects`,
     `last_number int not null default 0`.
  2. `cases` — `id uuid pk`, `project_id uuid not null fk → projects`,
     `suite_id uuid not null fk → suites (on delete restrict)`,
     `case_number int not null`, `title text not null`,
     `preconditions text null`, `priority text not null`,
     `type text not null`, `tags text[] not null default '{}'`,
     `estimate_minutes int null check (estimate_minutes between 0 and 10080)`,
     `created_by`/`updated_by uuid fk → users`,
     `deleted_at timestamptz null`, `created_at`/`updated_at timestamptz`.
     Uniqueness: unique index on `(project_id, case_number)` (covers deleted
     rows too — numbers are never reused).
  3. `case_steps` — `case_id uuid fk → cases (on delete cascade)`,
     `position int not null`, `text text not null`,
     `expected_result text null`, pk `(case_id, position)`.
  4. `case_history` — `id uuid pk`, `case_id uuid not null`,
     `actor_id uuid not null fk → users`, `action text not null`,
     `changes jsonb not null default '{}'`, `created_at timestamptz`.
     Deliberately **no** FK cascade from `cases`: history outlives the case.
- Indexes for the list: `(project_id, suite_id, case_number)`,
  `(project_id, deleted_at)`, GIN on `tags`, and
  `lower(title) text_pattern_ops` if substring search proves slow (trigram
  index later if needed; at MVP sizes `ilike '%…%'` is acceptable).
- Number allocation: one statement
  `update project_case_counters set last_number = last_number + 1 where project_id = $1 returning last_number`
  inside the create transaction. Never compute `max(case_number) + 1`.
- Subtree filtering for `include_descendants`: resolve the suite's descendant
  ids with a recursive CTE (depth ≤ 3) and pass them as `suite_id = any($n)`;
  do not join per row.
- Deleted cases must be excluded from `case_count` rollups in the suites
  contract, from `GET /cases/:id`, and from bulk-move validation.
- History writes happen in the same transaction as the mutation; a failed
  mutation must never leave an audit row.
