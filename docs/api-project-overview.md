# API Contract — Project overview & results trend

Shared conventions (`/api/v1` prefix, envelopes, pagination, error format, auth,
security rules) live in `docs/api-conventions.md` and are not repeated here.
Product rules: `docs/PRD-project-overview.md`. Projects: `docs/api-projects.md`.
Runs and results: `docs/api-runs.md`. Milestones: `docs/api-milestones.md`.

This slice adds **one read-only endpoint**. No existing resource, field, query
param or error changes meaning. The overview's other panels are assembled from
endpoints that already exist:

| Panel | Source |
|---|---|
| Description, title, key, status | `GET /api/v1/projects/:id` (unchanged) |
| Results trend | `GET /api/v1/projects/:projectId/reports/trend` (new, below) |
| Milestones card | `GET /api/v1/projects/:projectId/milestones?sort=due_date&limit=5` (unchanged) |
| Test Runs card | `GET /api/v1/projects/:projectId/runs?sort=-created_at&limit=5` (unchanged) |

## Resource: Project trend

```json
{
  "data": {
    "project_id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
    "from": "2026-10-15",
    "to": "2026-10-28",
    "days": 14,
    "buckets": [
      {
        "date": "2026-10-15",
        "status_counts": {
          "passed": 3,
          "failed": 1,
          "blocked": 0,
          "retest": 0,
          "skipped": 0
        },
        "total": 4,
        "pass_rate": 75.0
      },
      {
        "date": "2026-10-16",
        "status_counts": {
          "passed": 0,
          "failed": 0,
          "blocked": 0,
          "retest": 0,
          "skipped": 0
        },
        "total": 0,
        "pass_rate": null
      },
      {
        "date": "2026-10-28",
        "status_counts": {
          "passed": 31,
          "failed": 4,
          "blocked": 1,
          "retest": 2,
          "skipped": 0
        },
        "total": 38,
        "pass_rate": 81.6
      }
    ],
    "totals": {
      "status_counts": {
        "passed": 412,
        "failed": 28,
        "blocked": 9,
        "retest": 6,
        "skipped": 15
      },
      "total": 470,
      "pass_rate": 90.5
    }
  }
}
```

### Fields
The example abbreviates the array: it shows the first bucket, an empty day and
the last bucket of a 14-day window; a real response always carries exactly 14
entries there, and `totals` covers all of them.

- `from`, `to` — plain calendar dates (`YYYY-MM-DD`), inclusive, in **UTC**.
  `to` is the current UTC date at the moment of the request; `from` is
  `to - (days - 1)`. Both are echoed so the client can label the axis without
  recomputing a date or re-deriving "today" in the browser's timezone.
- `days` — the window length actually used (the resolved `days` query param).
  The web's presets are 1, 7, 14 and 30 days with 14 as the default; the
  endpoint is deliberately wider (1–90) so the reports slice needs no contract
  change. The client titles the card and picks its empty-state copy from this
  echoed value, never from its own copy of the request.
- `buckets` — **exactly `days` entries**, oldest first, one per UTC calendar day
  from `from` to `to` inclusive, zero-filled. A day with no results is present
  with all-zero `status_counts`, `total: 0` and `pass_rate: null`; days are never
  omitted, so `buckets[i].date` is always `from + i` and the client can plot
  without filling gaps.
- `status_counts` — results **recorded** on that day, by `results.status`. Only
  the five recorded statuses appear: `passed`, `failed`, `blocked`, `retest`,
  `skipped`. `untested` is **never** a key, here or anywhere in this resource —
  an untested item has no result row, so it cannot be counted on a day.
- `total` — `passed + failed + blocked + retest + skipped`, i.e. every result
  recorded that day. It is a count of results, **not** a count of run items.
- `pass_rate` — percentage `0–100`, rounded half-up to **one decimal**, or
  `null` when the denominator is `0`. Denominator is
  `passed + failed + blocked + retest`; `skipped` is excluded, and `untested`
  cannot occur. `null` (rendered `—`) means "no verdict was recorded that day";
  it is never `0`, which would mean "every result failed".
