# API Contract — Project reports

Shared conventions (`/api/v1` prefix, envelopes, pagination, error format, auth,
security rules) live in `docs/api-conventions.md` and are not repeated here.
Product rules: `docs/PRD-reports.md`. Projects: `docs/api-projects.md`. Runs and
results: `docs/api-runs.md`. Milestones: `docs/api-milestones.md`. The overview's
trend resource, whose rules this endpoint reuses for `trend`: 
`docs/api-project-overview.md`.

This slice adds **one read-only endpoint**. No existing resource, field, query
param or error changes meaning. The endpoint returns the Reports tab in one
response: the window's recorded-results trend plus the current progress of the
project's runs, both scoped by the same filters.

| Reports panel | Source |
|---|---|
| Pass-rate and results tiles, failures over time | `trend` (same rules as `GET /reports/trend`, filtered) |
| Progress per run | `progress.data` |
| Items-complete tile | `progress.items` |

## Resource: Report summary

```json
{
  "data": {
    "project_id": "018f1c31-9d4e-7b2a-8c1f-2a3b4c5d6e7f",
    "from": "2026-09-29",
    "to": "2026-10-28",
    "days": 30,
    "filters": {
      "plan_id": null,
      "milestone_id": "018f4c40-8d5f-7a80-9c13-8d9e0f123456",
      "status": "open"
    },
    "trend": {
      "buckets": [
        {
          "date": "2026-09-29",
          "status_counts": {
            "passed": 12,
            "failed": 1,
            "blocked": 0,
            "retest": 1,
            "skipped": 0
          },
          "total": 14,
          "pass_rate": 85.7
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
    },
    "progress": {
      "data": [
        {
          "id": "018f3b22-5c4d-7e6f-8a91-6b7c8d9e0f12",
          "name": "Release 2.4 smoke",
          "status": "open",
          "plan_id": null,
          "plan_name": null,
          "milestone_id": "018f4c40-8d5f-7a80-9c13-8d9e0f123456",
          "milestone_name": "Release 2.4",
          "start_date": "2026-11-01",
          "due_date": "2026-11-14",
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
          "pass_rate": 83.8,
          "results_in_window": 38,
          "last_result_at": "2026-10-28T09:12:00Z"
        }
      ],
      "meta": {
        "page": 1,
        "limit": 25,
        "total": 3,
        "total_pages": 1
      },
      "items": {
        "total": 120,
        "with_results": 85,
        "untested": 35,
        "percent_complete": 71
      }
    }
  }
}
```

The example abbreviates `trend.buckets`: it shows the first and last bucket of a
30-day window; a real response always carries exactly `days` entries, oldest
first, zero-filled.

### Fields

- `project_id`, `from`, `to`, `days` — identical rules to the trend resource
  (`docs/api-project-overview.md` § Fields). `from`/`to` are inclusive UTC
  calendar dates, `to` is the current UTC date, `from = to - (days - 1)`.
  `days` defaults to **30** on this endpoint (the overview trend defaults to
  14); the four web presets are 1, 7, 14 and 30.
- `filters` — the resolved filters, echoed so the client labels its chips
  without re-parsing the URL. `null` means "no filter", a UUID means that
  resource, and the literal string `"none"` means "runs with no plan / no
  milestone". `status` is `"open"`, `"completed"` or `null`.
- `trend` — the Project trend resource **minus** its echoed `project_id`,
  `from`, `to` and `days`, which are at the top of this resource. Same
  `buckets`, same `totals`, same five recorded statuses, same pass-rate rule.
  Every result recorded in the window for a run matching `filters` counts, and
  a retest is a new event (every result row counts, not the latest per item).
  This is the source for the pass-rate tile, the results-recorded tile and the
  failures-over-time chart.
- `progress.data` — one entry per **live run** of the project matching
  `filters`, in the fixed order below. It is the run's **current state**, not
  its state at some point in the window:
  - `status` — `open │ completed`, derived from `completed_at` exactly as in
    `docs/api-runs.md`.
  - `plan_id` / `plan_name` — the linked plan and its current name, both
    `null` together when the run has no plan.
  - `milestone_id` / `milestone_name` — the linked milestone and its current
    name, both `null` together.
  - `start_date` / `due_date` — plain calendar dates (`YYYY-MM-DD`) or `null`,
    as in the Run resource.
  - `counts` — the same rollup object as the Run resource: each **item** once,
    by its latest result (or `untested` when it has none). `skipped` is a key;
    `percent_complete = round((total - untested) / total * 100)`, `0` when
    `total = 0`.
  - `pass_rate` — `passed / (passed + failed + blocked + retest)` from those
    counts, one decimal, `null` when the denominator is `0`. This is the run's
    **current** pass rate, not a windowed event rate; `skipped` is excluded
    from the denominator exactly as in the trend.
  - `results_in_window` — how many result rows were recorded for this run
    inside the window (retests included). It is activity, not progress: a run
    with `0` here still shows its real counts.
  - `last_result_at` — the `created_at` of the run's most recent result across
    **all time**, or `null` when it has none. It is deliberately not
    window-limited, so "last result 3 weeks ago" is visible rather than blank.
