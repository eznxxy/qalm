# PRD — Milestones (MVP)

Status: **Approved** (Arif, 2026-10-27). The nine decisions at the end are
accepted; implementation is tracked in `docs/backlog-slice4-milestones.md`.
Owner: Daedalus
Slice: 4 (next after `PRD-plans-runs.md`; see `docs/README.md` "Slice 4")
API contract: `docs/api-milestones.md`; the additive run link is in
`docs/api-runs.md` (§ "Milestone link"), and `docs/api-plans.md` notes that an
embedded run does not take one
Design: `docs/DESIGN.md` §4.3 (runs list), §4.5 (plans, milestones), §5 (status
bar / status badge), §6 (states), §8 (a11y), §9 (dates/copy)
Depends on: slice 3 (`docs/PRD-plans-runs.md`) — a milestone summarises the runs
that already exist, and slice 3 decision 8 promised the `milestone_id` link as an
additive change. This is that change.

## Problem
Slice 3 gave a team runs and plans, and both carry a plain `due_date`. A release
is not one deadline, though: "2.4 ships on 14 Nov" is a checkpoint that several
runs — some standalone, some inside plans — are working towards, and right now
that grouping exists only in people's heads. Without it, "how ready is 2.4?" is
answered by opening runs one at a time, and a due date on a run has no owner at
the release level.

A **milestone** is that checkpoint: a named, dated target in the project, with
the rollup of everything working towards it and the countdown to its date.

## Goals
- An Admin or Lead creates a milestone per project: name, optional description,
  optional due date.
- Runs are **attached to a milestone** — one milestone per run, chosen when the
  run is created or added later from the milestone screen. Plans are not
  milestones; a plan's runs may work towards different milestones, and a
  milestone may span several plans.
- A milestone shows the **rollup of its runs**: the same status bar, exact
  counts and `% complete` a plan already shows, so the two groupings read alike.
- The milestone list answers "what is coming up": every milestone with its
  progress, its due date and **days left** (or how late it is), sorted by date.
- A milestone whose runs are all closed reads **Completed** without anyone
  having to mark it.
- The milestones screen replaces the `/wip/milestones` placeholder and appears
  in the sidebar and in the `?` shortcut list (`g m`).

## Non-goals (MVP)
- Milestones as containers of **plans** — a plan is not a milestone member, and
  a milestone does not own plans. Membership is over runs only (decision 1).
- An explicit close/reopen action, a stored milestone state, or a state
  machine — completion is derived (decision 2).
- Notifications, emails, reminders or calendar integration for due dates.
- Burndown, velocity, per-milestone charts or any reporting beyond the rollup —
  reports are the next slice.
- Recurring milestones, milestone templates, copying a milestone with its runs.
- Per-milestone permissions or membership; the global roles from `PRD-auth.md`
  apply, as everywhere else.
- Milestone-level custom fields, labels or priorities.
- Cross-field date rules between a run and its milestone (decision 8).

## Data model (product level)

### Milestone
| Field | Rules |
|---|---|
| `name` | Required, trimmed 1–120 chars, unique per project (case-insensitive) among live milestones. A deleted milestone frees its name. |
| `description` | Optional, ≤ 1,000 chars. |
| `due_date` | Optional calendar date (`YYYY-MM-DD`), the same shape as a run's and a plan's. `null` means "no date yet", not "today". |
| `run_count` | Read-only: live runs currently attached. |
| `status` | Read-only, **derived**: `completed` when `run_count > 0` and every attached live run is `completed`; otherwise `open`. Never stored. |
| `counts` | Read-only rollup over all items in all attached runs: per-status counts, `total`, `percent_complete`. |
| `created_by` / `updated_by` | User ids. |

The rollup is the plan rollup (slice 3, `api-plans.md`): each item counted once
by its latest result, a completed run still counts, a soft-deleted run does not,
and `percent_complete = round((total - untested) / total * 100)`, `0` when
`total = 0`.

### Run — the additive link
| Field | Rules |
|---|---|
| `milestone_id` | Optional; the milestone this run works towards (same project). `null` = no milestone. One milestone per run. |
| `milestone_name` | Read-only; the milestone's current name, resolved by a join (like a result's `created_by_name`). `null` when `milestone_id` is `null`. |

