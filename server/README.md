# Qalm API Server

NestJS + TypeScript backend for Qalm. Scaffolded by task
`t_bd0b6783` (qalm-2a): strict TS app skeleton, shared error envelope,
validated env config, and database migrations. Feature modules (auth, users,
projects) are separate tasks.

## Stack

- NestJS 10, TypeScript 5 (strict), Express
- PostgreSQL 16, migrations via node-pg-migrate (plain JS, up/down)
- Jest + ts-jest for unit tests, ESLint 9 (flat config) + Prettier

## Getting started

```bash
# 1. Postgres (docker compose at repo root, or any local postgres 16)
cd .. && docker compose up -d && cd server

# 2. Environment
npm install
node scripts/gen-env.js        # writes .env with a random JWT_SECRET (never committed)

# 3. Migrations
npm run migration:run          # applies pending migrations (waits for postgres)

# 4. Dev server on http://localhost:3001
npm run start:dev
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Dev server with watch/reload (port 3001 — fixed, the web app assumes it) |
| `npm run build` | Production build to `dist/` |
| `npm test` | Unit tests (jest) |
| `npm run lint` | ESLint over `src/` and `test/` |
| `npm run migration:run` | Apply pending migrations (waits for the DB first) |
| `npm run migration:revert` | Revert the most recent migration |
| `node scripts/gen-env.js` | Create `.env` from scratch with a random JWT secret |
| `npm run test:e2e` | Integration tests against the throwaway DB in `.env.test` (see below) |

## Environment (see `.env.example`)

| Variable | Required | Meaning |
|---|---|---|
| `JWT_SECRET` | yes | HS256 signing secret, >= 32 bytes; validated at boot |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` for migrations and the app |
| `PORT` | no | Dev API port, fixed at 3001 (web app assumption) |
| `REFRESH_COOKIE_SECURE` | no | Set to exactly `true` only to relax the cookie `Secure` flag on plain-HTTP dev |
| `CORS_DEV_ORIGINS` | no | Comma-separated exact browser origins for dev CORS (default `http://localhost:3000` via gen-env) |

Config is validated before the server listens; a missing or invalid variable
kills the process with a single aggregated `ConfigError` listing every problem.

## Browser-to-API access in dev (CORS decision)

The web app calls this API cross-origin (`next dev` on `:3000` →
`localhost:3001`, `fetch` with `credentials: "include"`), so the server —
not a Next.js rewrite proxy — answers preflight: `CORS_DEV_ORIGINS`
allowlist-echoes exact origins with `credentials: true`, which is also what
lets the `SameSite=Lax` `HttpOnly` refresh cookie ride along (different
localhost ports are still same-site). A same-origin proxy was rejected
because it would only mask the cross-origin shape production browsers will
actually use, while touching `/web` (outside backend ownership) for zero
auth benefit. Empty/unset disables CORS entirely; wildcards and non-bare
origins fail fast at boot.

## Integration tests (test/*.e2e-spec.ts)

They boot the real app against a THROWAWAY scratch database. Credentials live
in `server/.env.test` (gitignored, mode 600). One-time setup per environment:

```bash
# 1. an empty role + database (names are arbitrary; nothing is hard-coded)
sudo -u postgres psql -v role=qalm_test_r -v db=qalm_test -v pw='<random>' <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pw';
CREATE DATABASE :"db" OWNER :"role";
SQL

# 2. write .env.test (generates the JWT secret; the password never prints)
QALM_TEST_DATABASE_URL='postgres://qalm_test_r:<random>@localhost:5432/qalm_test' \
  node scripts/gen-env-test.js

# 3. migrate the scratch DB and run the suite
DATABASE_URL=$(grep '^DATABASE_URL=' .env.test | cut -d= -f2-) npm run migration:run
npm run test:e2e
```

The suite truncates all tables between tests — never point `.env.test` at a
database you care about. Run the unit suite independently with `npm test`
(no database needed).

The e2e specs share ONE scratch database (`test/helpers.ts` `resetDb`
truncates `refresh_tokens`/`projects`/`users` in every `beforeEach`), so the
suite must run serially: `npm run test:e2e` passes `--runInBand`, and
`test/jest-e2e.json` pins `maxWorkers: 1` so even a bare `jest --config ...`
invocation cannot run specs in parallel workers (overlapping workers used to
truncate/seed under each other — FK violations, duplicate-email inserts, and
cascading hook timeouts). The e2e config also raises `testTimeout` to 30s:
the projects `beforeEach` does four real bcrypt cost-12 hashes plus four real
logins (~3s on a quiet box, worse under load), which flaked against jest's
5s default hook timeout. Do not raise `maxWorkers` without first giving each
spec file its own scratch database.

