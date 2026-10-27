# Qalm — Slice 3 Backlog: Test Plans & Runs

Status: **APPROVED for planning** (Arif signed off all ten proposals,
2026-10-26). Phase 1 contracts are **approved**: `docs/PRD-plans-runs.md`,
`docs/api-runs.md`, `docs/api-plans.md`. Phase 2 backend: card 2.1 (runs &
items) and card 2.2 (results & attachments) are **DONE 2026-10-26**; card 2.3
(plans, rollups & linked runs) is next, and Phase 3 frontend can start against
the frozen contract (phases overlap, as in slice 2).
Owner routing: Daedalus (contracts), Hephaestus (server), Iris (web), Argus
(QA). Spec source: `docs/PRD-plans-runs.md` + `docs/api-runs.md` +
`docs/api-plans.md` + `docs/DESIGN.md` §4.3/§4.4/§4.5 (and §5, §6, §8, §9).

---

## Slice goal

A case is a definition; a run is evidence. After this slice a team can select
cases into a run, assign them, execute them and record what happened
(Passed / Failed / Blocked / Retest / Skipped) with a comment, time, defect link
and attachments — and read progress from a status bar anywhere a run or plan
appears. This is the data every remaining MVP slice (milestones, dashboards,
CSV export) reads from.

Out of scope: milestones, reports/dashboards, CSV, integrations, custom result
statuses, external file storage.

---

## Phase 1 — contracts (Daedalus) — DONE 2026-10-26

### Card 1.1 — PRD + API contracts (docs) — DONE
- `docs/PRD-plans-runs.md` (14 acceptance criteria, 10 decisions),
  `docs/api-runs.md` (runs, items, results, attachments, close/reopen, bulk
  assign, `GET /cases/:id/runs`), `docs/api-plans.md`.
- `docs/README.md` slice index updated.

---

## Phase 2 — backend (Hephaestus)

### Card 2.1 — Slice-3 schema + runs & items API (large) — DONE 2026-10-26
- **Migration** `20261026000001_runs_schema.js`, all five tables in one step
  (as slice 2 landed `cases` with 2.1, because counts need the child tables):
  `plans`, `runs`, `run_items`, `results`, `result_attachments` — columns,
  checks, indexes and FKs exactly as in `api-runs.md` / `api-plans.md`
  "Implementation notes". Partial unique indexes where `deleted_at is null`;
  `run_items` partial unique `(run_id, case_id)`; `results` check
  "failed ⇒ comment non-empty"; `run_items.case_steps jsonb`.
- **Endpoints**: `GET/POST /projects/:projectId/runs`, `GET/PATCH/DELETE
  /runs/:id`, `POST /runs/:id/close`, `POST /runs/:id/reopen`,
  `GET /runs/:id/items`, `GET /runs/:id/items/:itemId`, `POST /runs/:id/items`,
  `PATCH /runs/:id/items/:itemId`, `POST /runs/:id/assign`,
  `DELETE /runs/:id/items/:itemId`.
- **Selection materialisation**: union of explicit `case_ids` and the suite
  subtree (reuse the slice-2 recursive CTE, `include_descendants`), de-duped,
  one `run_items` row per live case with the case snapshot, `position` by
  `case_number`. Cap 2,000 items (400 beyond).
- **Latest-status derivation**: lateral join to newest `results` row per item
  (no stored `status` on `run_items`); counts + `percent_complete` per
  `api-runs.md`.
- **Item status/counts before results exist** read as all-`untested` — 2.2
  wires results in; design the queries so 2.2 only adds the join.
- Tests: `run-counts.spec.ts` (pure rollup/percent rules),
  `runs.service.spec.ts` (selection de-dup, cap, close/reopen guard, item
  delete-with-results 409), `dto.spec.ts`, `test/runs.e2e-spec.ts`.
- DoD: endpoints per contract; unit + e2e green; lint/tsc/build clean.
- Notes: the migration shipped as `20261026000001_plans_runs_results_schema.js`
  (all five tables in one step). Contract-ambiguity resolutions are recorded in
  the commit body: runs list default sort `-created_at`; an unknown
  `selection.suite_id` is 400 `VALIDATION_ERROR`, unknown explicit `case_ids`
  are silently skipped and an unknown/foreign `plan_id` is 400; item DELETE
  guards on an existing result (409) but not on a completed run. 394 unit /
  208 e2e green; counts are derived live from `results`.

