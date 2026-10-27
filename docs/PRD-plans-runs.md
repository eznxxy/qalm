# PRD — Test Plans & Runs (MVP)

Status: **Approved — Arif, 2026-10-26** (all ten proposals accepted as written;
see Decisions below)
Owner: Daedalus
Slice: 3 (next after `PRD-suites-cases.md`; see `docs/README.md` "Later slices")
API contracts: `docs/api-runs.md`, `docs/api-plans.md`; shared rules in
`docs/api-conventions.md`
Design: `docs/DESIGN.md` §4.3 (runs list), §4.4 (run detail, the most-used
screen), §4.5 (plans), §5 (status bar / status badge), §6 (states), §8
(a11y), §9 (dates/copy)
Depends on: slice 2 (`docs/PRD-suites-cases.md`) — runs consume cases and rely
on their stable, never-reused `C####` ids.

## Problem
Slice 2 let a team author cases. A case is a *definition* of something to test;
it produces no evidence until someone actually executes it. Qalm cannot report
on quality, cannot show progress and cannot tell a failure from untested until
**executions are recorded against cases**. That record — a run of selected
cases, each with the results someone typed while testing — is what every
remaining MVP slice (milestones, dashboards/reports, CSV export) reads from.

## Goals
- A **test run** selects a set of the project's cases and becomes a working
  list a tester executes, screen by screen.
- A **plan** groups runs so a body of work (e.g. "Release 2.4") can be tracked
  and summarised in one place. Plans are optional — a run can stand alone.
- Each case in a run is a **run item** with an assignee and a current status;
  **results** (Passed / Failed / Blocked / Retest / Skipped) are recorded
  against the item, each with a comment, elapsed time, defect link and
  attachments.
- Progress is legible at a glance: a **status bar** and exact counts on the run
  header, the runs list and the plan header (§5).
- Recording a result is fast and keyboard-driven (§4.4): status shortcuts
  `P F B R S`, then "Save and next" (`Ctrl+Enter`) moves focus down the list.
- A failed result carries a reason — a comment is **required** for `failed`.
- The case drawer's "Linked runs" tab stops being a placeholder and lists the
  runs a case appears in, with its status in each.

## Non-goals (MVP)
- Milestones as a first-class object (due dates, progress, days left) — next
  slice. Runs and plans may carry a plain `due_date` now; the milestone link is
  added additively when that slice lands.
- Dashboards and reports (pass rate over time, failures by section) — later
  slice; this slice exposes the data they will read, not the charts.
- CSV import/export of runs or results — later slice.
- Integrations (Jira defect sync, CI triggers), custom result statuses, custom
  fields, per-project configuration.
- Per-project membership (out of scope since slice 1): a run item's assignee is
  any active user holding `admin`, `lead` or `tester`.
- External file storage / S3. Attachments are stored on the API server's disk
  (see decision 5); this keeps the slice self-contained and adds no paid
  service.
- Result versioning beyond an append-only history (no field-level audit like
  cases; see decision 4).

## Data model (product level)

### Test plan
| Field | Rules |
|---|---|
| `name` | Required, trimmed 1–120 chars, unique per project (case-insensitive). |
| `description` | Optional, ≤ 1,000 chars. |
| `due_date` | Optional calendar date (`YYYY-MM-DD`), same as a run's. |
| `created_by` / `updated_by` | User ids. |
| `run_count` | Read-only: runs currently in this plan. |
| `counts` | Read-only rollup over all items in the plan's runs: per-status counts, `total`, `percent_complete`. |

### Test run
| Field | Rules |
|---|---|
| `name` | Required, trimmed 1–120 chars. **Not** unique (two runs may share a name). |
| `description` | Optional, ≤ 1,000 chars. |
| `plan_id` | Optional; the plan this run belongs to (same project). `null` = stand-alone run. |
| `status` | `open` or `completed`. Derived from `completed_at`. |
| `due_date` | Optional `YYYY-MM-DD`. |
| `counts` | Read-only: `total`, `passed`, `failed`, `blocked`, `retest`, `skipped`, `untested`, `percent_complete`. |
| `assignee_ids` | Read-only convenience: distinct assignees among the run's items, for the list column. |
| `created_by` / `updated_by`, `completed_by`, `completed_at` | User ids / timestamp; `completed_*` set by "Close run". |

