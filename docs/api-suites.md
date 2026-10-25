# API Contract — Test Suites

Shared conventions (`/api/v1` prefix, envelopes, pagination, error format,
auth, security rules) live in `docs/api-conventions.md` and are not repeated
here. Product rules: `docs/PRD-suites-cases.md`. Cases in a suite:
`docs/api-cases.md`.

## Resource: Suite
```json
{
  "id": "018f2a41-7c3d-7a1e-9b2f-4a5b6c7d8e9f",
  "project_id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
  "parent_id": null,
  "name": "Checkout",
  "description": "Payment and cart flows",
  "depth": 1,
  "position": 1,
  "case_count": 124,
  "created_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "created_at": "2026-10-25T09:00:00Z",
  "updated_at": "2026-10-25T09:00:00Z"
}
```
- `depth`: 1 for a root suite, 2 child, 3 grandchild. Never greater than 3.
- `position`: 1-based, dense within the sibling group (1..n, no gaps).
- `case_count`: **subtree** count — cases in this suite plus all descendants,
  excluding soft-deleted cases (see `api-cases.md`).

### Validation
| Field | Rules |
|---|---|
| `name` | required, trimmed 1–100 chars, unique among siblings (case-insensitive `lower(name)` + `parent_id`) |
| `description` | optional, ≤ 500 chars; `null` clears it |
| `parent_id` | optional UUID; must exist, belong to **the same project**, and have `depth ≤ 2` (a child of it would be ≤ 3). `null` creates/keeps a root suite |
| `position` | optional on create (defaults to end of the sibling group); on PATCH must be within `1..sibling_count` |
| depth on move | resulting subtree height + new parent depth must stay ≤ 3 |

## Endpoints

### `GET /api/v1/projects/:projectId/suites` — any authenticated role
Returns the **whole project tree**, nested, ordered by `position` at every
level. Not paginated: a project's suite count is bounded (depth ≤ 3) and the
screen needs the whole tree.
```json
{
  "data": [
    {
      "id": "...",
      "parent_id": null,
      "name": "Checkout",
      "depth": 1,
      "position": 1,
      "case_count": 124,
      "children": [
        { "id": "...", "parent_id": "...", "name": "Payment", "depth": 2, "position": 1, "case_count": 38, "children": [] }
      ]
    }
  ]
}
```
- Each node carries the full Suite shape **plus** `children` (always present,
  possibly `[]`).
- `200` → `{ "data": [ ...roots ] }` (no `meta`; this is not a paginated list).
- `404` `NOT_FOUND` — unknown project, or an archived project requested by a
  non-Admin.

### `POST /api/v1/projects/:projectId/suites` — Admin, Lead
```json
// request
{ "name": "Payment", "description": "Card and wallet flows", "parent_id": "018f2a41-..." }
```
- `201` → `{ "data": { ...suite } }` with `depth` and `position` computed
  (appended to the end of its sibling group).
- `400` `VALIDATION_ERROR` — rules above; a request that would exceed depth 3
  names `parent_id` in `details`.
- `409` `CONFLICT` — duplicate `name` among siblings; `details` identifies the
  parent group.
- `404` — project unknown/hidden; `409` — project archived.
- `403` for Tester and Viewer.

### `GET /api/v1/suites/:id` — any authenticated role
Single suite plus its ancestor trail (breadcrumb for the cases header).
```json
{
  "data": {
    "...suite fields...": "...",
    "path": [
      { "id": "...", "name": "Checkout" },
      { "id": "...", "name": "Payment" }
    ]
  }
}
```
`path` is ordered root → this suite (inclusive). `404` for unknown ids,
archived projects (non-Admin), or a project the caller cannot see.

### `PATCH /api/v1/suites/:id` — Admin, Lead
```json
// request — any non-empty subset
{ "name": "Payments", "description": null, "parent_id": "...", "position": 2 }
```
- `200` → `{ "data": { ...suite } }`
- `400` `VALIDATION_ERROR` — empty body, bad fields, depth > 3 after a move,
  or a move into itself / its own descendant (all name the offending field).