### Card 2.2 — Results & attachments (large) — DONE 2026-10-26
- **No new migration** (2.1 created `results`/`result_attachments`).
- **Endpoints**: `POST /runs/:id/items/:itemId/results`,
  `GET /runs/:id/items/:itemId/results`, `PATCH /results/:id`,
  `POST /results/:id/attachments`, `GET /attachments/:id`,
  `DELETE /attachments/:id`.
- **Rules**: `failed` requires a comment (400 naming `comment`); run must be
  `open` (409 otherwise); Tester may only write an item assigned to them (403);
  status is immutable on PATCH; only the item's **latest** result is editable /
  attachable (409 otherwise).
- **Attachments storage**: `STORAGE_DIR` env (default `./storage`), bytes at
  `<STORAGE_DIR>/attachments/<projectId>/<attachmentId>`, metadata row in the
  same request; serve only through `GET /attachments/:id` (401 without token);
  no static route. Add the storage dir to `.gitignore`; never log the path.
  Limits: type allow-list, ≤ 10 MB, max 5 per result.
- Wire `results` into the run/plan counts (2.1 left them all-untested).
- Tests: `results.service.spec.ts` (failed-without-comment, immutability,
  latest-only edit, Tester guard, completed-run 409), attachment unit +
  `test/results.e2e-spec.ts` (upload → download → 401 without token → limits).
- DoD: green unit + e2e; a stored file survives a restart; no secrets in code
  or logs.
- Notes: uploaded parts go through Nest's `FileInterceptor` (multer memory
  storage, no new dependency) wrapped so multer's 413 is rewritten to 400
  naming `file`; bytes are written before the metadata row and removed again if
  the row write fails, and DELETE removes the row before the bytes.
  `PATCH /results/:id` carries no completed-run guard (the contract literal
  lists only the latest-only and archived 409s). 420 unit / 227 e2e green, with
  a stored file surviving the request and streaming back byte-for-byte.

### Card 2.3 — Plans, rollups & linked runs (medium) — DONE 2026-10-26
- **Endpoints**: `GET/POST /projects/:projectId/plans`,
  `GET/PATCH/DELETE /plans/:id`.
- Plan delete detaches its runs (`plan_id = null`) in the same transaction.
- `plan.counts` / `run_count` rollup and run-list `assignee_ids` via grouped
  aggregates per page (no per-row queries).
- `GET /cases/:id/runs` — runs containing a case, newest first, excluding
  soft-deleted runs (fills the drawer's Linked runs tab).
- Tests: `plans.service.spec.ts` (unique name, detach-on-delete, rollup),
  `test/plans.e2e-spec.ts`, `test/case-runs.e2e-spec.ts`.
- Notes: a new `PlansModule` (`plans.constants.ts`, `plans.store.ts`,
  `plans.types.ts`, `dto.ts`, `plans.service.ts`, `plans.controller.ts`) plus the
  case→runs additions to the runs store/service/controller (`GET /cases/:id/runs`
  in a `CaseRunsController`). `LATEST_RESULT_JOIN` is now exported from
  `runs.store.ts` and reused by `plans.store.ts` so both rollups derive the item
  status identically; a plan's `counts`/`run_count` are a grouped aggregate per
  page (a completed run still counts, a soft-deleted run does not), and create
  returns the zeroed `barePlanDto` (a brand-new plan has no runs). Plan delete
  detaches runs with a literal `UPDATE runs SET plan_id = null WHERE plan_id = $1`
  in the same transaction as the soft delete (PRD decision 7). Duplicate plan
  name → 409 `CONFLICT` naming `name`; list default sort `-created_at`, null
  `due_date` last; linked-runs `updated_at` is the item's `updated_at` (bumped by
  `touchItem` on every result write). 438 unit / 256 e2e green.

---

## Phase 3 — frontend (Iris)

Read `web/node_modules/next/dist/docs/` before writing code (this Next.js has
breaking changes vs. older versions — see `web/AGENTS.md`). Reuse the existing
primitives: `StatusBar`, `StatusBadge`, `PriorityIcon`, `DataTable`, `Drawer`,
`Combobox`, `Dialog` from `web/src/components/ui/`.

### Card 3.1 — Runs list screen (medium) — DONE 2026-10-26
- Route `/runs` (project-scoped), replacing the `/wip/runs` placeholder; update
  the shell shortcut/`g r` target and the app-shell test.
