# PRD — Reports (MVP)

Status: **Proposed** — awaiting approval (owner: Arif). No code is written before
this document and `docs/api-reports.md` are approved (`/AGENTS.md`, contracts
first).
Owner: Daedalus
Slice: 6 (after `PRD-project-overview.md`; see `docs/README.md`)
API contract: `docs/api-reports.md` — one new read-only endpoint,
`GET /api/v1/projects/:projectId/reports/summary`
Design: `docs/DESIGN.md` §3 (shell, table scrolling), §4.6 (report widgets,
"View as table", chart rules), §4.8 (tab strip), §5 (tabs, status bar/badge), §6
(states), §8 (a11y), §9 (dates/copy)
Depends on: slice 3 (`api-runs.md` — runs and results), slice 4
(`api-milestones.md` — milestone rollup), slice 5 (`api-project-overview.md` —
the trend resource whose rules this slice reuses). Adds no field to any existing
resource.

## Problem

The project overview answers "what happened lately" for one project, over one
unfiltered window: a trend, the nearest milestones and the newest runs. It does
not answer the next three questions a Lead asks before a release:

- **How is this project doing over a window I choose?** The overview trend is
  tied to the project as a whole; a plan or a milestone cannot be isolated.
- **Which runs are behind?** Progress exists on the runs screen, one run at a
  time or as a flat list, with no pass rate and no project-level rollup.
- **When did things start failing?** Failures are visible inside a run's items,
  never as a series across the project.

The Reports tab has been a disabled `<span>` with "Reports arrive in a later
slice" since slice 5. This slice makes it the read-only quality view of a
project: one window, one set of filters, the project's pass rate, its failures
over time and every run's current progress in one screen, backed by one
aggregate endpoint.

## Goals

- The **Reports tab is a real link** to `/reports?project=:id`; the disabled
  span and its hint are gone. The tab strip keeps working as it does today.
- **One screen answers the three questions**: a window and plan/milestone/status
  filters at the top, four summary tiles, a failures-over-time chart and a
  paginated progress-per-run table.
- **One request, one truth.** The screen is backed by one aggregate endpoint
  whose `trend` section is the same series as the overview trend (filtered), and
  whose run progress reuses the Run resource's counts. The client does not
  recompute pass rates, join lists or fetch run pages to build totals.
- **The numbers are honest about two different clocks.** Pass rate and failures
  describe *events recorded in the window*; run progress describes *where each
  run stands now*, with window activity shown beside it. Neither is allowed to
  masquerade as the other.
- **Read-only for everyone.** No write path, no create buttons, no export in
  this slice; Admin, Lead, Tester and Viewer all read the same report.
- **A project with no data is a real state**, not an empty frame: zero-filled
  days, explicit copy, and links to the screen that can create data.

## Non-goals (MVP)

- **Export of any kind.** No CSV, PDF, print stylesheet, share link or
  scheduled email. CSV import/export is the next slice's scope; a printable
  report is not in the MVP.
- **A custom date range.** The four presets (1, 7, 14, 30 days) with 30 as the
  default; no calendar picker, no `from`/`to` in the UI or the API.
- **Failures by section, activity feed, burndown, velocity, per-assignee or
  per-tester breakdowns, comparison of two windows, or a draggable dashboard.**
  `DESIGN.md` §4.6 sketches several of these; this slice ships only the three
  MVP reports.
- **A second pass-rate-over-time chart.** The overview already charts pass rate
  over its own window; the reports screen shows the window pass rate as a tile
  and per run, and uses the chart for failures. A pass-rate line on this screen
  is a later enhancement, not a requirement.
- **Saved filter views, subscriptions, background refresh, live updates or a
  snapshot table.** The report is computed on read, like the trend.
- **Write actions from reports**: creating a run, adding a result or editing a
  plan/milestone. Every row links to the screen that already owns that action.

## What the screen shows

### Entry

The project overview's tab strip gains a fifth live tab:

| Tab | Target | State |
|---|---|---|
| Reports | `/reports?project=:id` | **live** |

The disabled `<span>`, `aria-disabled="true"` and the "Reports arrive in a later
slice" hint are removed. The Reports screen itself follows the other
project-scoped screens (`/runs`, `/milestones`, `/cases`): the top-bar project
switcher scopes it, `?project=` is the source of truth, a direct link with no
project resolves the first visible project and writes it into the URL. Unlike
the overview, it does not render the project tab strip; it shows a breadcrumb
`← <Project name>` back to `/projects/:id` above its `Reports` heading.