### Run item (a case inside a run)
| Field | Rules |
|---|---|
| `case_id` | Required; a live case in the same project. One item per case per run (no duplicates). |
| `case_title` | **Snapshot** of the case title at the moment the item is created (see decision 3). |
| `case_steps` | **Snapshot** of the case's ordered steps at item creation, so a later case edit does not rewrite what the tester was asked to run. |
| `case_priority` / `case_suite_id` | Snapshot of priority and suite, for the run's Suite filter and sorting. |
| `assignee_id` | Optional; an active `admin`/`lead`/`tester`. |
| `position` | Order within the run, 1-based, dense. Add-to-run appends. |
| `status` | Derived: the status of the **latest** result, or `untested` when the item has no results. Never stored separately from results. |
| `result_count` | Read-only. |
| `updated_at` | Bumped on each new result (the run list's "Updated" column). |

### Result
| Field | Rules |
|---|---|
| `run_item_id` | Required. |
| `status` | One of `passed`, `failed`, `blocked`, `retest`, `skipped`. |
| `comment` | Optional ≤ 4,000 chars — **required when `status = failed`**. Markdown-lite (see decision 4). |
| `elapsed_minutes` | Optional integer 0–10,080. |
| `defect_url` | Optional; an `http(s)` URL ≤ 500 chars. |
| `attachments` | 0–5 files (see below). |
| `created_by`, `created_at` | Who recorded it, when. |

Results are **append-only**: the current status of an item is always its newest
result, so re-testing a case is just recording another result (that is what the
`retest` status is for). Correcting a wrong status means recording a new result.

### Attachment
| Field | Rules |
|---|---|
| `result_id` | Required. |
| `filename` | Original name, trimmed 1–255 chars; its extension is the allow-list (below), matched case-insensitively. |
| `content_type` | **Derived from the extension, never from the browser's MIME guess**: `.png` → `image/png`, `.jpg` / `.jpeg` → `image/jpeg`, `.webp` → `image/webp`, `.pdf` → `application/pdf`. Those five extensions are the whole allow-list, on every OS. |
| `size_bytes` | ≤ 10 MB each. |
| `created_by`, `created_at` | Who uploaded it, when. |

Files live outside the database (decision 5). Download is always
**authenticated**; a bare file path is never served.

## Roles
This follows `PRD-auth.md`: *Lead — manage suites, cases, **plans, runs,
milestones** in all projects; execute runs. Tester — record results in runs
they are assigned to; read all projects/suites/cases.*

| Action | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| Read plans, runs, items, results | ✔ | ✔ | ✔ | ✔ |
| Create/edit/delete plans and runs; close/reopen | ✔ | ✔ | – | – |
| Add/remove items; assign items | ✔ | ✔ | – | – |
| Record a result on **their own** item | ✔ | ✔ | ✔ | – |
| Record a result on **any** item | ✔ | ✔ | – | – |
| Edit a result's comment/defect/time/attachments | ✔ | ✔ | ✔ (own) | – |

"their own item" = an item whose `assignee_id` is that Tester (decision 2).
Viewers get `403` on every write.

## Lifecycle & delete semantics
- **Close run** sets `completed_at`; the run becomes `completed` and the items
  list is read-only for results until it is reopened. **Reopen** (Admin/Lead)
  clears `completed_at`. Closing does not require every item to be tested —
  closing with untested items is allowed (the status bar shows them).
- **Record result** is allowed only on an `open` run.
- **Delete run** — soft delete (`deleted_at`): the run disappears from lists and
  from a case's Linked runs, but its results are kept (consistent with slice 2's
  "deleting a case keeps results"). The UI confirm names the consequence. Only
  Admin/Lead. A `completed` run can be deleted too (decision 6).