- `totals` — the window sum. `status_counts` and `total` are the arithmetic sum
  of the buckets; `pass_rate` is **recomputed from the summed counts** with the
  same rule, not the mean of the daily rates (a one-result day must not weigh as
  much as a fifty-result day).

### What is counted
A result is in the window when:

```sql
runs.project_id = $project
and runs.deleted_at is null
and results.created_at >= $from_utc_boundary
and results.created_at <  $to_utc_boundary_exclusive
```

and it is bucketed by `(results.created_at AT TIME ZONE 'UTC')::date`.

- **Every result row counts**, not the latest per item. A retest is a new event
  on the day it happened; this is what "results recorded" means and why the
  trend differs from a run's `counts` (which counts each item once by its latest
  result). The endpoint does not use `LATEST_RESULT_JOIN`.
- **Soft-deleted runs are excluded** (`runs.deleted_at is null`), so deleting a
  run removes its results from the window even though the rows still exist.
- **Hard deletes change history.** Deleting a run item hard-deletes its results
  (`run_items` → `results` `on delete cascade`), so the trend can change
  retroactively. Accepted for the MVP (PRD decision 10); a future snapshot table
  is a reports-slice decision.
- `results.status` is immutable (`PATCH /results/:id` changes only `comment`,
  `elapsed_minutes`, `defect_url`), so `created_at` is a sound trend key and the
  series never rewrites itself except through deletion.

## Endpoint

### `GET /api/v1/projects/:projectId/reports/trend` — any authenticated role

| Query param | Rules |
|---|---|
| `days` | optional integer, `1–90`, default `14`. Anything else (`0`, `91`, `abc`, `1.5`, repeated) is `400` on `days`. The overview screen only ever sends the presets `1`, `7`, `14`, `30`; the wider range is for the reports slice |

- `200` → `{ "data": { ...trend } }` as above.
- `400` `VALIDATION_ERROR` — `days` is not an integer in `1–90`; `details` names
  the field (`days`).
- `404` `NOT_FOUND` — unknown project, or an archived project for a non-Admin
  (same rule as every other project-scoped read in `api-projects.md`).
- `401`/`403` — per `api-conventions.md`; there is no write path, so a role never
  gets `403` here except for an archived project, which is `404`.
- A project with no runs, or with runs but no results in the window, is **`200`
  with zero-filled buckets**, not `404` and not `204`.

### Role matrix

| Endpoint | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| `GET /projects/:projectId/reports/trend` | ✔ | ✔ | ✔ | ✔ |

Reading a trend is reading results, which every signed-in role may already do
(`GET /runs/:id/items/:itemId/results`). No new permission is introduced.

## Errors and edge cases
| Case | Response |
|---|---|
| `days=14` | 14 buckets, `from` = today − 13 days (UTC) |
| `days=1` | 1 bucket, `from = to` = today (UTC) |
| `days=7` / `days=30` | 7 / 30 buckets; the web's other two presets |
| `days=90` | 90 buckets |
| `days=0`, `days=91`, `days=1.5`, `days=abc` | `400`, `details: [{ "field": "days", "issue": "must be an integer between 1 and 90" }]` |
| `days` omitted | 14 |
| Empty project / no results in window | `200`, every bucket zero, `pass_rate: null`, `totals.total: 0`, `totals.pass_rate: null` |
| Results in another project | excluded, even when the caller can read that project |
| Result at `00:00:00Z` on `from` | included in the first bucket |
| Result at `23:59:59.999Z` on `to` | included in the last bucket |
| Result at `23:59:59.999Z` on `from − 1 day` | excluded |
| Soft-deleted run | its results are excluded |
| Archived project | `200` for Admin, `404` for Lead/Tester/Viewer |
| Unknown `projectId` (not a UUID / no row) | `404` |

## Implementation notes (Hephaestus)

### Migration
One additive migration, next timestamp in the sequence, e.g.
`20261028000001_reports_trend.js`:

```js
pgm.createIndex('results', ['created_at'], { name: 'results_created_at_idx' });
```

The query starts from `results` restricted by `created_at` and joins back
`run_items` and `runs` by primary key, so a plain `created_at` index is the one
that matters. `results_item_created_id_idx` and the `run_items`/`runs` primary
keys cover the rest. `down` drops the index. No table, column or constraint
changes. The index is safe on shared data: it is additive and locks nothing that
the dev DB does not already tolerate (same `CREATE INDEX` class as the milestone
migration).