- `progress.meta` — standard pagination (`api-conventions.md`):
  `page`, `limit`, `total` (matching runs), `total_pages`
  (`max(1, ceil(total / limit))`, so a filter matching nothing reports
  `total: 0, total_pages: 1`). Pagination applies to `progress.data` only;
  `trend` and `progress.items` always cover the whole filtered set.
- `progress.items` — a rollup over **all runs matching `filters`**, not just
  the current page, using the same current-state rule as a plan's or
  milestone's rollup:
  - `total` — every run item in those runs.
  - `with_results` — items with at least one result (the latest-result status
    is anything but `untested`). `total - with_results = untested`.
  - `untested` — items with no result.
  - `percent_complete` — `round(with_results / total * 100)`, `0` when
    `total = 0`.

### Two clocks, on purpose

| Section | Answers | Scope |
|---|---|---|
| `trend` | "What happened in this window, and how did it go?" | **Events**: every result row recorded inside the window |
| `progress.data[].counts`, `pass_rate`, `progress.items` | "Where do the runs stand now?" | **Current state**: each item once, by its latest result, regardless of when that result was recorded |
| `progress.data[].results_in_window`, `last_result_at` | "Was this run active in the window?" | **Activity**: events inside the window, plus the latest event overall |

The window therefore **does not hide runs**. A run that has not been touched for
two months is still part of the project's current progress; hiding it would
make the project look finished. Its `results_in_window` is `0` and its
`last_result_at` says when it was last touched. Likewise, a run's
`percent_complete` is never computed from the window's results: recency is not
completion.

### Ordering

`progress.data` is ordered, always and stably:

1. `open` before `completed`;
2. `due_date` ascending, runs with no due date last;
3. `name` ascending, case-insensitively;
4. `id` ascending (tiebreaker).

There is no `sort` query param in this slice. The order surfaces runs that need
attention (open, nearest due date) without hiding completed ones; filter with
`status=open` to exclude them.

## Endpoint

### `GET /api/v1/projects/:projectId/reports/summary` — any authenticated role

| Query param | Rules |
|---|---|
| `days` | optional integer, `1–90`, default **30**. Anything else (`0`, `91`, `abc`, `1.5`, repeated) is `400` on `days`. The web only sends the presets `1`, `7`, `14`, `30` |
| `plan_id` | optional UUID, or the literal `none` for runs with no plan. A UUID that is unknown, deleted or belongs to another project matches nothing (`200`, empty), mirroring `GET /projects/:projectId/runs` |
| `milestone_id` | optional UUID, or `none` for runs with no milestone; same unknown-id rule |
| `status` | optional, `open │ completed`. Applies to `trend` (only results of runs in that status), `progress.data` and `progress.items` |
| `page` | optional integer `≥ 1`, default `1`; applies to `progress.data` only |
| `limit` | optional integer `1–100`, default `25`; applies to `progress.data` only |

There is no `from`/`to` input and no free-form date range: the window is `days`
ending today (UTC), exactly like the trend endpoint.

`status` is the run's **current** derived status, not a snapshot taken when each
result was recorded. Completing a run therefore moves all of its earlier results
into the `completed` view of `trend`; the report keeps no per-result history of
run status, and does not pretend to.

All filters apply to **both** sections. Filtering the summary by milestone while
the progress table still showed every run would make the tiles and the table
describe different projects.

- `200` → `{ "data": { ...report summary } }` as above.
- `400` `VALIDATION_ERROR` — an invalid query value; `details` names the field
  (`days`, `plan_id`, `milestone_id`, `status`, `page`, `limit`).
- `404` `NOT_FOUND` — unknown project, or an archived project for a non-Admin
  (same rule as every other project-scoped read in `api-projects.md`).
- `401`/`403` — per `api-conventions.md`. There is no write path, so a role
  never gets `403` here except for an archived project, which is `404`.
