# API Conventions (all Qalm features)

Applies to every `docs/api-<feature>.md`. Backend (NestJS) and frontend
(Next.js) implement against this file; feature contracts only add specifics.

## Base URL & versioning
- All endpoints are prefixed `/api/v1`. In development the API serves
  `http://localhost:<port>/api/v1` (port fixed in `/server` config at
  implementation time; default NestJS 3000).
- Breaking changes get a new major segment (`/api/v2`); additive changes stay.

## Requests & responses
- `Content-Type: application/json` for all request and response bodies.
- JSON keys are `snake_case`.
- Resource IDs are UUID strings (v7 preferred for sortability, v4 acceptable).
- Timestamps are ISO 8601 UTC strings (`2026-10-07T12:00:00Z`); every resource
  has `created_at` and `updated_at`.

### Envelopes
Single resource:
```json
{ "data": { "...": "resource" } }
```
List (paginated):
```json
{
  "data": [ { "...": "resource" } ],
  "meta": { "page": 1, "limit": 25, "total": 123, "total_pages": 5 }
}
```
No body on `204 No Content`.

### Pagination
Query params: `page` (1-based, default 1), `limit` (default 25, max 100).
Sorting, when supported, is documented per endpoint and stable.

## Authentication
- `Authorization: Bearer <access_token>` on every request except the
  explicitly public endpoints (`login`, `refresh`, `bootstrap`).
- Missing/expired/invalid token → `401` with `error.code = "UNAUTHENTICATED"`.
- Valid token, insufficient role → `403` with `error.code = "FORBIDDEN"`.
- Roles are global and per-user: `admin`, `lead`, `tester`, `viewer`.
  Each endpoint's contract lists exactly which roles may call it.

## Error format
Every non-2xx response:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary of what went wrong.",
    "details": [
      { "field": "email", "issue": "must be a valid email address" }
    ]
  }
}
```
`details` is present for validation errors, omitted otherwise.

| HTTP | `error.code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/query failed validation (`details` set). |
| 401 | `UNAUTHENTICATED` | No/invalid/expired token, or bad credentials. |
| 403 | `FORBIDDEN` | Authenticated but the role may not do this. |
| 404 | `NOT_FOUND` | Resource does not exist (or is hidden from this role). |
| 409 | `CONFLICT` | Uniqueness violation or state conflict (e.g. last admin). |
| 429 | `RATE_LIMITED` | Rate limit hit; `Retry-After` header in seconds. |
| 500 | `INTERNAL` | Unexpected server error; never leaks stack traces. |

## Security requirements (binding for the backend)
- Passwords hashed with bcrypt, cost ≥ 12. Minimum password: 8 chars with at
  least one letter and one digit.
- JWT signing secret from env (`JWT_SECRET`, ≥ 32 bytes). Never committed,
  never logged. No secrets in code or logs.
- Refresh tokens are 64-byte random values, stored only as SHA-256 hashes.
- Unknown email and wrong password produce byte-identical `401` responses.
- All timestamps compared server-side in UTC.