The **sidebar** Reports item stops pointing at the `/wip/reports` placeholder
and points at `/reports` with no project, exactly like "Test runs" points at
`/runs`; the screen then resolves the first visible project. `reports` is
removed from the `/wip/[slug]` section list, so a hand-typed `/wip/reports`
falls through to the raw-slug placeholder like every other retired section. The
app-shell test that pins `["Reports", "/wip/reports"]` is updated with the link;
that is a deliberate contract change, not a loosened test.

### Filter bar

| Control | Values | Default |
|---|---|---|
| Window | segmented `1d · 7d · 14d · 30d`, labelled group "Report window" | `30d` |
| Plan | All plans · each plan · No plan | All plans |
| Milestone | All milestones · each milestone · No milestone | All milestones |
| Status | All · Open · Completed | All |
| Reset filters | appears when plan, milestone or status is not the default | resets those three, keeps the window and returns to page 1 |

- The window is the same control as the overview's trend card (`aria-pressed`,
  32px targets, full labels for assistive tech). It lives in the URL as
  `?days=30`; an unknown value falls back to 30 silently.
- Plan and milestone options come from the existing lists
  (`GET /projects/:id/plans?limit=100`,
  `GET /projects/:id/milestones?limit=100`); "No plan" / "No milestone" send
  `none`. A failed options fetch leaves the select with only "All" and the
  report still renders (the filter is optional, never a blocker).
- Every filter is URL state (`?days`, `?plan`, `?milestone`, `?status`, `?page`)
  so a reload, a shared link and the back button keep the view. Changing any
  filter or the window resets `page` to 1. Changing the window does not clear
  the plan/milestone/status filters.
- "Reset filters" keeps the selected window; the window is a view setting, not
  a filter.

### Summary tiles

Four tiles above the charts, in this order, all fed by the one response:

| Tile | Value | Sub-line |
|---|---|---|
| Pass rate | `trend.totals.pass_rate`, one decimal, `—` when `null` | "last 30 days" / "today"; when `null`, "No verdicts in this window" |
| Results recorded | `trend.totals.total` | "last 30 days" / "today" |
| Runs | `progress.meta.total` | "matching filters" when a filter is active, otherwise "in this project" |
| Items complete | `progress.items.percent_complete`% | "`with_results` of `total` items" |

An empty project shows `—`, `0`, `0` and `0%` — never `0%` for a missing pass
rate.

### Failures over time

A card titled "Failures over time, last 30 days" (or "… today"), plotted from
`trend.buckets`:

- One column per UTC day of the window, exactly `days` slots including days with
  no results; a day with no failures draws no bar but keeps its slot.
- Three stacked series, in this order: **Failed**, **Blocked**, **Retest** —
  the three outcomes that mean "not verified as working". `Skipped` and
  `Passed` are not plotted here (they are in the tiles and in the table on the
  overview).
- Status colours only (§2.2), a text legend that names every series, integer
  count axis anchored at 0 with at most five gridlines, and a footer note
  "UTC days".
- **View as table** toggle (`aria-expanded`), as on the overview: Date, Failed,
  Blocked, Retest, Total — one row per day, including zero days.
- Empty-window copy: if the window has no results at all, "No results recorded
  in the last 30 days." ("… today.") with a "Go to Test runs" link; if results
  exist but none of them failed, blocked or retested, "No failed, blocked or
  retested results in the last 30 days."
- Hover/focus a day: tooltip with the date and the three counts. The chart is a
  single `role="img"` with an `aria-label` summarising the window and totals;
  the table is the accessible detail path.

### Progress per run

A table fed by `progress.data`, titled "Progress per run", with the matching run
count beside it.