- §4.3 table: name, plan, **status bar** (per row, from `counts`), `% complete`,
  assignee(s), due date; `Open`/`Completed` filter; empty/loading/error/no-perm
  states (§6).
- **New run** dialog: name, description, plan (optional), due date, and a case
  selection (explicit cases and/or a suite + descendants); POST then open the
  run.
- Notes: new `web/src/app/(app)/runs/page.tsx` (+ `runs.css`) mirrored from the
  canonical cases screen, with `lib/run-url.ts` (URL-as-state for
  search/status/sort/page), `lib/run-permissions.ts` (`canWriteRuns`) and
  `components/runs/RunFormDialog.tsx`. **Open is the UI default**: the screen
  always sends an explicit `status` to the API while the canonical URL drops it
  (and the default `-created_at` sort) so shared links stay short. Columns map
  backlog's `plan` in place of DESIGN §4.3's milestone; the assignee column is a
  count label because the contract only returns `assignee_ids` (flagged to
  Daedalus — `GET /users` is Admin-only, so non-Admins cannot resolve names).
  Plan ids resolve to names via `listPlans` (best-effort, `—` fallback). Due
  dates are plain `YYYY-MM-DD` rendered by `formatDateOnly` (parses the parts
  into a local `Date`, so `2026-11-14` never shifts a day in negative-offset
  zones). The dialog's case picker debounces into a separate
  `debouncedCaseQuery` state and clears on empty input from the handler, keeping
  every `setState` out of effect bodies (`react-hooks/set-state-in-effect`).
  Only the runs nav/`g r` target moved in this card; `/wip/plans` → `/plans` is
  card 3.3. 442 unit green (29 suites); a UI e2e suite does not exist (the "e2e"
  suites are server-side `*.e2e-spec.ts`, untouched here).

### Card 3.2 — Run detail + result drawer (large — the most-used screen) — DONE 2026-10-26
- Route `/runs/[id]`: header (name, status bar + "62% done · N passed · …",
  `[Assign] [Close run]`/`[Reopen]`), filter bar (Status / Assignee / Section /
  search, §4.4), items table (ID `C####`, title, Status badge, assignee,
  Updated).
- Result **drawer** (480px): case steps, `[Add result]` form — status segmented
  buttons with `P F B R S`, comment (`failed` ⇒ required, shown **inline**),
  elapsed time, defect link, attachment drop-zone; "Save and next"
  (`Ctrl+Enter`) advances to the next `untested` row; item result history.
- Assign / bulk assign; remove item (disabled with a reason once results exist).
- Notes: new `app/(app)/runs/[id]/page.tsx` (+ `run-detail.css`, all `rd-*`
  classes) and `components/runs/RunResultDrawer.tsx`,
  `components/runs/AssignItemsDialog.tsx`, `components/runs/MarkdownLite.tsx`,
  `lib/run-detail-url.ts`, `lib/markdown-lite.ts`. The URL is the state:
  `item` (drawer), repeatable `status` (comma-separated, sent as repeated query
  params), `assignee` (`none` = unassigned), `suite`, `query`, `sort` (default
  `position`) and `page`. A filter/search change resets the page; opening or
  closing the drawer never does, and the items list is keyed on the params with
  `item` removed, so recording a result does not refetch the table. Run status
  renders as a plain chip (`rd-run-status`) because `StatusBadge` only accepts
  the six result names; the items table's Status column does use `StatusBadge`.
  The drawer gates per item, not per run: `canRecordHere = canRecord &&
  canRecordOnItem(role, userId, item.assignee_id)` is computed **after** the item
  loads, so a deep link to an item outside the loaded page still gates correctly
  (the page only passes the run-level `canRecord` + the reason it is false).
  Shortcuts live in a scoped keymap on a `display: contents` wrapper around the
  shared `Drawer` (`data-shortcut-scope="run-result-form"`): `P F B R S` set the
  status, `Ctrl/Cmd+Enter` saves and advances to the next untested row of the
  loaded page (no next row ⇒ the drawer closes). Comments are markdown-lite —
  plain text, line breaks and auto-linked `http(s)` URLs only, rendered as React
  nodes (never `dangerouslySetInnerHTML`); a bare `https://` with no host stays
  text. Attachments: files staged on a new result upload one-per-request after
  the result is created; only the latest result offers `Edit result` (status is
  immutable, the segmented buttons are disabled while editing) and
  `Add attachment`, both for the author or Admin/Lead. `Remove from run` sits in
  the drawer footer and is disabled with "Items with results cannot be removed —
  clear the assignee instead" once `result_count > 0`. Client attachment rules
  mirror the server (allow-list, 5 per result, 10 MB each). `api-client.ts` grew
  a `formData` request option (multipart, no explicit `Content-Type`) and
  `apiFetchBlob` (token + one refresh/retry on 401) for attachment downloads.
  Assign options are role-limited: Admin gets the active `admin|lead|tester`
  users by name from `GET /users`, while Lead/Tester get the ids already on the
  run (short ids) plus Unassign with a hint — **flagged to Daedalus**: the
  contract has no non-Admin user list, and the run screen has no "add cases"
  control yet (card 3.4). Tests: 8 page, 8 drawer, 30 for `run-detail-url` +
  `markdown-lite`; full web suite 488 unit green (33 suites), `tsc`/`lint`/`build`
  clean. Only `/wip/plans` → `/plans` and the cases↔runs wiring remain (3.3, 3.4).