- `409` `CONFLICT` — sibling name clash; `409` — project archived.
- `404` `NOT_FOUND`; `403` for Tester and Viewer.
- Moving a suite rewrites `depth` for the whole subtree in the same
  transaction; `position` gaps are closed densely.

### `PATCH /api/v1/projects/:projectId/suites/order` — Admin, Lead
Atomic reorder after drag-and-drop. Sends only the sibling groups that changed.
```json
// request
{
  "items": [
    { "id": "018f2a41-...", "parent_id": null, "position": 2 },
    { "id": "018f2b17-...", "parent_id": null, "position": 1 }
  ]
}
```
- `200` → `{ "data": [ ...roots ] }` — the full tree after reordering (same
  shape as the tree endpoint), so the client can reconcile without a refetch.
- `400` `VALIDATION_ERROR` — unknown/mismatched id, a parent that is not in
  the same project, duplicate positions within a group, or depth > 3.
- `409` — project archived; `404` — project unknown/hidden; `403` — non-writer.

### `DELETE /api/v1/suites/:id` — Admin, Lead
- `204` — the suite is empty (no child suites, no live cases).
- `409` `CONFLICT` — the suite is not empty. `details` states the reason:
  `{ "field": "suite", "issue": "suite has 38 cases" }` or
  `{ "field": "suite", "issue": "suite has 2 child suites" }`.
- `404` `NOT_FOUND`; `409` — project archived; `403` for Tester and Viewer.
- Never cascades. Position gaps in the sibling group are closed densely.

## Role matrix

| Endpoint | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| `GET /projects/:projectId/suites` | ✔ | ✔ | ✔ | ✔ |
| `POST /projects/:projectId/suites` | ✔ | ✔ | – | – |
| `GET /suites/:id` | ✔ | ✔ | ✔ | ✔ |
| `PATCH /suites/:id` | ✔ | ✔ | – | – |
| `PATCH /projects/:projectId/suites/order` | ✔ | ✔ | – | – |
| `DELETE /suites/:id` | ✔ | ✔ | – | – |

## Implementation notes (Hephaestus)
- Migration: `suites` table — `id uuid pk`, `project_id uuid not null fk →
  projects (on delete restrict)`, `parent_id uuid null fk → suites (on delete
  restrict)`, `name text not null`, `description text null`, `depth smallint
  not null check (depth between 1 and 3)`, `position int not null`,
  `created_by uuid fk → users`, `created_at`/`updated_at timestamptz`.
- Uniqueness: unique index on `(project_id, coalesce(parent_id, '00000000-
  0000-0000-0000-000000000000'::uuid), lower(name))` — or a partial unique
  index pair (parent null / parent not null) if that reads better.
- Sibling order: unique index on `(project_id, parent_id, position)` is
  **not** required (reorder runs in a transaction that rewrites the group);
  add a plain index on `(project_id, parent_id, position)` for reads.
- Tree reads: one query returning rows ordered by `parent_id, position`, then
  assemble in the service (depth ≤ 3 makes recursive SQL unnecessary). Counts
  come from a single grouped query over live cases
  (`select suite_id, count(*) … where deleted_at is null`), rolled up the tree
  in memory — no N+1.
- Move: validate target parent (same project, not self, not descendant) and
  `new_parent.depth + subtree_height ≤ 3`; update `depth` for the subtree with
  a recursive CTE; re-densify `position` in the source and target groups.
- Delete: re-check emptiness inside the transaction
  (`select count(*) from cases where suite_id = $1 and deleted_at is null` +
  child-suite count) so a concurrent create cannot slip through. Soft-deleted
  cases do not block the delete: `cases.suite_id` is `on delete set null`
  (see `api-cases.md`), so their rows, numbers and history survive while the
  suite row goes away.
- `PATCH …/suites/order` must be a single transaction with a deterministic
  lock order (order by `id`) to avoid deadlocks.
