# PRD — Test Suites & Cases (MVP)

Status: **Approved — Arif, 2026-10-25** (both open questions accepted as
proposed: Testers read-only on cases, deleted case numbers stay reserved)
Owner: Daedalus
Slice: 2 (cards 1.1/1.2 of `docs/backlog-slice2-suites-cases.md`)
API contracts: `docs/api-suites.md`, `docs/api-cases.md`, shared rules in
`docs/api-conventions.md`
Design: `docs/DESIGN.md` §4.2 (two-pane cases screen), §5 (tree, table,
drawer), §6 (states), §9 (dates/copy)

## Problem
Slice 1 gave Qalm projects, but a project is only a container. Test cases are
the unit of testing: plans, runs, results, and every report in the remaining
MVP slices consume them. Until cases exist, the product cannot test anything.

## Goals
- A project holds a tree of **test suites**, at most **3 levels** deep,
  reorderable, with per-node case counts.
- A **test case** belongs to exactly one suite and carries: title,
  preconditions, ordered steps (step + expected result), priority, type,
  tags, and an estimate in minutes.
- Every case gets a stable, human-readable, **project-scoped ID** (`C1042`)
  that survives moves and is used by runs and reports later.
- The §4.2 two-pane screen: tree on the left, filterable case table on the
  right, case detail in a drawer, case editor as a form.
- Case changes are auditable at a minimal level: who changed what, when.

## Non-goals (MVP)
- Custom fields, custom case types, per-project configuration (fixed list for
  MVP; see Decisions).
- Case versioning, baselines, review/approval workflows.
- Case attachments, screenshots, markdown rendering in case bodies.
- Copy/clone cases, CSV import/export of cases (import/export is a later
  slice), moving cases between projects.
- Linkage to runs/results (next slice writes into it; this slice only leaves
  `C1042` stable for it).
- Global/full-text search across cases (top-bar search stays projects-only
  until the cases slice re-wires it).

## Data model (product level)

### Suite
| Field | Rules |
|---|---|
| `name` | Required, trimmed 1–100 chars, unique among siblings (case-insensitive). |
| `description` | Optional, ≤ 500 chars. |
| `parent_id` | Optional; another suite **in the same project**. Root suites have `null`. |
| `depth` | Derived: root = 1, child = 2, grandchild = 3. **Maximum 3.** |
| `position` | Order among siblings, 1-based, dense. Drag-and-drop and "move up/down" rewrite it. |
| `case_count` | Read-only: cases in this suite **and all descendants** (deleted cases excluded). |

### Case
| Field | Rules |
|---|---|
| `case_number` | Integer ≥ 1, allocated per project, immutable, never reused. Displayed as `C{case_number}` (`C1042`). Gaps are allowed after a failed transaction. |
| `title` | Required, trimmed 1–200 chars. |
| `preconditions` | Optional, ≤ 2,000 chars. |
| `steps` | Ordered list, 0–50 entries. Each entry: `text` 1–500 chars, `expected_result` optional ≤ 500 chars. Order is meaningful and editable. |
| `suite_id` | Required, same project. |
| `priority` | One of `critical`, `high`, `medium`, `low`. |
| `type` | One of `functional`, `regression`, `smoke`, `exploratory`, `other` (fixed list, MVP). |
| `tags` | 0–20 tags, each 1–30 chars, lowercase-normalized, duplicates removed. |
| `estimate_minutes` | Optional integer 0–10,080 (one week). UI accepts `90` or `1h 30m` and normalises to minutes. |
| `created_by` / `updated_by` | User ids. |

### Case history
An append-only audit trail per case: `created`, `updated` (field-level diff),
`moved` (from suite → to suite), `deleted`. Read-only in the UI (drawer
"History" tab). This is an audit trail, not an undo log.

## Roles
| Action | Admin | Lead | Tester | Viewer |
|---|---|---|---|---|
| Read suites, cases, history | ✔ | ✔ | ✔ | ✔ |
| Create/edit/reorder/delete suites | ✔ | ✔ | – | – |
| Create/edit/delete/move cases | ✔ | ✔ | – | – |

This follows PRD-auth ("Lead: manage test suites, cases…; Tester: record
results… read all cases; Viewer: read-only"). Tester write access to cases is
**not** granted in MVP — if testers need to author cases, that is a separate
decision, not an implied one.

## Delete semantics
- **Suite** — deletable only when empty: no child suites and no live cases.
  Otherwise `409 CONFLICT` naming the blocker (children or case count). Nothing
  cascades; nothing is silently moved. The UI's confirm dialog explains how to
  empty the suite first.
- **Case** — confirm dialog, then a **soft delete** (`deleted_at`). The case
  disappears from lists, counts, filters, moves and `GET /cases/:id` (404),
  but its history rows and its number stay reserved. Reason: the runs slice
  will reference cases by id; deleting a case must never break or anonymise
  the results history behind it.
- **Project archived** — writes to suites and cases return `409 CONFLICT`
  ("project is archived"). Reads keep working for Admins; archived projects
  stay 404 for everyone else (api-projects.md).

## Acceptance criteria
1. An Admin or Lead creates a suite at root, in a child, and in a grandchild;
   creating a 4th level or moving a subtree past depth 3 returns `400
   VALIDATION_ERROR` naming `parent_id`.
2. A suite cannot be moved into itself or its own descendant (`400`).
3. Suite names are unique among siblings, case-insensitively (`409`
   otherwise); the same name may exist under a different parent.
4. Deleting a suite with live cases or child suites returns `409`; deleting an
   empty suite returns `204` and removes it from the tree.
5. Reordering suites rewrites positions densely; the tree order after reload
   matches what the user dragged.
6. A case can be created in any suite with 0–50 ordered steps; editing steps
   preserves the submitted order; a step with empty `text` is rejected with
   the offending index in `details`.
7. `case_number` is unique per project, immutable across edits and moves, and
   displayed as `C####` everywhere (table, drawer, history).
8. The cases list supports `query` (title substring), `priority`, `type` and
   `tag` filters, combinable, over a selected suite including its descendants
   by default; pagination defaults to 25, caps at 100.
9. Bulk move of selected cases to another suite (same project) is atomic:
   either all move or none do, and each moved case writes a `moved` history
   entry.
10. The drawer shows Details / History / Linked runs; "Linked runs" is a
    placeholder in this slice.
11. Tester and Viewer writes return `403`; every screen renders the §6 states
    (loading skeleton, empty, error with retry, no permission).
12. The tree is keyboard-navigable (ARIA treeview, arrows, expand/collapse)
    and drag-to-reorder works with pointer as well as keyboard.

## Decisions (Arif, 2026-10-25)
1. **Nesting cap: 3 levels.** Enforced server-side on create and move; the
   tree's "Add suite" action is disabled at depth 3.
2. **Deleting a non-empty suite: blocked.** No cascade, no fallback suite.
3. **Case types: fixed list for MVP** — Functional, Regression, Smoke,
   Exploratory, Other. Stored as a plain string so per-project lists can
   replace it post-MVP without a data migration.
4. **Estimate: numeric minutes.** Integer minutes in the API; the form accepts
   `1h 30m` and normalises on save.

## Confirmed with the approval (Arif, 2026-10-25)
1. **Tester write access** — Testers stay read-only on cases; they write only
   results in the runs slice.
2. **Case soft delete** — confirmed: a deleted case's number stays reserved
   and is never reused, so old run results always point at a meaningful
   `C####`.
