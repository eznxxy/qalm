# Qalm

Qalm is a test management web app — organise test cases, plan test runs,
record results, and view reports. Named after *qalam* (pen).

Built with **Next.js + TypeScript** on the front end and **NestJS + PostgreSQL**
on the back end. The UI follows the design system in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| PostgreSQL | 14+ (16 recommended) |
| npm | 9+ |

## Quick start

### 1. Clone and install

```bash
git clone git@github.com:eznxxy/qalm.git
cd qalm

# API dependencies
cd server
npm install

# Web dependencies
cd ../web
npm install
```

### 2. Set up the database

Create a database and user (or reuse an existing one):

```sql
CREATE USER qalm WITH PASSWORD 'your-password';
CREATE DATABASE qalm OWNER qalm;
```

Then run migrations:

```bash
cd server
cp .env.example .env
# Edit .env — set DATABASE_URL to your database, e.g.
#   postgres://qalm:your-password@localhost:5432/qalm
# JWT_SECRET is required: generate one with
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm run migrate:up   # or: node scripts/migrate.js up
```

### 3. Start the API (port 3001)

```bash
cd server
npm run start:dev
```

Health check: `curl http://localhost:3001/api/v1/health`
→ `{"data":{"status":"ok"}}`

### 4. Start the web app (port 3000)

```bash
cd web
npm run dev
```

Open **http://localhost:3000**.

### 5. Create your first admin

On first launch the app offers **bootstrap** — create the initial Admin
account through the UI, or:

```bash
curl -X POST http://localhost:3001/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"choose-a-strong-password","name":"Admin"}'
```

Bootstrap is disabled after the first user exists.

> In dev, CORS is controlled by `CORS_DEV_ORIGINS` in `server/.env`
> (default allows `http://localhost:3000`). Leave it empty to disable CORS.

---

## What's implemented (MVP slice 1)

- **Auth & roles** — email/password login, JWT sessions (15-min access,
  30-day rotating refresh, replay-revocation), rate limiting, four roles
  (Admin / Lead / Tester / Viewer), admin user management with a
  last-active-admin invariant
- **Projects** — create/edit, unique keys (`PAY` → `PAY-123` later),
  archive/restore, role-gated actions (Leads create + archive; edit/restore
  are Admin-only)
- **Design system** — dense, keyboard-first UI per
  [`docs/DESIGN.md`](docs/DESIGN.md): tokens, light theme, status colours,
  IBM Plex Sans, data tables, keyboard shortcuts (`?` in the app shows them)

## Not yet implemented (next slices)

Test suites & cases, test runs & results, plans, milestones, reports,
CSV import. See `docs/` for the PRDs and API contracts.

---

## Scripts

### Server (`/server`)

| Command | What it does |
|---|---|
| `npm run start:dev` | Dev server on :3001 (watch mode) |
| `npm run build` | Production build |
| `npm test` | Unit tests |
| `npm run test:e2e` | Integration/e2e suite (serial, scratch DB) |
| `npm run lint` | ESLint |
| `node scripts/migrate.js up` | Apply pending migrations (also `down` to revert) |

### Web (`/web`)

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Unit tests |
| `npm run lint` | ESLint |

---

## Project layout

```
qalm/
├── docs/           # PRDs, API contracts, design system, decisions
│   ├── DESIGN.md          # design system (tokens, components, a11y)
│   ├── PRD-*.md           # product requirements per feature
│   └── api-*.md           # REST contracts per feature
├── server/         # NestJS API (TypeScript, PostgreSQL)
│   ├── src/               # auth, users, projects, health modules
│   ├── migrations/        # DB migrations (run before first boot)
│   └── test/              # integration/e2e suites
└── web/            # Next.js app (TypeScript, Tailwind CSS)
    └── src/
        ├── app/           # routes (login, users, projects, …)
        ├── components/    # UI primitives (DataTable, badges, …)
        └── lib/           # API client, session, keymap
```

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — design system: tokens, components, states, a11y floor
- [`docs/api-conventions.md`](docs/api-conventions.md) — REST conventions (envelopes, errors, pagination)
- [`docs/api-auth.md`](docs/api-auth.md) / [`docs/api-projects.md`](docs/api-projects.md) — feature contracts
- [`AGENTS.md`](AGENTS.md) — how the multi-agent team builds this repo

## License

Private project — all rights reserved.