| Column | Content |
|---|---|
| Run | Name, link to `/runs/:id` (project scope preserved) |
| Status | `Open` / `Completed` badge |
| Plan | `plan_name` or `—` |
| Milestone | `milestone_name` or `—` |
| Due | `due_date` via `web/src/lib/dates.ts`, or `—` |
| Progress | `31 of 50`, the status bar and `74% complete` (same primitives as the overview's Test Runs card) |
| Pass rate | Per-run `pass_rate`, one decimal, `—` when `null` |
| Activity | `38 in window · 2 h ago` from `results_in_window` + `last_result_at`; `No results in window` when the count is 0; `No results yet` when `last_result_at` is `null` |

- Rows are ordered open-first, then due date ascending with undated last, then
  name — the contract's fixed order. There is no sort control in this slice.
- Pagination is 25 per page (100 max): "Page 1 of 2 · 3 runs", Previous/Next.
  Pagination applies to the table only; the tiles and `progress.items` always
  describe every filtered run, so the pass-rate and items-complete tiles do not
  change when the page changes.
- The table scrolls horizontally inside its own container at narrow widths
  (§3); the page body never scrolls sideways.
- A run row links to its detail; there is no inline result recording here.

### Empty, loading and error states (§6)

| Situation | What renders |
|---|---|
| No runs in the project | Tiles `—`/`0`/`0`/`0%`; failures card shows "No results recorded in the last 30 days." with "Go to Test runs"; table shows "No runs in this project yet." with "Go to Test runs" |
| Runs exist, no results in the window | Failures card shows the window's empty copy; the table still lists every run with its real progress and "No results in window" |
| Results exist, no failures | Failures card says "No failed, blocked or retested results in the last 30 days."; zero columns, axes and legend stay |
| Filters match no runs | Tiles zero; failures card keeps "No results recorded…" copy; table says "No runs match these filters." with "Clear filters" |
| Page beyond the last page | Table says "No runs on this page." with "Go to page 1"; `meta` still reports the real total |
| Loading | Tile and card skeletons (a chart skeleton with axes, not a spinner); the heading, filter bar and breadcrumb render immediately |
| The report request fails | One page-level panel: "Couldn't load this report. Check your connection and retry." with Retry; the filter bar keeps the chosen values, and Retry refetches them |
| `days` outside 1–90 | Server `400`; the web only sends 1, 7, 14 or 30, and a URL value outside that set falls back to 30 before any request |
| Project 404 / 403 | The existing project-level states ("Project not found" / "Forbidden") are unchanged |
| Archived project | The report renders for an Admin; non-Admin gets the existing 404. There is no write control on this screen for any role, so no extra read-only banner is added |
| No project in the URL | Resolve the first visible project and rewrite the URL; with no projects at all, show the existing "No projects yet" state with a link to Projects |

Because the screen is one aggregate request, a failure is one panel, not five
independently failing cards. That is a deliberate consequence of the aggregate
design (decision 1), and the filter bar stays usable so Retry can be aimed.

## Roles

Read-only addition; no endpoint in this slice writes.

| Action | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| Open Reports from the project tab strip | ✔ | ✔ | ✔ | ✔ |
| Read the tiles, failures chart and progress table | ✔ | ✔ | ✔ | ✔ |
| Change the window and filters | ✔ | ✔ | ✔ | ✔ |
| Create/edit anything from this screen | – | – | – | – |
| Read an archived project's report | ✔ | – | – | – |

The last row is the existing project rule (`api-projects.md`): archived projects
are invisible to non-Admins, so they get `404` before any report is built.

## Acceptance criteria

1. The project overview's tab strip shows Reports as a real link to
   `/reports?project=:id`; the disabled span, `aria-disabled`, its hover/focus
   hint and the `sr-only` hint text are gone. Overview, Milestones, Test runs and
   Test cases behave exactly as before, and no Todo tab appears. The sidebar's
   Reports item links to `/reports` instead of `/wip/reports`, and `/wip/reports`
   renders the raw-slug placeholder because `reports` left the section list.
2. Opening `/reports?project=:id` shows the breadcrumb `← <Project name>` (to
   `/projects/:id`), the heading "Reports", the filter bar, four tiles, the
   failures card and the progress table. Opening `/reports` with no project
   resolves the first visible project and writes `?project=` into the URL.
3. The window offers 1, 7, 14 and 30 days with **30 selected on first load**;
   the selected option is exposed with `aria-pressed`, and the choice is in the
   URL (`?days=7`). Reloading or sharing that URL keeps it. `?days=99`,
   `?days=abc` or no value falls back to 30 without an error.
4. The plan filter offers "All plans", every live plan and "No plan"; the
   milestone filter offers "All milestones", every live milestone and "No
   milestone"; the status filter offers All/Open/Completed. All four controls
   (including the window) live in the URL, and a reload restores them.
5. Changing the window or any filter refetches the report and resets the table
   to page 1; changing the window keeps the plan/milestone/status selections.
   "Reset filters" clears plan, milestone and status, keeps the window, and
   returns to page 1.
6. The four tiles read: window pass rate (one decimal, `—` when there were no
   verdicts), results recorded in the window, matching run count, and items
   complete with "`x` of `y` items". Their values equal `trend.totals.pass_rate`,
   `trend.totals.total`, `progress.meta.total` and
   `progress.items.percent_complete` for the same filters.
7. The failures chart draws exactly one slot per UTC day of the selected
   window, oldest first, zero-filled, with Failed/Blocked/Retest stacked and
   named in a text legend. A day with no results or no failures keeps its slot
   and draws no bar. The chart never plots `passed`, `skipped` or `untested`.
8. "View as table" replaces the failures chart with a table of the same days
   (Date, Failed, Blocked, Retest, Total) and back; it is a real button with
   `aria-expanded`, and every value matches the chart.
9. Every daily pass rate and the window pass rate follow
   `passed / (passed + failed + blocked + retest)`, one decimal; `skipped` is
   excluded from the denominator; a zero denominator is `—`, never `0%`.
10. The progress table lists every live run matching the filters, ordered open
    first, then due date ascending with undated last, then name; each row shows
    the run link, status, plan or `—`, milestone or `—`, due date or `—`,
    `x of y` with the status bar and `% complete`, per-run pass rate or `—`, and
    the activity text.
11. A run's progress columns are its **current** state: they do not change when
    the window changes. Only `results_in_window` (and therefore the activity
    text) follows the window. A run whose results all predate the window still
    shows its real `% complete` and `No results in window`.
12. The table paginates 25 rows per page with Previous/Next and "Page `p` of
    `n`"; the tiles do not change when the page changes, because
    `progress.items` covers every filtered run. A `page` beyond the end renders
    the "No runs on this page." state with a link back to page 1.
13. With no runs the tiles are `—`/`0`/`0`/`0%`, the failures card shows "No
    results recorded in the last 30 days." with a link to Test runs, and the
    table shows "No runs in this project yet." A filter matching nothing shows
    "No runs match these filters." with "Clear filters". An empty failures
    window with no results is distinct from a window with results but no
    failures ("No failed, blocked or retested results…").
14. Loading shows skeletons for the tiles and cards while the filter bar stays
    usable. A failed request shows one "Couldn't load this report." panel with
    Retry, keeps the chosen filters, and retrying refetches the same window and
    filters. A session that expires is handled by the shared auth behaviour.
15. The screen is read-only for every role: there is no create, edit, delete,
    export or print control, and Tester/Viewer see exactly the same data and
    controls as Admin/Lead. An archived project renders the report for an
    Admin; a non-Admin sees the existing "Project not found" state.
16. The chart is one accessible image (`role="img"`) with an `aria-label` that
    names the window and the three plotted totals; the table view is the
    detailed accessible path. Status colours come only from §2.2, every series
    is named in text, the segmented window control and the table toggle expose
    their state, focus is always visible, and contrast meets 4.5:1.
17. At 1440, 1024 and 768 the tiles wrap (4 → 2 → 1), the chart keeps a readable
    height, and the table scrolls horizontally inside its own container without
    the page body scrolling sideways.
18. All date rendering goes through `web/src/lib/dates.ts`; the screen never
    formats a date or a relative time itself, and pass-rate percentages use one
    decimal while item completion uses whole percent.
19. A request for the report is one call to
    `GET /projects/:projectId/reports/summary`; the screen does not fetch
    `GET /reports/trend` or paginate `GET /runs` to assemble its own totals. The
    only extra calls are the plan and milestone option lists for the filters.

## Decisions (proposed — for approval)

1. **One aggregate endpoint, not a client-side composition.** The owner chose
   this over reusing `GET /reports/trend` plus `GET /runs` on the client. The
   aggregate buys: one round trip; plan/milestone/status filters applied
   consistently to the event series *and* the run rollup; window-scoped run
   activity (`results_in_window`, `last_result_at`) that `GET /runs` does not
   carry; and one place where the two views of the same project cannot disagree.
   It costs a new route, a filtered trend query and a progress rollup — accepted.
   Rejected: browser composition, which would fetch a page of runs and silently
   compute "totals" from it.
2. **Two clocks, named in the contract.** The trend is event history in the
   window (every result row, retests included); run progress is current state
   (each item once, latest result). A report that hid runs untouched for a month
   would make a stale project look done; a progress percentage computed from
   one week's results would call an almost-finished run 0% complete. The screen
   shows both, labelled, rather than picking one meaning of "progress".
3. **Filters apply to both sections.** A milestone filter that changed the
   tiles but not the table (or vice versa) would produce a screen describing two
   different subsets. `none` is a first-class value for plan and milestone, as
   on the runs screen; an unknown or foreign UUID is an empty `200`, not a
   `404`, mirroring `GET /projects/:id/runs`.
4. **30-day default, four presets, no calendar.** "Last 30 days" is the
   reference reports window (`DESIGN.md` §4.6) and the useful default for a
   release check. The overview keeps its 14-day default because it is a glance;
   the reports screen is an investigation. The API still accepts 1–90 so a
   future preset needs no contract change.
5. **Failures are Failed + Blocked + Retest.** These are the three outcomes that
   mean "this case is not verified as working"; `skipped` was never executed and
   `passed` is the opposite of a failure. Stacking the three shows whether a
   project is failing or merely stuck, which a single "failed" line would hide.
6. **The pass-rate rule is not restated in a second implementation.** The
   aggregate reuses the trend's `passRate`/`sumRecordedCounts` helpers for the
   window and the same helper for each run's current counts. Two formulas would
   eventually disagree at a rounded boundary.
7. **Current run progress is not windowed; activity is.** A run's counts and
   pass rate are facts about the run now. The window answers "was it active?"
   through `results_in_window` and `last_result_at`. This is the only split that
   keeps both "progress per run" and "last 30 days" honest.
8. **Fixed order, no sort control.** Open runs first, then nearest due date,
   then name surfaces what needs attention without adding a sort UI whose
   semantics (sort by pass rate across pages?) would need their own contract.
   The status filter covers "show only open".
9. **Pagination on the table, totals over the whole filter.** Twenty-five rows
   per page keeps a project with hundreds of runs readable; the tiles and
   `progress.items` sum every matching run so they never change when the user
   turns a page.
10. **Read-only, and export stays out.** Reports are for looking at; CSV export
    is slice 7's scope and a printable/PDF report is not in the MVP. Adding an
    export button here would either duplicate that slice or ship an unowned
    format.
11. **The tab becomes real; nothing else in the strip changes.** The disabled
    span was an honest placeholder for exactly this slice. The overview's other
    tabs, its active-route logic and the project header stay untouched.
12. **No snapshot table in this slice.** Like the overview trend, the report is
    computed on read; hard-deleting a run or item still changes history
    retroactively. A snapshot table is a deliberate later decision, not a
    hidden requirement of this screen.

## Phasing (for the task breakdown, after approval)

- **Phase 1 — contracts** (Daedalus): this PRD, `docs/api-reports.md`, the
  `DESIGN.md` §4.6/§4.8 amendments, the slice index in `docs/README.md`, and the
  superseded note in `PRD-project-overview.md`. **Stop for approval here.**
- **Phase 2 — backend** (Hephaestus): the `summary` route on the existing reports
  controller, the query DTO, the filtered trend builder (shared with
  `/reports/trend`), the progress rollup, and unit + e2e tests for the window
  boundaries, the two clocks, filters, pagination and the role matrix. No
  migration.
- **Phase 3 — frontend** (Iris): the Reports tab link, the `/reports` screen with
  URL-backed window/filters, the four tiles, the failures chart with table view,
  the paginated progress table, and the states above. Reuse `StatusBar`,
  `StatusBadge`, the date helpers and the chart/table primitives from the
  overview.
- **Phase 4 — QA** (Argus): the acceptance criteria above, UI end-to-end as
  Admin, Lead, Tester and Viewer, at 1440/1024/768, keyboard only, with empty,
  filtered-empty, archived and failure states. Report; never edit source.

Sizing: contracts **small**; backend **medium** (one aggregate endpoint, a
filtered trend query, one progress rollup, no migration); frontend **medium**
(a new project-scoped screen, one new chart variant, a paginated table and URL
state, reusing existing primitives).