### Card 3.3 — Plans screen (medium) — DONE 2026-10-26
- Route `/plans` replacing `/wip/plans`; plans table with an aggregate status
  bar; plan detail listing its runs (reuses the runs table); New/Edit/Delete
  plan (delete confirm names the "runs will be kept" consequence).
- Notes: new `app/(app)/plans/page.tsx` (+ `plans.css`), `app/(app)/plans/[id]/
  page.tsx` (+ `plan-detail.css`, all `pd-*` classes — no shared class names with
  the runs screens), `components/plans/PlanFormDialog.tsx`,
  `lib/plan-url.ts`, `lib/plan-permissions.ts`. Three decisions worth recording:
  (1) plan detail is a **route** (`/plans/[id]`), not a drawer; (2) the detail's
  runs list is a compact **read-only** table, deliberately not an extraction of
  the runs screen's table — that table stays private to the runs screen until a
  third caller needs it; (3) there is **no status filter** (a plan is a
  container, not a run) and **no milestone column** (the contract has no
  `milestone_id`), so the columns are Name (sortable), Runs, Status
  (`StatusBar`, or "No runs" at 0 items), % complete, Due date (sortable),
  Actions. URL-as-state is `?project`, `?query`, `?sort` (default `-created_at`)
  and `?page`; a search change resets the page. Writes are Admin/Lead
  (`canWritePlans`) and archived projects are read-only for everyone. The dialog
  is dual-mode and always submits all three fields, so an emptied input sends
  `null`; `isDateOnly()` is exported and unit-tested (`2026-02-30` is rejected).
  Delete confirms with "Its runs are kept…" (PRD decision 7), then refetches —
  stepping back a page if the deleted row was the only one on a page > 1. Runs
  on the detail screen come from `GET /projects/:id/runs?plan_id=…` (the contract
  does not embed them). Sidebar and `g p` now point at `/plans`; the help
  dialog already said `g p`. Tests: 17 for `plan-url`, 8 dialog, 8 list page, 4
  detail; full web suite 525 unit green (37 suites), `tsc`/`lint`/`build` clean
  with `/plans` and `/plans/[id]`. Flagged for 3.4: `/wip/[slug]` still maps
  `plans`, now unreachable from the nav.