- **Delete plan** — removes the plan only; its runs are **detached**, never
  deleted (decision 7). The confirm says so ("Its 3 runs will be kept,
  without a plan.").
- **Remove item** — allowed only while the item has **no results**; once a
  result exists the item stays (clear the assignee instead). Prevents silent
  loss of recorded evidence.
- **Delete result** — not offered (append-only). A mistake is corrected by a new
  result (decision 4).
- **Project archived** — writes to plans/runs/results return `409 CONFLICT`
  ("project is archived"); reads keep working for Admins and are `404` for
  everyone else (`docs/api-projects.md`).
- **Case deleted** (slice 2 soft delete) — run items are untouched: the snapshot
  keeps the run readable, and the item's `case_id` still resolves for Admin
  audit. New runs cannot select a deleted case.

## Acceptance criteria
1. An Admin or Lead creates a run by selecting an explicit set of cases and/or a
   suite (with or without descendants); one run item is created per live case,
   `position` set, status `untested`, and no case appears twice in one run.
2. Creating a run with the same case already present skips it and reports the
   skipped count rather than duplicating (`200` on the add-cases path).
3. A run header shows a status bar (§5, segment order Passed, Retest, Blocked,
   Failed, Skipped, Untested) whose segments and counts match the recorded
   results exactly, plus `percent_complete` = recorded / total.
4. Recording `passed` needs no comment; recording `failed` without a comment is
   rejected with the reason shown **inline** on the field, not in a toast.
5. A Tester may record a result only on an item assigned to them; attempting it
   on someone else's item returns `403`. Recording on an unassigned item is
   Admin/Lead only.
6. Recording several results on one item leaves the item's status equal to the
   newest result, keeps every earlier result in the item's history, and the
   status bar/counters reflect only the newest per item.
7. "Save and next" (`Ctrl+Enter`) saves the result and moves focus to the next
   `untested` item; `P F B R S` set the status in the form (DESIGN §7).
8. Closing a run sets it to `completed`; further result writes return `409`
   until it is reopened.
9. Adding cases to an existing run appends items; removing an item that already
   has a result returns `409` naming the reason.
10. Attachments: uploading a result's file stores it, it survives a reload, and
    fetching its URL without a valid token returns `401`; an extension outside
    the five (PNG, JPG, JPEG, WebP, PDF) or a file over 10 MB is rejected with a
    field-level error — on every OS, whatever MIME type the browser reports.
11. A plan lists its runs with an aggregate status bar in the header that equals
    the sum of its runs' counts; deleting the plan detaches its runs, which
    remain visible and openable.
12. The case drawer's Linked runs tab lists every run containing the case, with
    the case's status in each; a run that never included it is absent.
13. Every screen renders the §6 states (skeleton, empty, error + retry, no
    permission) and is usable keyboard-only; a Viewer sees read-only screens
    with writes disabled and an explanation on hover.
14. Runs list filters by `Open`/`Completed` and shows name, plan, status bar,
    `% complete`, assignee(s) and due date (§4.3).

## Decisions (Arif, 2026-10-26)
All ten proposals were accepted as written; the contracts already implement
them.
1. **Scope — one slice.** Plans and runs ship together (plans are a thin
   container over runs); milestones stay the next slice.
2. **Assignment & Tester rights.** Assignment is per run item, to any active
   `admin`/`lead`/`tester`; a Tester records results only on items assigned to
   them (matches "runs they are assigned to" in PRD-auth).
3. **Case snapshot.** A run item snapshots the case's title and steps at
   creation, so editing a case later does not rewrite an old run.
4. **Result editing.** Results are append-only; to fix a status you record a new
   result. The **comment, defect link, elapsed time and attachments** of the
   most recent result may be edited by its author or a writer; the `status` is
   immutable. Comment is stored as plain text with line breaks and links
   auto-detected ("markdown-lite"), not a full markdown renderer.
5. **Attachment storage.** Files go on the **API server's local disk** under a
   configured storage directory, with metadata rows in Postgres; served only
   through an authenticated endpoint. Limits: 5 files/result, ≤ 10 MB each,
   allow-list of extensions (PNG, JPG, JPEG, WebP, PDF). The check is
   extension-based, not MIME-based, so the same file is accepted on every OS;
   the cost is that the name is trusted rather than the bytes. No external or
   paid service and no secrets.
6. **Deleting a run** is a soft delete that keeps results (a completed run may
   also be deleted).
7. **Deleting a plan** detaches its runs rather than blocking or cascading.
8. **Milestone deferred.** Runs and plans get a plain `due_date` now; the
   `milestone_id` link and the milestone column land with the milestones slice
   as an additive change.
9. **Case → Linked runs** endpoint ships in this slice (`GET /cases/:id/runs`)
   to fill the drawer tab.
10. **Result fields** `elapsed_minutes` and `defect_url` are in MVP (DESIGN
    §4.4 lists them) — both optional.

## Phasing (for the task breakdown, after approval)
- **Phase 1 — contracts** (Daedalus): this PRD + `docs/api-runs.md` +
  `docs/api-plans.md`.
- **Phase 2 — backend** (Hephaestus): migration (`plans`, `runs`, `run_items`,
  `results`, `result_attachments`) + endpoints per contract + tests.
- **Phase 3 — frontend** (Iris): runs list (§4.3), run detail + result drawer
  (§4.4), plans screen (§4.5), Linked runs tab, replacing the `/wip/runs`,
  `/wip/plans` placeholders.
- **Phase 4 — QA** (Argus): end-to-end verification of the acceptance criteria
  above as each role.

Sizing: backend **large**, frontend **large**, contracts **medium**. Phases 2
and 3 overlap against the frozen contract, as in slice 2.