A plan is unchanged: it groups runs, and its `counts` still cover all of its
runs regardless of their milestones. A milestone never changes a run's
`due_date`, name, plan or items.

## Roles
This follows `PRD-auth.md`: *Lead — manage suites, cases, plans, runs,
**milestones** in all projects; execute runs. Tester — record results in runs
they are assigned to; read all projects/suites/cases.*

| Action | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| Read milestones, their runs and rollups | ✔ | ✔ | ✔ | ✔ |
| Create / edit / delete a milestone | ✔ | ✔ | – | – |
| Attach / detach runs | ✔ | ✔ | – | – |
| Choose a milestone when creating a run | ✔ | ✔ | – | – |

Milestone membership is a planning action, so it follows run creation rather
than result recording: a Tester cannot move a run into or out of a milestone.

## Lifecycle & delete semantics
- **Completed is derived, not declared.** A milestone becomes `completed` when
  its last open run is closed, and returns to `open` when a run is reopened or a
  new (open) run is attached. There is no Close milestone action (decision 2).
- **Attach** — only live runs of the same project that have **no** milestone.
  A run already in another milestone is refused, naming the row; moving it
  means detaching it first (or editing the run). Nothing moves silently between
  milestones.
- **Detach** — removes only the link. The run, its items, its results and its
  attachments are untouched, and it stays on the runs list.
- **Delete milestone** — soft delete; its runs are **detached**, never deleted
  (the same rule as deleting a plan, slice 3 decision 7). The confirm names the
  consequence: "Its 3 runs will be kept, without a milestone."
- **Deleting a run** — the run leaves its milestone's rollup; nothing else
  changes. Deleting every run of a milestone leaves it `open` with `run_count:
  0`, and it stays visible (the same rule as a plan whose runs were detached).
- **Project archived** — writes to milestones return `409 CONFLICT` ("project
  is archived"); reads keep working for Admins and are `404` for everyone else
  (`docs/api-projects.md`).
- **No cascade at the database level**: detaching on delete is an explicit
  `update runs set milestone_id = null` in the same transaction, so a run can
  never be removed by a milestone delete.

## Acceptance criteria
1. An Admin or Lead creates a milestone with a name, optional description and
   optional due date; a duplicate name in the project (ignoring case) is
   refused with the message on the Name field and nothing is saved. A deleted
   milestone frees its name.
2. The Milestones screen lists name, runs, status, `% complete` (with the status
   bar), due date and days left; it sorts by name, due date or created date
   (default due date ascending, undated milestones last), searches by name and
   filters Open / Completed.
3. A project with no milestones shows the §6 empty state with one primary
   action ("New milestone"), and a milestone with no runs reads "No runs" with
   `0% complete` rather than an empty bar.
4. A milestone's screen shows its rollup — status bar, exact per-status counts
   and `% complete` — its due date, its days left and its attached runs in the
   same table as the runs list (Plan column included, Milestone column dropped
   because every row would repeat the page title). A row opens the run.
5. **Add runs** offers only live runs of the project that have no milestone;
   ticking them and saving attaches them. The API refuses an unknown, deleted,
   other-project or already-attached run by naming the row (`run_ids[i]`), and a
   run can be in at most one milestone.
6. Removing a run from a milestone keeps the run, its items, results and
   attachments; the confirm says the run is kept. The run disappears from that
   milestone's rollup immediately.
7. Deleting a milestone detaches its runs instead of deleting them, and the
   confirm says so. The runs stay on the runs list, with no milestone.
8. A milestone's counts equal the sum over every item in its runs — a completed
   run still counts, a deleted run does not — and match the status bar on every
   screen that shows the milestone.
9. A milestone reads **Completed** when it has at least one live run and every
   live run is completed; attaching an open run or reopening one returns it to
   **Open**. No one sets that state by hand.
10. A run carries at most one milestone: the New run dialog offers the project's
    milestones (optional), the runs list shows the milestone as a link, and the
    run detail names it with a link back to the milestone.
11. Days left is computed from the due date in the user's locale: "12 days
    left", "Due today", "3 days late"; a milestone without a due date shows no
    countdown, and a `YYYY-MM-DD` never shifts a day across timezones.
12. Any signed-in role reads milestones and their runs; only Admin/Lead create,
    edit, delete, attach and detach. Tester and Viewer see no write controls and
    an explanation on hover; an archived project is read-only for them.
13. Every screen renders the §6 states (skeleton, empty, error + retry, no
    permission) and works keyboard-only. The sidebar's Milestones item and `g m`
    reach `/milestones`, and the `?` dialog lists it.

## Decisions (proposed — for approval)
1. **Milestones group runs, not plans.** A run has at most one milestone and a
   milestone holds runs; plans stay a separate, orthogonal grouping. A release
   can therefore cover runs from several plans, and a plan may span milestones.
   Rejected: `milestone_id` on plans as well, which would make a run's effective
   milestone depend on its plan and give one relationship two sources of truth.
2. **Completion is derived; there is no Close milestone.** Closing the runs is
   what "done" already means in Qalm, and a stored state would need its own
   guards (attach to a closed milestone, reopen, drift between state and runs).
   The cost is that a milestone cannot be retired independently of its runs; the
   `due_date` and the rollup still say where it stands.
3. **The due date is optional and there is no start date.** A milestone is a
   target, not a work window; days-left is a UI computation from `due_date` in
   `web/src/lib/dates.ts`, never an API field, so a timezone cannot make the
   server and the browser disagree.
4. **Membership is editable after creation.** Attach and detach are their own
   endpoints from the start, because slice 3's create-time-only attach on plans
   was a documented limitation that had to be revisited (card 3.10). A milestone
   is also allowed to be born empty: "Release 2.4, due 14 Nov" is a valid target
   before any run exists, unlike a plan, which exists to hold runs.
5. **A run joins one milestone, and the bulk attach refuses a run already in
   another.** Moving a run is an explicit act on the run, not a side effect of
   adding it to a milestone. Same rule as a plan's `run_ids` (slice 3, decision
   12); errors name the row.