### Card 3.4 — Cases ↔ runs integration (small/medium) — DONE 2026-10-27
- Cases bulk bar: **Add to run…** opens `AddToRunDialog`, which lists the
  project's open runs (`status=open`) and calls `POST /runs/:id/items`.
  Nothing is preselected — the dialog refuses to submit until a run is chosen.
  The API skips a case already in the run, so the flash names both counts
  ("Added 1 case to “Run October”. 1 case was already in the run." / "No new
  cases — all 2 cases are already in “Run October”.") and the selection is
  cleared. Admin/Lead only; an archived project hides it like the other bulk
  actions.
- `CaseDrawer` "Linked runs" is real: `GET /cases/:id/runs`, paginated like
  History, one row per run with the case's status in it, the run's own status
  (Open/Completed) and a link to `/runs/:id?project=…`.
- Shell honesty: the top bar only searches projects, so its label and
  placeholder now say **Search projects**; `/wip/[slug]` keeps entries only
  for screens that are still unbuilt (overview, milestones, reports) — the
  shipped ones (cases, runs, plans, settings) fall through to the raw slug.
  `g c`/`g r`/`g p` and the help dialog already pointed at the real routes.
- Notes: the write lives on the page (`runAddToRun`) while the dialog owns the
  run lookup, matching RunFormDialog's case search. `addToRunNotice()` is
  exported so its copy has unit coverage. Not built here: adding a case to a
  run from inside the drawer — the cases bulk bar is the only entry point.
- Verified: `tsc`/`lint` clean, jest 545 passed (38 suites); live as viewer —
  C38's Linked runs tab lists Run October (Passed, link opens the run) and the
  three bulk actions render disabled.

### Card 3.5 — Run start date (review feedback, small) — DONE 2026-10-27
- The New run dialog needed a **Start date** above **Due date**. Implemented end
  to end: `docs/api-runs.md` (commit `b491d31`), migration
  `20261027000001_runs_start_date` + DTOs/service/store (`54c2207`), dialog +
  run detail subtitle (`ae119cc`).
- Notes: the column is nullable, so every existing run reads back
  `start_date: null`. The single cross-field rule is `start_date ≤ due_date`,
  enforced on the merged PATCH value (400 `VALIDATION_ERROR`, field
  `start_date`), so a due date moving before an existing start fails too.
  Create run stores it; the page maps the server's `start_date` field error
  onto the Start date input. Deferred at the user's request: **multi-suite
  selection** in the same dialog — needs a decision on shape (several suites as
  chips vs. a single suite) before it is built.
- Verified: server unit 445 (27 suites), server e2e 258 (11 suites), web unit
  534 (37 suites), `tsc`/`lint` clean; live API on `:3001` returns
  `start_date` on run list/detail.

---

### Card 3.6 — Runs list: Start date column (review feedback, small) — DONE 2026-10-27
- The **Test runs** table now shows **Start date** immediately before **Due
  date** (`web/src/app/(app)/runs/page.tsx`): a `<time>` cell rendered through
  `formatDateOnly` (so a `YYYY-MM-DD` never shifts a day in a negative-offset
  zone), an `—` when the run has no start date, and the loading skeleton grew
  to 7 columns.
- Column shares were rebalanced to keep the fixed layout at 100%
  (`runs.css`), and both date columns are `white-space: nowrap` — a `29 Oct` /
  `2026` split reads as two values. Verified at 1600px and 1024px wide.
- Follow-up (same review thread): **Start date sorts exactly like Due date**.
  `docs/api-runs.md` now lists `start_date` in the `sort` row with the rule
  "null `start_date`/`due_date` sort last in both directions";
  `RUN_SORTS`/`RUN_SORT_PATTERN`/`RUN_SORT_COLUMNS` in the server gained
  `start_date` with `NULLS LAST`, and the web column is `sortable` with
  `sortValue` → `?sort=start_date` / `?sort=-start_date`. No migration: the run
  list already returned `start_date` (card 3.5).
- Contract-adjacent fix, found while testing the descending direction:
  `DataTable` multiplied the comparison by the sort direction, so an empty cell
  (`—`) floated to the **top** of a descending sort — a pre-existing bug that
  also affected Due date. `sortedRows` now pulls empty values out before the
  direction is applied, so they stay last both ways.
- Verified: server `tsc`/`lint` clean, unit 446 (27 suites), `runs` +
  `case-runs` e2e 39 (start date asc/desc with nulls last, `sort=bogus` → 400);
  web `tsc`/`eslint` clean, jest 549 (38 suites). Live as Tester on Webshop QA —
  clicking Start date writes `?sort=start_date` then `?sort=-start_date`, `ABC`
  (Oct 29) leads and `Run October` (`—`) stays last in both directions; the
  sort indicator shows on the column; dates stay on one line in wide and narrow
  windows.

---

### Card 3.7 — Run detail: pie rollup, hover contrast, × remove (review feedback, small) — DONE 2026-10-27
- Three notes from the same review pass on the run detail screen.
- **Progress bar → pie.** New `web/src/components/ui/StatusPie.tsx` (+ CSS,
  exported from `ui/index.ts`), on the run detail header: a **full pie** — no
  hole, no number in the middle — with one wedge per nonzero status in the fixed
  `STATUS_ORDER`, filled with the status solids (tints stay reserved for badges,
  §2.2). Wedges are SVG paths built from prefix-sum angles starting at 12
  o'clock; a status that owns the whole run renders as a full circle instead,
  where an arc would collapse. The SVG is `aria-hidden` and the `role="group"`
  is named "`<run>` results by status". `StatusBar` is untouched and still used
  by the runs list, plans and plan detail; `runHeadline()` and `.rd-headline`
  were removed.
- **The legend carries the numbers** (reviewer's reference): two columns of
  three, each row a status dot, a bold "110 Passed" line and a muted "46% set to
  Passed" line under it. All six statuses are listed, zeros included at 0 / 0%,
  and a zero row keeps its status-coloured dot — the dot is the colour key, not
  a presence indicator. Shares are `round(count / total × 100)`; the overall
  "done" figure the earlier cut showed in the middle still exists as
  `percent_complete` on the run resource and as `% complete` on the runs list.
  History: donut with `33% done` in the centre → 132px donut on a card → this
  full pie with per-status shares.
- **Card.** `.rd-summary` is a row of cards — `display: flex`, `align-items:
  stretch`, 12px gap — and every child carries the chrome (`--surface`, 1px
  `--border`, 10px radius, 16/24px padding). The row is 768 + 544px at 1600px
  and 584 + 328px at 1024px: both cards flex-grow from `36rem` / `20rem` bases
  so the pair spans the content width. The first cut hugged its content and left
  the right half of the header empty — that is the dead space this fills.
- **Headline on its own card** (third review pass): the passed share as a big
  number — 40px/44px `--ink-900` — with "passed" at 18px under it, then a muted
  13px footer "1 / 3 untested (33%).", matching the reviewer's reference, where
  the overall figure is a separate surface beside the breakdown rather than a
  column inside it. New `web/src/components/ui/StatusSummary.tsx` (+ CSS,
  exported from `ui/index.ts`); `sharePercent` and `statusTotal` moved into
  `StatusPie.tsx` as exports so both cards round identically. The block is
  `white-space: nowrap` with a 20rem min-width and centred text, so it keeps a
  steady width as results land. A run with no items reads "0% passed" and
  "0 / 0 untested (0%)." The overall "done" figure the first cut put in the
  donut hole is not lost — it is `percent_complete` on the run resource and
  `% complete` on the runs list.
- **Filling the dead space** (fourth review pass): the two cards sat at their
  content width and left the right half of the header blank. Both now flex-grow
  from `36rem` (`StatusPie`) and `20rem` (`StatusSummary`) bases, so the pair
  spans the row — 768 + 544px at 1600px, 584 + 328px at 1024px — and the pie and
  legend stay a centred group inside their card instead of being pushed to
  opposite edges. Below ~900px of content the row wraps and the headline drops
  under the pie. The flex bases are load-bearing: at `34rem` the 1024px card
  fell 2px short of pie + legend and silently stacked them.
- **Hover contrast on the result status buttons.** First pass (brand tint +
  darker border/label) was still too quiet on the real screen — the reviewer's
  screenshot showed the hovered button almost identical to its neighbours.
  Second pass previews the status itself: each button carries a
  `.rd-seg-<status>` hook that sets `--seg` / `--seg-tint` from the status pair,
  and hover/focus draws that tint as the fill plus the status solid as a 2px
  edge (1px border + 1px inset ring, so nothing shifts) with `--ink-900` on the
  label. The label stays ink deliberately: 13px text in the status colour on its
  own tint only reaches ~3.4:1 (`--passed` on `--passed-tint`), while the solid
  on the edge clears the 3:1 UI floor. The chosen status keeps its solid brand
  fill and is excluded from the preview. The `button.` prefix on the rule exists
  only to out-rank the global secondary-button hover in `globals.css`.
- **`×` instead of "Remove <filename>".** Staged files and uploaded attachments
  both render an icon-only `×` (`.rd-icon-btn`, 22px, destructive hover) with
  `aria-label="Remove <filename>"` and `title="Remove"`, so the file name stays
  as text beside it and the accessible name survives.
- **The picker says what it accepts** (fifth review pass, the reviewer boxed the
  hint line). First cut: "Allowed: PNG, JPG, GIF, WebP, PDF, TXT, CSV, ZIP."
  Then the reviewer uploaded a `.zip` and it was refused: Windows reports `.zip`
  as `application/x-zip-compressed` and `.csv` as `application/vnd.ms-excel`
  (read from the registry, and it is the OS table the browser uses), neither on
  the MIME allow-list, so both failed there while working on macOS/Linux. The
  second cut dropped those two labels but kept them accepted. Final ruling
  (sixth review pass): **the allow-list is exactly PNG, JPG, JPEG, WebP, PDF, on
  every OS**. The check moved from MIME to the **filename extension**, which is
  the same string on every platform; `accept` is now `.png,.jpg,.jpeg,.webp,.pdf`
  and the server derives the stored `content_type` from that extension
  (`.jpg`/`.jpeg` → `image/jpeg`), ignoring the part's own `Content-Type`. So
  one array drives `accept`, the hint ("Allowed: PNG, JPG, JPEG, WebP, PDF.") and
  the pick-time check, the three cannot drift, and `.zip`/`.csv`/`.gif`/`.txt`
  are refused everywhere rather than only on some machines. The trade-off:
  the name is trusted, not the bytes. The history row's "Add attachment" link
  gets the same list as a `title` rather than a second hint line (its row is a
  text link, a hint paragraph would break the line).
- **Attachment cards + a viewer** (seventh review pass: "wrap it in card so its
  more aesthetic then make it clickable view the attachment… open a modal
  contains the file"). Staged files and saved attachments now share one card:
  an extension chip (image in the brand tint, PDF in the failed tint), the
  name, the size, and the `×` beside them. The name/size button
  (`aria-label="View <filename>"`) opens `AttachmentViewer` — a scrim'd modal
  (the drawer's non-modal, no-scrim rule stops at a file you cannot see at
  480px), focus moved in, Tab trapped, Escape closes, every other key swallowed
  so the run page's shortcuts cannot fire behind it. Images render in an
  `<img>`, PDFs in an `<iframe>` fed by a blob URL, with "Open in new tab" and
  "Download" in the footer. Staged files preview straight from the in-memory
  `File`; saved ones are fetched through `api.fetchAttachmentBlob` first, and
  a close during the fetch wins on a request id. The blob URL is revoked on
  close, on replace and on unmount.
- Verified: web `tsc`/`eslint` clean, jest **570** (40 suites) including seven
  new `StatusPie` tests, three drawer attachment tests (staged image viewer +
  revoke, uploaded PDF `iframe` after a fetch, icon-only removal) and the
  run-detail pie test. Live as Tester on `Run October` — header
  group reads "Run October results by status", centre `33% done`, legend
  `Passed 1 · Retest 0 · Blocked 0 · Failed 0 · Skipped 0 · Untested 2`.
  **Verification note:** the reviewer's Admin session showed the first hover pass
  was too quiet, so the second pass was checked in the browser against the app's
  own served stylesheet (button classes rendered on the run page, pointer over
  Failed): fill `#fbe9e9`, border and inset ring `#c23a3a`, label `#17202e`.
  The `×` control and the attachment cards/viewer are still unit-tested only —
  they need a writer session with an item open or a saved attachment, and the
  Tester account never gets the result form because every item in these runs is
  unassigned.

---

## Phase 4 — QA (Argus)

### Card 4.1 — E2E verification of plans & runs (medium) — PENDING
- Bring up the stack; verify PRD acceptance criteria 1–14 as each role
  (Admin/Lead/Tester/Viewer), UI end-to-end only (no DevTools, console, network
  or API probing).
- Cover: run creation selection, de-dup, status bar exactness, failed-comment
  requirement, Tester-on-assigned-item, append-only results, Save-and-next +
  shortcuts, close/reopen guard, item add/remove guard, attachment upload +
  survives reload, plan rollup + detach-on-delete, Linked runs tab, §6 states.
- Report + failure cards with repro steps if any.

---

## Sizing summary

| Phase | Cards | Est. total |
|---|---|---|
| 1 — contracts | 1 (docs) | done |
| 2 — backend | 3 (2 large, 1 medium) | ~5–7h |
| 3 — frontend | 4 (1 large, 2 medium, 1 small) | ~6–8h |
| 4 — QA | 1 | ~1–1.5h |
| **Total** | **9 cards** | **~12–17h agent time** |

Phases 2 and 3 overlap: Iris builds the runs list and plans screen against the
frozen contract while Hephaestus finishes results/attachments. Card 3.2 (run
detail) is the long pole on the frontend and needs 2.2 in place first.