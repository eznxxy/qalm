# PRD — Project overview (MVP)

Status: **Proposed** — awaiting approval (owner: Arif). No code is written before
this document and `docs/api-project-overview.md` are approved (`/AGENTS.md`,
contracts first).
Owner: Daedalus
Slice: 5 (next after `PRD-milestones.md`; see `docs/README.md`)
API contract: `docs/api-project-overview.md` — one new endpoint,
`GET /api/v1/projects/:projectId/reports/trend`
Design: `docs/DESIGN.md` §4.1 (projects list), §4.6 (report widgets, "View as
table", chart rules), §4.8 (this screen), §5 (tabs, status bar/badge), §6
(states), §8 (a11y), §9 (dates/copy)
Depends on: slice 1 (`api-projects.md` — the project resource), slice 3
(`api-runs.md` — runs and results), slice 4 (`api-milestones.md` — the milestone
rollup). Adds no field to any existing resource.

## Problem
`/projects/:id` has been a placeholder since slice 1: a description panel, a
"Test cases" button and the sentence "Test runs and reports for this project
arrive in later slices." Everything a Lead needs to judge a project — is testing
happening, how is it going, what is coming up, what ran recently — now exists in
the API but not in one place. A project's state can only be read by opening the
runs list, the milestones list and (later) reports one at a time, each of which
is project-filtered by a query string the user has to know.

The project page becomes the project's **overview**: a tab strip that reaches
the project's screens, a results trend, and the two lists that answer "what is
coming up" and "what happened lately".

## Goals
- The project page carries a **tab strip** with the project's screens as real
  routes: Overview, Milestones, Test runs, Test cases. Reports appears disabled
  with a reason; there is no Todo tab.
- **Overview** shows, in order: the project's description and metadata, a
  **results trend over a selectable window (1, 7, 14 or 30 days, default 14)**,
  the **Milestones card**, and the **Test Runs card**.
- The trend is honest: it counts the results that were actually recorded on each
  UTC day, and its pass rate uses the same status semantics the rest of Qalm
  shows. It is backed by a real reports endpoint, not a client-side
  approximation over paginated lists.
- The Milestones card shows the nearest milestones with their progress and
  countdown, so "what is coming up" needs no navigation.
- The Test Runs card shows the most recent runs with status and progress, so
  "what happened lately" needs no navigation.
- Every card is a summary of a real screen: a header link ("View all") goes to
  that screen **filtered to this project**, never to an unfiltered global list.
- Edit / Archive / Restore keep working; moving the description into the
  Overview tab changes no permission and no endpoint.

## Non-goals (MVP)
- **A Reports screen.** The tab is visible and disabled; the reports slice owns
  the screen, the date-range picker and every widget beyond this one chart.
- **A free-form or custom date range.** The chart offers four presets (1, 7, 14,
  30 days); the client never sends `from`/`to` and there is no calendar picker.
  The endpoint accepts `days` 1–90 so the reports slice can ask for other
  windows without a contract change, but this screen only asks for the presets.
- **Restyling the header or the archived banner.** The scope is the tab strip,
  the chart panel, the Milestones card and the Test Runs card; the title/key
  header, the status badge, the Edit/Archive buttons and the archived banner
  stay as they are today.
- A Todo resource, activity feed, per-section failure breakdown, burndown,
  velocity, per-milestone charts, or a project dashboard with drag-and-drop
  widgets.
- Caching, background refresh, live updates or scheduled snapshotting of the
  trend data.
- Author display on run rows: `Run` has no `created_by_name` and `GET /users` is
  Admin-only (QA 4.2 findings 2/3). The card shows plan, milestone, status,
  progress and due date instead; it never invents "By <name>".
- CSV export of the chart, annotations, or comparing two windows.
- Per-project permissions on the tab strip: the existing global roles decide
  what is writable, exactly as on every other screen.

## What the screen shows

### Tab strip
Under the project header, above the Overview content, per `docs/DESIGN.md` §5
(underline tabs, 2px `--brand` underline, `aria-current="page"`).

| Tab | Target | State |
|---|---|---|
| Overview | `/projects/:id` | live |
| Milestones | `/milestones?project=:id` | live |
| Test runs | `/runs?project=:id` | live |
| Test cases | `/cases?project=:id` | live |
| Reports | — | **disabled**, with "Reports arrive in a later slice" on hover/focus and `aria-disabled="true"`; no `href` |

No Todo tab: Qalm has no todo resource, and a permanent dead tab would teach
users to ignore the strip. The active tab is decided by the route, not by local
state, so reloading `/projects/:id` always lands on Overview.

### Overview content
1. **Description** — the existing panel's content (`description`, or "No
   description.", plus created/last-updated) moves here. It is no longer a
   separate card above the tabs. The stale sentence about later slices is
   removed.
2. **Results trend card** — title states the insight and its source, generated
   from the window: "Results recorded, last 14 days" (and "… today" for the
   1-day preset). A **range selector** in the card header offers four presets —
   **1, 7, 14, 30 days**, labelled "1d / 7d / 14d / 30d" with full labels for
   assistive tech — and 14 is the default. Legend of the five recorded statuses
   (Passed, Failed, Blocked, Retest, Skipped) using the §2.2 status colours and
   labels, the same primitives as `StatusBar`. A **"View as table"** toggle
   (§4.6) swaps the chart for a semantic table: Date, Passed, Failed, Blocked,
   Retest, Skipped, Total, Pass rate.
   - The selected range is part of the URL (`/projects/:id?days=30`) so a
     refresh, a shared link or the back button keeps it; an unrecognised or
     unsupported value falls back to 14 without an error.
   - With the 1-day preset the plot draws that day's stacked column and a single
     pass-rate **point** (no line), and the table has exactly one row.
   - Switching ranges refetches the trend card only: the previous plot stays
     visible, marked `aria-busy`, with a polite "Updating…" status, so the card
     does not flash back to a skeleton on every click.
3. **Milestones card** — up to 5 milestones sorted like the milestones screen
   (due date ascending, undated last), each with name, due date, days left
   ("12 days left", "Due today", "3 days late", "No due date"), the status bar
   and `% complete`. Header: a **"New milestone"** button for Admin/Lead on an
   active project, then the "View all milestones" link.
4. **Test Runs card** — up to 5 live runs, newest first, each with name, plan
   name (or `—`), milestone name (or `—`), status badge, progress
   (`31 of 50`, status bar, `74% complete`) and due date. Rows open the run.
   Header: a **"New run"** button for Admin/Lead on an active project, then the
   "View all runs" link.

Both header buttons open the create dialog the matching list screen already
uses (`MilestoneFormDialog` / `RunFormDialog`) without leaving the overview:
the URL does not change, Cancel closes the dialog, and a successful save closes
it and refreshes **both** cards (a new run changes a milestone's counts). A
rejected save keeps the dialog open and shows the API's field errors inline.
Switching project closes an open dialog — it belongs to the project that was on
screen.

Layout: 12-column grid, 16px gutters (§4.6). Chart 8 columns, Milestones 4;
Test Runs full width. One column below 1024px, in the order above.

### Empty, loading and error states (§6)
| Situation | What renders |
|---|---|
| Project has no results in the window | Chart keeps its axes and legend; the plot area says "No results recorded in the last 14 days." (the copy follows the selected range, and reads "No results recorded today." for 1 day) with a link to Test runs. Table view shows one zero row per selected day with `—` pass rate. |
| Project has no milestones | "No milestones yet. Create one to track a release." — writers open the dialog from the card header's "New milestone" button; Tester/Viewer see a plain read-only sentence instead. |
| Project has no runs | "No runs yet. Create a run to start recording results." — writers open the dialog from the card header's "New run" button; Tester/Viewer see a plain read-only sentence instead. |
| Loading | Row-shaped skeletons in each panel (chart: axis skeleton, not a spinner); the project header renders as soon as the project loads, the cards load independently. |
| One card fails | That card alone shows "Couldn't load the trend. Check your connection and retry." with Retry; the other cards and the tab strip stay usable. |
| Project 404 / 403 | The existing project-level states ("Project not found" / "Forbidden") are unchanged. |
| Archived project | The existing archived banner and write-blocking stay; cards read normally for an Admin, and a non-Admin never reaches the page (404, `api-projects.md`). |
| Switching range fails | The card shows "Couldn't load the trend. Check your connection and retry." with Retry; the selector keeps the chosen range, and Retry refetches that range. |
| `days` outside 1–90 | Server `400`; the web only ever sends 1, 7, 14 or 30, and a URL value outside that set falls back to 14 before any request. |

## Roles
Read-only addition; no endpoint in this slice writes.

| Action | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| Open the project overview and its cards | ✔ | ✔ | ✔ | ✔ |
| See the Description / Milestones / Test runs / Test cases tabs | ✔ | ✔ | ✔ | ✔ |
| See "New milestone" / "New run" buttons in the card headers | ✔ | ✔ | – | – |
| Edit / Archive / Restore (unchanged, header buttons) | ✔ | Archive only | – | – |
| See the Reports tab enabled | – | – | – | – |

Writers see the create shortcuts; Tester and Viewer see the sentence without a
button, and the reason is available on hover ("Only Admins and Leads can create
milestones"), matching §4.7's rule.

## Acceptance criteria
1. `/projects/:id` shows the tab strip under the header with Overview active
   (`aria-current="page"`, 2px brand underline). Milestones, Test runs and Test
   cases navigate to their screens filtered to this project; Reports is present,
   disabled, focusable for its explanation, and has no `href`. There is no Todo
   tab.
2. The Overview tab contains the description and metadata, then the results
   trend card, then the Milestones card, then the Test Runs card — in that
   order. The description no longer renders outside the Overview tab.
3. Edit / Archive / Restore are still in the header, still enforce the same
   roles, and still open the same dialog/forms after the move. A Viewer sees no
   write control.
4. The trend card offers 1, 7, 14 and 30 days with 14 selected on first load,
   shows one bucket per day of the selected window (UTC, ending today, oldest
   first), and its totals equal the sum of the days. The title and the empty
   copy follow the selection ("Results recorded, last 7 days", "… today").
5. Selecting a range refetches only the trend card, updates the title, legend
   footer, plot, table rows and the URL (`?days=30`), and leaves the
   Description, Milestones and Test Runs cards untouched. Reloading or sharing
   that URL opens with the same range selected; `?days=99`, `?days=abc` or a
   missing value falls back to 14 without an error.
6. While a range change is in flight the previous plot stays visible and is
   marked busy with a polite "Updating…" status; it never flashes back to the
   card skeleton. A failed change keeps the chosen range selected and shows the
   card error with Retry for that range.
7. The 1-day preset draws a single stacked column and a single pass-rate point
   (no line), and the table view has exactly one row.
8. Each day's pass rate equals `passed / (passed + failed + blocked + retest)`,
   as a percentage to one decimal. `skipped` appears in the stacks, the legend
   and the table but not in the denominator. A day with no verdicts shows `—`,
   never `0%`.
9. A day with no results shows no bar and no point on the pass-rate line — the
   line breaks rather than dropping to zero — and its table row reads `0`
   counts with `—` pass rate.
10. "View as table" replaces the chart with a table of the same rows (one per
    selected day) and returns to the chart; the toggle is a real button with
    `aria-expanded`, and the values match the chart for every day.
11. The chart is one accessible image (`role="img"`) with an `aria-label` that
    names the window, the statuses, the total recorded results and the window
    pass rate; status colours are the only colours in the plot (§2.2), and the
    legend names each status in text, so nothing relies on colour alone. The
    range selector is a labelled group of toggle buttons whose selected option
    is exposed with `aria-pressed`, not by colour alone.
12. The Milestones card lists at most 5 milestones, due date ascending with
   undated last, each showing name, due date, days left or "No due date",
   status bar and `% complete`; "View all milestones" opens
   `/milestones?project=:id`. With no milestones the §6 empty state renders.
   Admin/Lead on an active project also get a "New milestone" button in the
   header.
13. The Test Runs card lists at most 5 live runs, newest first, each showing
    name, plan (or `—`), milestone (or `—`), status badge, `x of y`, status bar,
    `% complete` and due date; a row opens the run; "View all runs" opens
    `/runs?project=:id`. With no runs the §6 empty state renders. Admin/Lead on
    an active project also get a "New run" button in the header.
14. A slow or failing card never blocks another: the tab strip and the project
    header render as soon as the project loads, each card has its own skeleton
    and its own error with Retry, and retrying one card does not refetch the
    others.
15. An archived project keeps today's behaviour: banner visible, writes
    blocked, cards readable for an Admin; a non-Admin opening it still gets
    "Project not found".
16. The whole screen is keyboard operable in DOM order (tabs → description →
    range selector → chart/table toggle → chart points or table → milestone
    links → run rows), focus is always visible, contrast meets 4.5:1, and no
    information is conveyed by colour alone.
17. At 1440, 1024 and 768 the grid collapses to one column without horizontal
    scrolling; the chart keeps a readable height and its legend wraps instead
    of clipping; the four range buttons stay on one line or wrap as a group.
18. All date rendering goes through `web/src/lib/dates.ts`; the card never
    formats a date itself, and `days left` is computed there as it is on the
    milestones screen.
19. The "New milestone" and "New run" header buttons open the list screens'
    create dialogs in place (create mode, no navigation). Cancel closes the
    dialog and leaves the cards unchanged; a successful save closes it, keeps
    the overview on screen and refetches both cards; a rejected save keeps the
    dialog open with the API's field errors, as on the list screens. Tester,
    Viewer and archived projects have no button.

## Decisions (proposed — for approval)
1. **Tabs are routes, not panels.** Each live tab is a link to the screen that
   already owns that data (`/milestones?project=`, `/runs?project=`,
   `/cases?project=`), so the strip introduces no duplicated screens and the
   back button behaves. Rejected: client-side tab panels that would re-implement
   the milestones and runs lists inside the project page.
2. **Reports ships disabled, Todo does not ship.** A visible, explained
   "later slice" tab is honest about the roadmap; a Todo tab would advertise a
   resource the product does not have. Reports is a `<span>` with
   `aria-disabled`, not a dead link.
3. **The description moves into Overview; the header stays.** The reference puts
   the tabs directly under the project header, which leaves no room for a
   description card above them. Keeping title/key/status and Edit/Archive in the
   header preserves the approval flow of slice 1 untouched.
4. **The chart counts results recorded per day, not the current state of the
   project.** The run/plan/milestone rollups already answer "where does it stand
   now"; a trend answers "what happened, and how did it go". Counting every
   result row means a retest adds a point, which is the point of a trend. The
   card title says "Results recorded" so the two numbers are never confused.
5. **Pass rate excludes `skipped` and counts `blocked` against you.**
   `passed / (passed + failed + blocked + retest)`: a skipped result is "not
   executed", not a failure; a blocked result was attempted and could not be
   verified, so it is not a pass. `untested` cannot appear at all (no result
   row), which is why the denominator is never inflated by work nobody started.
   A day with a zero denominator is `null` (rendered `—`), never `0` — `0%` would
   claim every result failed.
6. **The window is a preset of 1, 7, 14 or 30 UTC days, ending today,
   inclusive; 14 is the default.** Four presets cover "today", "this week",
   "two weeks" and "this month" without a calendar picker, and 14 matches the
   original design. UTC keeps the server and the browser agreeing on a bucket,
   and `from`/`to` are echoed so the client labels the axis without recomputing
   a date. Presets live in the URL (`?days=30`) so a shared link or a reload
   keeps the view; an unknown value falls back to 14 rather than erroring. The
   endpoint itself accepts `days` 1–90, so the reports slice can ask for other
   windows without a contract change.
7. **Two series in one panel: stacked daily results and a pass-rate line.** The
   reference legend is a status legend and the reference plot is a daily trend,
   so the panel draws the recorded results as stacked columns (left axis, counts)
   and the daily pass rate as a line (right axis, 0–100%). Both come from the
   same endpoint, both are in the table view, and the colours are the status
   colours the rest of the app already uses.
8. **No author column on the Test Runs card.** `Run` carries `created_by` (a
   uuid) and no name, and `GET /users` is Admin-only (QA 4.2 findings 2/3), so a
   "By" column would be blank for three of four roles. The card shows plan,
   milestone and progress instead, all of which every role may read.
9. **Each card links to its project-filtered screen.** "View all" without
   `?project=` would drop the user into a global list, which is exactly the
   navigation the card exists to save.
10. **The trend is computed on read, with no stored snapshots.** `results` rows
    are append-only and their status is immutable (`PATCH /results/:id` touches
    only comment, elapsed and defect URL), so `created_at` is a sound trend key.
    The cost, accepted for the MVP: deleting a run or item removes its results
    (hard delete cascades), so history can change retroactively. A snapshot
    table is the reports slice's decision if it needs immutability.

## Phasing (for the task breakdown, after approval)
- **Phase 1 — contracts** (Daedalus): this PRD, `docs/api-project-overview.md`,
  the §4.8 section in `docs/DESIGN.md` and the slice index in
  `docs/README.md`. **Stop for approval here.**
- **Phase 2 — backend** (Hephaestus): a `reports` module with the single
  `GET /projects/:projectId/reports/trend` route, the `results(created_at)`
  index migration, the pass-rate helper, unit tests for the bucketing and
  rounding rules, e2e coverage of the window boundaries and role matrix.
- **Phase 3 — frontend** (Iris): the tab strip on the project page, the Overview
  layout (description moved in), the trend card with its 1/7/14/30 range
  selector, chart/table toggle and legend, the Milestones and Test Runs cards,
  per-card loading/error states.
- **Phase 4 — QA** (Argus): the acceptance criteria above, UI end-to-end, as
  Admin, Lead, Tester and Viewer, at 1440/1024/768, keyboard only.

Sizing: contracts **small**, backend **small/medium** (one endpoint, one index),
frontend **medium** (a new chart is the only genuinely new component; the cards
reuse `StatusBar`, `StatusBadge`, `DataTable` styling and the date helpers).