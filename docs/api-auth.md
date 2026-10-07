# API Contract — Auth & Users

Conventions (`/api/v1` prefix, envelopes, error format, security rules) are in
`docs/api-conventions.md` and are not repeated here. PRD: `docs/PRD-auth.md`.

## Resources

### User
```json
{
  "id": "018f1c2e-7b3a-7a10-9c2d-3f4a5b6c7d8e",
  "email": "ada@example.com",
  "name": "Ada Lovelace",
  "role": "admin",
  "is_active": true,
  "must_change_password": false,
  "created_at": "2026-10-07T12:00:00Z",
  "updated_at": "2026-10-07T12:00:00Z"
}
```
`role`: `admin | lead | tester | viewer` (global, one per user).
`must_change_password` is advisory (frontend shows a change-password banner);
it is set `true` by Admin-created users and cleared when the user changes
their own password via `PATCH /auth/me`.

### Access token (JWT)
- HS256, payload: `{ "sub": "<user id>", "role": "<role>", "iat": ..., "exp": ..., "iss": "qalm" }`,
  `exp = iat + 900` (15 min). Frontend treats it as opaque.
- The server MUST reject tokens of deactivated users even before `exp`.

### Refresh token
- 64 random bytes, stored server-side as SHA-256 hash with user + expiry (30 d).
- Delivered in an HTTP-only cookie: `qalm_refresh; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=2592000`.
  (`Secure` always; over plain HTTP in dev the backend may relax it via env flag.)
- Rotated on every successful refresh. Presenting a rotated-out token → 401 and
  revocation of **all** refresh tokens of that user (replay defense).

## Endpoints

### `POST /api/v1/auth/bootstrap` — public
Creates the first Admin. Allowed only while zero users exist.
```json
// request
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "s3cretpass" }
```
- `201` → `{ "data": { "user": { ... }, "access_token": "...", "token_type": "Bearer", "expires_in": 900 } }`
  + `Set-Cookie: qalm_refresh=...`
- `409` `CONFLICT` — any user already exists.
- `400` `VALIDATION_ERROR` — invalid body / weak password.

### `POST /api/v1/auth/login` — public
```json
// request
{ "email": "ada@example.com", "password": "s3cretpass" }
```
- `200` → same shape as bootstrap response + refresh cookie.
- `401` `UNAUTHENTICATED` — unknown email or wrong password or deactivated
  user; identical response in all three cases.
- `429` `RATE_LIMITED` — 10 failed attempts per email+IP in 15 min;
  `Retry-After` header in seconds.
- `400` `VALIDATION_ERROR` — malformed body.

### `POST /api/v1/auth/refresh` — public (requires refresh cookie)
- `200` → `{ "data": { "access_token": "...", "token_type": "Bearer", "expires_in": 900 } }`
  + new rotated `qalm_refresh` cookie. (No `user` payload; clients already
  have it or call `GET /auth/me`.)
- `401` `UNAUTHENTICATED` — missing/expired cookie, or reuse of a rotated
  token (also revokes the user's remaining refresh tokens).

### `POST /api/v1/auth/logout` — any authenticated role
Revokes the refresh token in the cookie (if any) and clears the cookie.
- `204` No Content.

### `GET /api/v1/auth/me` — any authenticated role
- `200` → `{ "data": { ...user } }`
- `401` if token invalid or user deactivated.

### `PATCH /api/v1/auth/me` — any authenticated role
```json
// request — name change alone, or password change requiring current password
{ "name": "Ada K. Lovelace", "current_password": "s3cretpass", "new_password": "n3wsecretpw" }
```
- `name` alone: optional.
- Password change requires both `current_password` and `new_password`;
  clears `must_change_password`.
- `200` → `{ "data": { ...user } }`
- `400` `VALIDATION_ERROR` — wrong `current_password`, or weak new password.
- `401` if unauthenticated.

## Endpoints — user management (Admin only)

### `GET /api/v1/users` — Admin
Query: `query` (substring match on email or name, optional), `role` (optional
filter), `page`, `limit`. Sorted by `email` ascending.
- `200` → paginated `{ "data": [ ...users ], "meta": { ... } }`
- `403` for non-Admin.

### `POST /api/v1/users` — Admin
```json
// request
{ "email": "grace@example.com", "name": "Grace Hopper", "role": "tester", "password": "temporal1" }
```
- `201` → `{ "data": { ...user } }` with `must_change_password: true`.
- `409` `CONFLICT` — email already exists.
- `400` `VALIDATION_ERROR` — invalid email, weak password, unknown role.
- `403` for non-Admin.

### `GET /api/v1/users/:id` — Admin
- `200` → `{ "data": { ...user } }` | `404` `NOT_FOUND`.

### `PATCH /api/v1/users/:id` — Admin
```json
// request — any subset
{ "name": "Grace Brewster Hopper", "role": "lead", "is_active": false, "password": "resetpw1" }
```
- `password` = Admin reset; the Admin shares it out-of-band. Never returned in
  a response; sets `must_change_password: true` on the target user.
- `200` → `{ "data": { ...user } }`
- `409` `CONFLICT` — setting `role != admin` or `is_active: false` would leave
  zero active Admins (last-admin rule).
- `404` `NOT_FOUND` | `403` for non-Admin.
- No `DELETE /users/:id` in MVP: users are deactivated, never hard-deleted.

## Role matrix

| Endpoint | Admin | Lead | Tester | Viewer | Public |
|---|---|---|---|---|---|
| `POST /auth/bootstrap` | – | – | – | – | ✔ (only when 0 users) |
| `POST /auth/login` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/refresh` | ✔ | ✔ | ✔ | ✔ | ✔ (cookie) |
| `POST /auth/logout` | ✔ | ✔ | ✔ | ✔ | – |
| `GET /auth/me` | ✔ | ✔ | ✔ | ✔ | – |
| `PATCH /auth/me` | ✔ | ✔ | ✔ | ✔ | – |
| `GET /users` | ✔ | – | – | – | – |
| `POST /users` | ✔ | – | – | – | – |
| `GET /users/:id` | ✔ | – | – | – | – |
| `PATCH /users/:id` | ✔ | – | – | – | – |

## Implementation notes (Hephaestus)
- Migration 1: `users` table (uuid pk, email unique not null, name, role enum,
  password_hash, is_active bool default true, must_change_password bool,
  created_at/updated_at timestamptz) and `refresh_tokens` table (token_hash pk,
  user_id fk, expires_at, created_at).
- Env: `JWT_SECRET` (required, ≥ 32 bytes), refresh-cookie `Secure` dev flag.
- Rate limiting in-memory is acceptable for MVP.