- A project with no runs, or with runs but no results in the window, is **`200`**
  with zero-filled buckets and empty/zeroed sections, never `404` and never
  `204`.
- A `page` past the last page is **`200`** with `progress.data: []` and the real
  `meta` (`total`, `total_pages`), like every other paginated list.

### Role matrix

| Endpoint | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| `GET /projects/:projectId/reports/summary` | ✔ | ✔ | ✔ | ✔ |

Reading a report is reading results, runs, plans and milestones, which every
signed-in role may already read. No new permission is introduced and no role
gets a write control on this screen.

## Errors and edge cases

| Case | Response |
|---|---|
| `days` omitted | `30` buckets, `from` = today − 29 days (UTC) |
| `days=1` | 1 bucket, `from = to` = today (UTC) |
| `days=0`, `days=91`, `days=1.5`, `days=abc` | `400`, `details: [{ "field": "days", "issue": "must be an integer between 1 and 90" }]` |
| `plan_id=none` | runs with `plan_id is null`; `filters.plan_id` echoes `"none"` |
| `plan_id` = another project's plan | `200`, no matching runs: zero buckets, `totals` zero/`null`, `progress.data: []`, `meta.total: 0`, `items` zero |
| `plan_id` = soft-deleted plan | same as unknown: its runs no longer point at it (plan delete detaches), so nothing matches |
| `milestone_id=none` | runs with `milestone_id is null` |
| `status=open` | results of open runs in `trend`, open runs in `progress`; `items` sums only those runs |
| Empty project (no runs) | `200`: `days` zero buckets, all totals `0`, `pass_rate: null`, `progress.data: []`, `meta: { page: 1, limit: 25, total: 0, total_pages: 1 }`, `items` all `0` |
| Runs but no results in the window | `200`: zero buckets and `pass_rate: null`; `progress.data` still lists each run with its real counts and `results_in_window: 0` |
| Results in another project | excluded, even when the caller can read that project |
| Result at `00:00:00Z` on `from` | included in the first bucket and in `results_in_window` |
| Result at `23:59:59.999Z` on `to` | included in the last bucket and in `results_in_window` |
| Result at `23:59:59.999Z` on `from − 1 day` | excluded from `trend` and `results_in_window` |
| Soft-deleted run | absent from `progress.data`; its results are absent from `trend` |
| Soft-deleted plan / milestone | run keeps `plan_id`/`milestone_id` only if the link survived; the name is `null` if the row is gone. Deleting through the API detaches the run first, so both fields are `null` |
| Archived project | `200` for Admin, `404` for Lead/Tester/Viewer |
| `projectId` is not a UUID | `400` `VALIDATION_ERROR` (path validation, as on every project-scoped route) |
| Well-formed `projectId` with no row | `404` `NOT_FOUND` |
| `page` beyond the last page | `200`, `progress.data: []`, real `meta` |
| `limit=101`, `page=0` | `400` on that field |

## Implementation notes (Hephaestus)

### No migration

The endpoint reads tables that already have the indexes it needs:
`results_created_at_idx` (migration `20261028000001`), `run_items_run_position_idx`,
`results_item_created_id_idx`, `runs_project_deleted_created_idx`,
`runs_plan_id_idx`, `runs_milestone_id_live`, and the primary keys. No table,
column, constraint or index changes. If a query plan on a large project
disagrees, raise it as a follow-up card with the plan; do not add an index
inside this slice without a contract note.

### Reuse the trend, do not fork it

`trend` must be the *same* series as `GET /reports/trend`, filtered. Extract the
existing `TREND_SQL` into a small builder (or add optional filter clauses) so
the two endpoints cannot drift: same UTC boundaries, same `AT TIME ZONE 'UTC'`
bucketing, same `generate_series` zero-fill, same pass-rate helpers
(`passRate`, `sumRecordedCounts`, `totalRecorded`). Do not re-derive pass rate
in a second place.

Filter fragment (resolve `none` in the service, pass `NULL` for absent):

```sql
AND ($4::uuid IS NULL OR r.plan_id = $4::uuid)
AND ($5::boolean IS NOT TRUE OR r.plan_id IS NULL)
AND ($6::uuid IS NULL OR r.milestone_id = $6::uuid)
AND ($7::boolean IS NOT TRUE OR r.milestone_id IS NULL)
AND ($8::text IS NULL
     OR (($8 = 'open') = (r.completed_at IS NULL)))
```