### Query
Prefer one statement with `generate_series` so zero-filling is the database's
job and the service stays a mapper:

```sql
WITH days AS (
  SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
), agg AS (
  SELECT (res.created_at AT TIME ZONE 'UTC')::date AS day,
         count(*) FILTER (WHERE res.status = 'passed')::int  AS passed,
         count(*) FILTER (WHERE res.status = 'failed')::int  AS failed,
         count(*) FILTER (WHERE res.status = 'blocked')::int AS blocked,
         count(*) FILTER (WHERE res.status = 'retest')::int  AS retest,
         count(*) FILTER (WHERE res.status = 'skipped')::int AS skipped
  FROM results res
  JOIN run_items i ON i.id = res.run_item_id
  JOIN runs r ON r.id = i.run_id
  WHERE r.project_id = $1
    AND r.deleted_at IS NULL
    AND res.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND res.created_at <  (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1
)
SELECT d.day, coalesce(a.passed, 0) AS passed, ...
FROM days d LEFT JOIN agg a USING (day)
ORDER BY d.day;
```

- **Do not rely on the session `TimeZone`.** A bare `res.created_at >= $2::date`
  casts the date in the connection's timezone; a pooled connection with a
  non-UTC `TimeZone` would shift every boundary by hours. Use the explicit
  `AT TIME ZONE 'UTC'` expressions above (or `SET TIME ZONE 'UTC'` on the
  connection, but the explicit form is self-documenting and survives a pooler).
- Scope by `runs.project_id`, never by `run_items` alone or by a client-supplied
  result list.
- Read `from`/`to` once in the service (`to = today in UTC`, `from = to - days +
  1`) and pass them as parameters, so a request that runs across midnight UTC
  still returns a self-consistent window.

### Pass rate
One helper, e.g. `server/src/reports/pass-rate.ts`:

```ts
export function passRate(counts: Record<RecordedStatus, number>): number | null
```

- returns `null` when `passed + failed + blocked + retest === 0`;
- otherwise `Math.round(x * 1000) / 10` (half-up through `Math.round` for
  non-negative numbers), giving one decimal, e.g. `81.6`, `75`, `100`.
- Used for each bucket and for `totals`, so there is exactly one rounding rule.
  Unit-test `0/0 → null`, `0/4 → 0`, `31/38 → 81.6`, `412/455 → 90.5`,
  `1/3 → 33.3`, `2/3 → 66.7`, and that `skipped` never enters the denominator.

### Controller / module
- New `server/src/reports/` module: `reports.controller.ts` with
  `@Controller('projects/:projectId/reports')` and
  `@Get('trend')`, `reports.service.ts`, `reports.store.ts`, `pass-rate.ts`.
  Register it in `app.module.ts`; reuse the project-read guard/lookup the
  runs/projects modules already use (unknown → `404`; archived → Admin only,
  else `404`).
- Validate `days` with a DTO (`@Type(() => Number)` → `@IsInt()` →
  `@Min(1)` → `@Max(90)`), so `abc`/`1.5` fail as `400` on `days` and the
  response matches `api-conventions.md`'s error shape. Never accept a date
  range directly in this slice — `from`/`to` are derived, so a client cannot ask
  for an unbounded window.
- No `cache-control` beyond the auth-aware default: the response is
  user-specific only through the archived-project rule, so a shared cache is
  never correct.
- Do not denormalise daily counts, and do not add a `latest result` filter to
  this query — the difference from `run.counts` is intentional and documented
  above (PRD decision 4).

### Tests (Hephaestus)
Unit: bucket assembly (14 zero rows for an empty project; exact `from`/`to` for
`days=1`, `7`, `14`, `30`, `90`), pass-rate rounding and `null`, `totals`
recomputation.
e2e: the boundary cases in "Errors and edge cases" above, project scoping,
soft-deleted run exclusion, `skipped` excluded from the rate but present in
counts, `days` validation, role matrix, archived project (`200` Admin / `404`
Lead).