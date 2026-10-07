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

## Environment (see `.env.example`)

| Variable | Required | Meaning |
|---|---|---|
| `JWT_SECRET` | yes | HS256 signing secret, >= 32 bytes; validated at boot |
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` for migrations and the app |
| `PORT` | no | Dev API port, fixed at 3001 (web app assumption) |
| `REFRESH_COOKIE_SECURE` | no | Set to exactly `true` only to relax the cookie `Secure` flag on plain-HTTP dev |

Config is validated before the server listens; a missing or invalid variable
kills the process with a single aggregated `ConfigError` listing every problem.

## API surface (this scaffold)

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
  errors.ts            ErrorCode union, ApiError, envelope types
  main.ts              bootstrap: validate env, pipe, filter, listen
  app.module.ts        root module (infra only; features come later)
  filters/             global exception filter -> shared envelope
  pipes/               global class-validator pipe -> VALIDATION_ERROR details
  health/              GET /api/v1/health
migrations/            node-pg-migrate migrations (up/down)
scripts/               migrate.js, wait-for-db.js, gen-env.js
```