Keep the `none` sentinel out of the `::uuid` cast — casting the literal
`'none'` is an error. When `plan_id` is `none`, pass `planId = NULL,
planNone = true`, and so on.

### Progress query

One statement for the page plus one for `progress.items`, each reusing the
`LATEST_RESULT_JOIN` rule so a run's counts match `GET /projects/:id/runs`
exactly (a second definition of "latest result" would be a contract bug).

Sketch:

```sql
SELECT r.id, r.name, r.plan_id, p.name AS plan_name,
       r.milestone_id, m.name AS milestone_name,
       r.start_date::text, r.due_date::text,
       (r.completed_at IS NOT NULL) AS completed,
       count(i.id)::int AS total,
       count(*) FILTER (WHERE lr.status = 'passed')::int  AS passed,
       count(*) FILTER (WHERE lr.status = 'failed')::int  AS failed,
       count(*) FILTER (WHERE lr.status = 'blocked')::int AS blocked,
       count(*) FILTER (WHERE lr.status = 'retest')::int  AS retest,
       count(*) FILTER (WHERE lr.status = 'skipped')::int AS skipped,
       count(*) FILTER (WHERE i.id IS NOT NULL AND lr.id IS NULL)::int AS untested,
       (SELECT count(*)::int
          FROM results res
          JOIN run_items ri ON ri.id = res.run_item_id
         WHERE ri.run_id = r.id
           AND res.created_at >= $from_bound
           AND res.created_at <  $to_bound) AS results_in_window,
       (SELECT max(res.created_at)
          FROM results res
          JOIN run_items ri ON ri.id = res.run_item_id
         WHERE ri.run_id = r.id) AS last_result_at
  FROM runs r
  LEFT JOIN plans p ON p.id = r.plan_id
  LEFT JOIN milestones m ON m.id = r.milestone_id
  LEFT JOIN run_items i ON i.run_id = r.id
  LEFT JOIN LATERAL ( /* latest result for i, as LATEST_RESULT_JOIN */ ) lr ON true
 WHERE r.project_id = $1
   AND r.deleted_at IS NULL
   /* filter fragment above */
 GROUP BY r.id, p.name, m.name
 ORDER BY (r.completed_at IS NOT NULL), r.due_date ASC NULLS LAST,
          lower(r.name), r.id
 LIMIT $limit OFFSET $offset;
```

Gotchas:

- `untested` must be `count(*) FILTER (WHERE i.id IS NOT NULL AND lr.id IS NULL)`.
  A run with **zero items** produces one null-extended row from the
  `LATERAL` join; without the `i.id IS NOT NULL` guard it would report
  `untested: 1` and a non-zero `total` mismatch. With the guard every count is
  `0`.
- `start_date`/`due_date` are selected `::text` so pg hands back
  `YYYY-MM-DD`, never a timezone-shifted `Date` (same rule as the runs store).
- Build `counts` with `percentComplete(total, untested)` and `pass_rate` with
  the existing `passRate` helper (construct `RecordedCounts` from the five
  recorded statuses). Do not average per-run rates.
- `progress.items` is the sum over **all** matching runs, not the page. Either
  run a second rollup statement or sum with a window function; reuse
  `sumCounts` on the server so the rounding matches plans and milestones.
- `meta` uses the shared list-meta helper (`max(1, ceil(total / limit))`).
- `limit`/`page` defaults and the max are the existing `DEFAULT_PAGE`,
  `DEFAULT_LIMIT`, `MAX_LIMIT` constants; do not invent new numbers.

### Tests worth writing

- Window boundaries: `00:00:00Z` on `from` included, `23:59:59.999Z` on
  `from - 1` excluded; `days=1` has one bucket.
- `days` default is 30 here, not 14 (regression against the trend default).
- A retest adds to `trend` but never changes a run's `counts`.
- `results_in_window` is 0 for a run whose only results predate the window,
  while its `percent_complete` is not 0.
- `plan_id=none`/`milestone_id=none` select the null groups; an unknown UUID
  returns an empty `200`, not `404`.
- `status=open` filters both `trend` and `progress`.
- Completing a run moves its earlier results from the `open` view to the
  `completed` view of `trend` (status is current, not a snapshot).
- A run with zero items reports `counts.total = 0`, `untested = 0`,
  `percent_complete = 0`, `pass_rate = null` (the null-row trap above).
- `page` past the end returns an empty page with the real `meta`.
- Archived project: `200` for Admin, `404` for the other three roles.
- A Viewer gets the same body as an Admin.