6. **Milestone names are unique per project among live rows**, case-insensitive
   — the rule plans and runs already follow, with the same `409` and
   field-level message.
7. **The runs table gets a Milestone column.** DESIGN §4.3 listed one before
   milestones existed; it returns between Plan and Status, showing the name as a
   link or `—`. The run resource carries `milestone_name` (a join, like
   `created_by_name`) so the column needs no client-side id resolution.
8. **No date validation between a run and its milestone.** A run may be due
   after its milestone (work that slipped) and a milestone may be due before a
   run starts; a hard rule would block planning that is honest about a delay.
   The screens show both dates; nothing warns.
9. **Milestone status is filterable** (`?status=open|completed`) even though it
   is derived, because "what is still coming up" is the list's first question.
   The filter is computed from the same aggregate as the field.

## Phasing (for the task breakdown, after approval)
- **Phase 1 — contracts** (Daedalus): this PRD + `docs/api-milestones.md`, the
  additive run link in `docs/api-runs.md`, a note in `docs/api-plans.md`, the
  §4.3/§4.5/§7 updates in `docs/DESIGN.md` and the slice index in
  `docs/README.md`. **Stop for approval here.**
- **Phase 2 — backend** (Hephaestus): one migration (`milestones`, the
  `runs.milestone_id` column and its index), the `milestones` module and its
  endpoints, the run-link read/write changes and the `milestone_id` list filter;
  unit + e2e tests.
- **Phase 3 — frontend** (Iris): `/milestones` list + detail, New/Edit dialog,
  Add runs picker, Delete confirm, the Milestone select in the New run dialog,
  the Milestone column in the shared runs table, the link on run detail, and
  removing the `/wip/milestones` placeholder.
- **Phase 4 — QA** (Argus): the acceptance criteria above, as Admin, Lead,
  Tester and Viewer.

Sizing: contracts **small/medium**, backend **medium**, frontend **medium**. The
screens reuse the runs table factory, `StatusBar`, `DataTable`, `Dialog`,
`Combobox` and the date helpers, so this slice is smaller than slice 3.