## API surface (user management, task 2b2)

- `GET /api/v1/users` — Admin only; substring search on email/name (`query`),
  `role` filter, `page`/`limit` envelope, sorted by `email` ascending
- `POST /api/v1/users` — Admin creates a user (email, name, role, initial
  password); `must_change_password=true` on the created user, 409 on a
  case-insensitive duplicate email
- `GET /api/v1/users/:id` — Admin reads one user (404 unknown, 400 malformed
  uuid)
- `PATCH /api/v1/users/:id` — Admin updates any subset of name/role/is_active/
  password; a password reset sets `must_change_password=true` and revokes the
  target's active refresh tokens; demoting/deactivating the last active Admin
  → 409; empty PATCH is a 200 no-op
- Lead/Tester/Viewer get 403 on every user-management endpoint; no DELETE
  route exists (users are deactivated, never hard-deleted)

## API surface (auth core, task 2b1)

- `POST /api/v1/auth/bootstrap` — first Admin only, 409 afterwards
- `POST /api/v1/auth/login` — uniform 401s; in-memory limit 10 fails / email+IP / 15 min → 429 + `Retry-After`
- `POST /api/v1/auth/refresh` — 30-day rotating refresh token, HttpOnly
  SameSite=Lax cookie on `/api/v1/auth`; reusing a rotated token revokes all
  of that user's refresh tokens
- `POST /api/v1/auth/logout` — revokes the presented refresh token, clears the cookie (204)
- `GET|PATCH /api/v1/auth/me` — profile read; name change and self password
  change (current password required, 400 on mismatch)
- Access tokens: HS256 JWT, 15 min, `sub` + `role`, `iss=qalm`; deactivated
  users are rejected immediately (guard re-checks the DB per request)
- `GET /api/v1/health` — public infrastructure endpoint →
  `200 {"data":{"status":"ok"}}` (documented exception, not a feature contract).

All errors leave through the global exception filter in the shared envelope
(`docs/api-conventions.md`):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [{ "field": "email", "issue": "must be a valid email address" }]
  }
}
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429, with `Retry-After`),
`INTERNAL` (500, never leaks stack traces).

## Migrations

Written for node-pg-migrate (chosen over TypeORM migrations: SQL-faithful,
reversible, no ORM lock-in for schema). They live in `migrations/` and are
plain CommonJS with `up`/`down`.

- `20261008000001_auth_users_refresh_tokens.js` — `users` +
  `refresh_tokens` (api-auth.md § Implementation notes)
- `20261008000002_projects.js` — `projects` with case-insensitive unique
  indexes on `lower(name)` / `lower(key)` (api-projects.md § Implementation notes)

Verified on a fresh PostgreSQL 16 database: up → revert → revert → up, all
clean (2026-10-08). Constraint sanity checks passed: duplicate
email/case-variant project name and key rejected, unknown role rejected,
deleting a user who owns a project blocked (`ON DELETE RESTRICT`).

## Layout

```
src/
  config.ts            boot-time env validation (fail-fast)
  config.module.ts     global DI provider for the validated AppConfig
  errors.ts            ErrorCode union, ApiError, envelope types
  main.ts              bootstrap: validate env, shared wiring, listen
  app.setup.ts         HTTP wiring shared by main.ts and the test harness
  app.module.ts        root module (wires feature modules)
  db/                  pg Pool wrapper (boot ping, transactions)
  auth/                bootstrap/login/refresh/logout/me, guard, DTOs,
                       password + token services, rate limit, refresh store
    users/               shared user queries (used by auth)
    users-admin/         Admin user-management: DTOs, store, service, module
    projects/            projects API (CRUD + archive/restore)
  filters/             global exception filter -> shared envelope
  pipes/               global class-validator pipe -> VALIDATION_ERROR details
  health/              GET /api/v1/health
migrations/            node-pg-migrate migrations (up/down)
scripts/               migrate.js, wait-for-db.js, gen-env.js, gen-env-test.js
test/                  integration suite (throwaway scratch DB, .env.test)
```
