# API Contract — Projects

Conventions (`/api/v1` prefix, envelopes, error format, pagination, security
rules) are in `docs/api-conventions.md` and are not repeated here.
PRD: `docs/PRD-projects.md`. Auth and roles: `docs/api-auth.md`.

## Resource: Project
```json
{
  "id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
  "key": "PAY",
  "name": "Payments",
  "description": "Checkout and billing flows",
  "status": "active",
  "created_by": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "created_at": "2026-10-07T12:00:00Z",
  "updated_at": "2026-10-07T12:00:00Z"
}
```
`status`: `active | archived`. `created_by`: id of the Admin or Lead who created it.

### Validation
| Field | Rules |
|---|---|
| `name` | required, trimmed 1–100 chars, unique case-insensitive |
| `key` | required, 2–10 chars, `^[A-Z][A-Z0-9]*$` (lowercase input is normalized to uppercase), unique case-insensitive |
| `description` | optional, ≤ 500 chars |

## Endpoints

### `GET /api/v1/projects` — any authenticated role
Query: `query` (substring match on `name`, optional), `status`
(`active` default; `archived` **Admin only** — non-Admin requesting it gets
`403`), `page`, `limit`. Sorted by `name` ascending.
- `200` → paginated `{ "data": [ ...projects ], "meta": { ... } }`
- `401` if unauthenticated.

### `POST /api/v1/projects` — Admin, Lead
```json
// request
{ "name": "Payments", "key": "pay", "description": "Checkout and billing flows" }
```
- `201` → `{ "data": { ...project } }` with `key: "PAY"` (normalized),
  `status: "active"`, `created_by` = caller id.
- `400` `VALIDATION_ERROR` — rules table above (`details` names the field).
- `409` `CONFLICT` — duplicate `name` or `key`; `details` names which.
- `403` for Tester and Viewer.

### `GET /api/v1/projects/:id` — any authenticated role
- `200` → `{ "data": { ...project } }`
- `404` `NOT_FOUND` — unknown id, **or** archived project requested by a
  non-Admin (archived projects are invisible to non-Admins).

### `PATCH /api/v1/projects/:id` — Admin
```json
// request — any non-empty subset
{ "name": "Payments v2", "key": "PAY2", "description": "..." }
```
- `200` → `{ "data": { ...project } }`
- `400` `VALIDATION_ERROR` | `409` `CONFLICT` (duplicate `name`/`key`) |
  `404` `NOT_FOUND` | `403` for non-Admin.
- Status is **not** settable here; use archive/restore below.
- Empty body (`{}`) → `400` `VALIDATION_ERROR` (a PATCH must change something).
- Explicit `null` for `name`/`key` → `400` `VALIDATION_ERROR` naming the
  field (both columns are `NOT NULL`).
- Explicit `null` for `description` **clears** the field (`200` with
  `description: null`); omitting it leaves the value untouched.

### `POST /api/v1/projects/:id/archive` — Admin, Lead
Sets `status = "archived"`. Idempotent (archiving an archived project → `200`).
- `200` → `{ "data": { ...project } }`
- `404` `NOT_FOUND` | `403` for Tester and Viewer.

### `POST /api/v1/projects/:id/restore` — Admin
Sets `status = "active"`. Idempotent.
- `200` → `{ "data": { ...project } }`
- `404` `NOT_FOUND` | `403` for non-Admin.

No `DELETE /projects/:id` exists in MVP — archive instead (data-safety rule).

## Role matrix

| Endpoint | Admin | Lead | Tester | Viewer | Public |
|---|---|---|---|---|---|
| `GET /projects` | ✔ (any status filter) | ✔ (`status=active` only) | ✔ (`active` only) | ✔ (`active` only) | – |
| `POST /projects` | ✔ | ✔ | – | – | – |
| `GET /projects/:id` | ✔ | ✔ (active only) | ✔ (active only) | ✔ (active only) | – |
| `PATCH /projects/:id` | ✔ | – | – | – | – |
| `POST /projects/:id/archive` | ✔ | ✔ | – | – | – |
| `POST /projects/:id/restore` | ✔ | – | – | – | – |

## Implementation notes (Hephaestus)
- Migration: `projects` table (uuid pk, key unique not null, name unique not
  null, description text, status enum default 'active', created_by uuid fk →
  users, created_at/updated_at timestamptz). Case-insensitive uniqueness via
  unique indexes on `lower(name)` and `lower(key)`.
- Projects reference users (`created_by`) — ship the auth migration first.
- Role enforcement: create + archive allow `admin, lead`; patch + restore
  allow `admin` only (decided in PRD-projects.md, Arif 2026-10-07).
