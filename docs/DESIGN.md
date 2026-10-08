# Qalm Design System

Qalm is a test management web app. Testers spend hours in it, so the design
must be **dense, fast to scan, and calm**. The reference for structure and
density is TestRail: a project-scoped app with a case tree, run tables, and
status-driven reports. Qalm keeps that familiar workflow but has its own look.

Owner: Iris (frontend). Reviewer: Daedalus. Code lives in `/web`.
When this file and a ticket disagree, ask Daedalus. Do not guess.

---

## 1. Principles

1. **Status is the main visual language.** Colour is reserved for test status
   and for the single brand accent. Everything else is neutral.
2. **Density over decoration.** Compact rows, tight spacing, no hero sections,
   no large illustrations. A tester should see 20+ rows without scrolling.
3. **Never colour alone.** Every status has a colour, an icon shape, and a text
   label. Colour-blind users must be able to read every table.
4. **Keyboard first.** Testers record hundreds of results. Every frequent
   action needs a shortcut and a visible focus state.
5. **Structure is information.** Borders, dividers and numbers appear only when
   they mean something (a hierarchy, a sequence, a group). No decorative cards,
   no gradient washes, no drop shadows on content blocks.
6. **One memorable thing:** the segmented **status bar** (see 6.4). It appears
   on runs, plans, milestones and dashboards. Keep everything around it quiet.

Name origin: *qalam* means pen. The brand accent is ink blue.

---

## 2. Design tokens

Define as CSS variables in `web/src/styles/tokens.css` and map them in the
Tailwind config. Do not hard-code hex values in components.

### 2.1 Colour (light theme)

| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#17202E` | Primary text |
| `--ink-700` | `#3A4658` | Secondary text, icons |
| `--ink-500` | `#5C6B82` | Tertiary text, placeholders. Darkened from `#66748A` (which reached only 4.38:1 on `--canvas`) so it passes 4.5:1 on both `--surface` (5.41) and `--canvas` (5.00) — t_5fa1c284. |
| `--line` | `#DCE1E9` | Borders, dividers |
| `--canvas` | `#F4F6F9` | App background |
| `--surface` | `#FFFFFF` | Tables, panels, dialogs |
| `--brand` | `#263FA0` | Primary buttons, links, selected nav, focus ring |
| `--brand-hover` | `#1D3282` | Hover/pressed brand |
| `--brand-tint` | `#E9EDFA` | Selected row, active tree node |

### 2.2 Status colours (semantic, never reuse for decoration)

| Status | Solid | Tint (badge background) | Icon shape |
|---|---|---|---|
| Passed | `#1F8A5B` | `#E4F4EC` | check in circle |
| Failed | `#C23A3A` | `#FBE9E9` | x in circle |
| Blocked | `#B7770D` | `#FCF1DC` | minus in square |
| Retest | `#6B4FC2` | `#EFEAFB` | circular arrow |
| Skipped | `#6B7686` | `#EDEFF3` | forward arrow |
| Untested | `#9AA5B5` | `#F1F3F6` | empty ring, `--ink-700` stroke |

Priority uses shape and weight, not new colours: Critical (double chevron up),
High (chevron up), Medium (dash), Low (chevron down). Use `--ink-700`, with
Critical in `--failed`.

**Status badge (AA-compliant spec, decision t_5fa1c284, 2026-10-08).** The
original badge — solid-coloured text on the tint — fails the §8 floor
(4.5:1) on 4 of 6 statuses (passed 3.81, blocked 3.31, skipped 4.00, untested
2.24), so it is replaced by:

- Text: always `--ink-900`, weight 500. ≥ 13.9:1 on every tint.
- Icon: the status solid, except untested uses `--ink-700` (the untested solid
  is 2.24:1 on its tint; `--ink-700` is 8.60:1). Every icon ≥ 3:1 on its tint.
  Icons are supplementary: each badge keeps a full text label, so status is
  never colour-only (principle 3).
- Background: the status tint, unchanged. 4px radius, 22px high, same markup
  everywhere (unchanged from §5).
- Failed keeps solid text as before: `#C23A3A` on its tint is 4.53:1, which
  passes. Using `--ink-900` for it too is also compliant, but solid text on
  failed is retained because failed is the one state that must read
  instantly. (Retest also passes at 5.06 but stays ink-900 for uniformity.)
- Dark theme: same rule, ink tokens flip under `[data-theme="dark"]`; pick
  text/icon colours per §2.3 to hold 4.5:1 / 3:1 on the dark surface.

### 2.3 Colour (dark theme)

Provide a dark theme through the same token names under
`[data-theme="dark"]`. Canvas `#0F141C`, surface `#161D28`, line `#2A3342`,
ink-900 `#E8EDF5`, brand `#7C93F0`. Lighten status solids until they reach 4.5:1
on the dark surface. Dark theme is a phase 2 item; build tokens for it now.

### 2.4 Typography

One family: **IBM Plex Sans** (400, 500, 600). Fallback:
`system-ui, -apple-system, "Segoe UI", sans-serif`.
Enable `font-variant-numeric: tabular-nums` on every table, ID and count so
numbers align.

| Role | Size / line | Weight |
|---|---|---|
| Page title | 22 / 28 | 600 |
| Section title | 16 / 24 | 600 |
| Body, table cell | 14 / 20 | 400 |
| Table header | 13 / 18 | 600, `--ink-700`, sentence case |
| Caption, helper | 12 / 16 | 400, `--ink-500` |

Rules: sentence case everywhere, no all-caps labels, no letter-spacing tricks.
Line length for prose (case descriptions, comments) is capped at 72 characters.
Case IDs use the form `C1042`, tabular figures, weight 500.

### 2.5 Spacing, radius, elevation

- Spacing scale (px): 2, 4, 8, 12, 16, 24, 32, 48. Base unit is 4.
- Radius depends on the element: inputs and buttons 6, badges 4, dialogs and
  drawers 10. Tables and panels have 0 radius on inner edges.
- Elevation: none for content. Only dialogs, popovers and drawers have a shadow
  (`0 8px 24px rgba(23,32,46,.16)`).
- Row heights: table row 36 (compact 32, comfortable 44, user setting).
  Control height 32 (default), 28 (small), 40 (large, auth screens only).

---

## 3. App shell and layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▣ Qalm   [Project: Checkout ▾]   [Search cases, runs…  /]     ? 🔔  (AB) │  Top bar 48px
├────────────┬─────────────────────────────────────────────────────────────┤
│ Overview   │  Page title                         [Secondary] [Primary]   │
│ Test cases │  ─ tabs ─────────────────────────────────────────────────── │
│ Test runs  │  Filter bar                                                 │
│ Test plans │  ┌───────────────────────────────────────────────────────┐  │
│ Milestones │  │ Content (table / two-pane / report)                   │  │
│ Reports    │  │                                                       │  │
│ ────────── │  └───────────────────────────────────────────────────────┘  │
│ Settings   │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
  Sidebar 232px (collapses to 56px icons)          Content max-width: none
```

- The sidebar is **project-scoped**. Switching project is in the top bar.
- Page content uses the full width. Do not centre it in a narrow column.
- Left-align everything. Numbers in tables are right-aligned.
- The active nav item uses `--brand-tint` background and a 2px `--brand` bar.
- Breakpoints: 1280+ full layout, 1024 sidebar collapsed, below 768 is
  read-only friendly (tables scroll horizontally inside their own container,
  never the page body). Recording results must work on a tablet.

---

## 4. Key screens

### 4.1 Projects list

Table: name, key, description, last activity (from `updated_at`). **The
`open runs`, `pass rate (status bar)` and `members` columns were cut for the
MVP** — see "Projects list columns" in `docs/api-projects.md` (decision
t_5fa1c284, 2026-10-08): none of the three has a backing resource in the MVP
contract, and per-project membership is out of scope. When the runs slice is
contracted, restore pass rate via `GET /api/v1/projects/summary?ids=...`
(one batched call, never per-row fan-out). Primary action: **New project**.
Empty state: "No projects yet. Create a project to start organising test
cases."

### 4.2 Test cases (two-pane)

```
┌ Suites ──────────────┬ Checkout › Payment ─────────────── [Add case] [Import]
│ ▾ Checkout       124 │ [Filter ▾] [Priority ▾] [Type ▾] [Tags ▾]   124 cases
│   ▾ Payment       38 │ ┌──┬───────┬────────────────────────┬────────┬───────┐
│     Cards         21 │ │☐ │ ID    │ Title                  │ Priori │ Type  │
│     Wallets       17 │ ├──┼───────┼────────────────────────┼────────┼───────┤
│   ▸ Cart          30 │ │☐ │ C1042 │ Pay with saved card    │ ▲ High │ Func. │
│ ▸ Accounts        61 │ │☑ │ C1043 │ Card declined message  │ ▲ High │ Func. │
│ [+ Add suite]        │ └──┴───────┴────────────────────────┴────────┴───────┘
└──────────────────────┴─ 2 selected: [Move] [Add to run] [Delete] ───────────┘
```

- Left tree 280px, resizable, shows case counts. Supports keyboard arrows,
  drag to reorder, and drag cases onto a section.
- Selecting a case opens the **case detail** in a right drawer (480px) with tabs:
  Details, History, Linked runs.
- Case editor fields: title, preconditions, steps (table: step, expected
  result, reorderable), priority, type, tags, estimate. Steps are a numbered
  list because they are a real sequence.
- Bulk action bar replaces the filter bar when rows are selected.

### 4.3 Test runs list

Columns: name, milestone, status bar (the memorable element), % complete,
assignee, due date. Filter by Open / Completed.

### 4.4 Run detail (the most-used screen)

```
┌ Run: Release 2.4 smoke ──────────────────────── [Assign] [Close run]
│ [██████████▓▓▓▓▒▒░░░░░░]  62% done · 31 passed · 4 failed · 2 blocked · 13 untested
│ [Status ▾] [Assignee ▾] [Section ▾]  Search…
│ ┌───────┬─────────────────────────┬──────────┬────────────┬──────────────┐
│ │ ID    │ Title                   │ Status   │ Assignee   │ Updated      │
│ │ C1042 │ Pay with saved card     │ ✓ Passed │ Dewi       │ 10 min ago   │
│ │ C1043 │ Card declined message   │ ✕ Failed │ Arif       │ 1 h ago      │
│ └───────┴─────────────────────────┴──────────┴────────────┴──────────────┘
└ Click a row → result drawer (480px): case steps, [Add result] form, history
```

- **Add result** form: status (segmented buttons with shortcuts P, F, B, R, S),
  comment (markdown), elapsed time, defect link, attachments (drag and drop).
- After saving a result, move focus to the next untested row ("Save and next",
  `Ctrl+Enter`).
- Failed results require a comment. Show the reason inline, not in a toast.

### 4.5 Plans, milestones

Plan: a table of runs with an aggregate status bar per row and in the header.
Milestone: name, due date, progress bar, linked runs, days left.

### 4.6 Reports and dashboard

Widgets in a 12-column grid, 16px gutters:

- Pass rate over time (line)
- Results by status (stacked bar)
- Failures by section (horizontal bar, sorted)
- Open runs with status bars (table)
- Activity feed

Chart rules: use status colours only for status data. Label directly where
possible. Always provide a "View as table" toggle for accessibility. Titles
state the insight source ("Pass rate, last 30 days"), not decoration.

### 4.7 Settings and users

Left sub-nav: Project, Members and roles, Case fields (phase 2), Integrations
(phase 2). Roles: Admin, Lead, Tester, Viewer. Hide or disable controls the
role cannot use, and explain why on hover ("Viewers can't edit cases").

---

## 5. Components

Build on accessible primitives (Radix UI or similar) with Tailwind CSS using
the tokens above. Put shared components in `web/src/components/ui/`.
Do not add a UI library without Daedalus's approval.

| Component | Rules |
|---|---|
| **Button** | Primary (`--brand`), secondary (outline), ghost, danger. One primary per view. Label is a verb: "Save case", "Add result", never "Submit". |
| **Status badge** | Tint background, `--ink-900` text, status-solid icon (untested icon uses `--ink-700`) — exact rules in §2.2. 4px radius, 22px high. Same markup everywhere. |
| **Status bar** | Segmented horizontal bar, 8px high in tables, 16px on dashboards. Segment order: Passed, Retest, Blocked, Failed, Skipped, Untested. Hover shows counts. Include `role="img"` and an `aria-label` that spells out the numbers. |
| **Data table** | Sticky header, sortable columns, column resize, row selection, row hover `--canvas`, selected row `--brand-tint`. Virtualise above 200 rows. Pagination or infinite scroll must keep scroll position. |
| **Tree** | ARIA treeview, arrow-key navigation, counts right-aligned, drag handle on hover. |
| **Tabs** | Underline style, active tab has a 2px `--brand` underline. |
| **Drawer** | Right side, 480px, closes with Esc, does not block the table behind it. |
| **Dialog** | For destructive or short forms only. Focus trap, Esc closes. |
| **Form field** | Label above, helper text below, error text replaces helper text. Validate on blur and on submit. |
| **Filter bar** | Chips for active filters, "Clear all" link, saved views (phase 2). |
| **Toast** | Bottom-left, auto-dismiss in 5s except errors. Uses the same verb as the action: "Case saved". |
| **Empty state** | One sentence stating what belongs here, one primary action. No illustrations. |
| **Skeleton** | Row-shaped skeletons for tables. No spinners over a table. |

---

## 6. States (required on every screen)

- **Loading:** skeleton rows or panels, never a blank page.
- **Empty:** says what goes here and how to add it. Example: "No cases in this
  section. Add a case or import a CSV."
- **Error:** says what went wrong and what to do next, no apology.
  Example: "Couldn't load runs. Check your connection and retry." with a Retry button.
- **No permission:** explain which role is needed.
- **Offline or saving:** show a small "Saving…" and "Saved" indicator in the page header.
- **Destructive actions:** confirm in a dialog that names the item and the
  consequence ("Delete 3 cases? Their results in 2 runs will be kept as history.").
  Prefer undo over confirmation where the action is reversible.

---

## 7. Interaction and motion

- Motion only answers a user action: drawer slides in (150 ms), tree node
  expands (120 ms), toast appears. No page-load animations, no hover animations
  on rows or cards.
- Respect `prefers-reduced-motion`: replace motion with instant changes.
- Shortcuts (show in a `?` help dialog): `/` search, `g` then `c`/`r`/`p`
  go to cases, runs, plans, `n` new, `Ctrl+Enter` save, `P F B R S` set status
  in a result form, `j`/`k` move between rows, `Esc` close.

---

## 8. Accessibility (the quality floor)

- WCAG 2.2 AA minimum: text contrast 4.5:1, UI contrast 3:1.
- Visible focus ring: 2px `--brand` with 2px offset, on every interactive element.
- Semantic HTML first: real `<table>`, `<button>`, `<nav>`, headings in order.
- All icons that carry meaning have text or `aria-label`. Status never relies
  on colour only.
- Every form control has a label. Errors are linked with `aria-describedby`
  and announced politely.
- Drag and drop always has a keyboard alternative ("Move to…").
- Touch targets at least 32px, 44px on touch devices.

---

## 9. Content and copy

- Sentence case. Plain verbs. Active voice. No exclamation marks.
- Use users' words: "test case", "test run", "result", "milestone". Never
  "entity", "record" or "payload".
- An action keeps one name through the flow: the button "Add result" leads to a
  toast "Result added".
- Dates: relative under 7 days ("2 h ago"), absolute after ("12 Aug 2026"), with
  the full timestamp in a tooltip. Use the user's locale. Confirmed in
  t_5fa1c284 (2026-10-08): this spec stands — all date rendering goes through
  one shared utility (`web/src/lib/dates.ts`), which formats in the user's
  locale and timezone from the ISO 8601 UTC strings the API returns; it must
  not hard-code UTC, and this is the only place `Intl` formatting may live.
- Numbers: thousands separators, percent without decimals except in reports.

---

## 10. Implementation rules (for Iris)

1. Build against the API contract in `/docs/api-*.md`. Never guess response
   shapes. Report mismatches to Daedalus.
2. Stack: Next.js + TypeScript + Tailwind CSS, tokens in `tokens.css`.
   Typed API client generated from or checked against the contract.
3. Build in this order: tokens and shell, then primitives (button, badge, table,
   tree, drawer, form fields), then screens: Projects, Cases, Runs, Run detail,
   Plans, Milestones, Reports, Settings.
4. Every component has: all states from section 6, keyboard support, a
   Storybook story or equivalent page, and a test for its main behaviour.
5. Performance: tables with 1,000+ rows stay smooth (virtualised), route-level
   code splitting, no layout shift when data loads.
6. Before marking a task done, check at 1440, 1024 and 768 widths, keyboard-only,
   and with a screen reader on the run detail screen.
7. Handoff note (required): goal, files changed, assumptions, how to verify,
   open risks, plus screenshots of each state.

## 11. Out of scope for MVP

Custom fields, integrations (Jira, CI), SSO, saved filter views, dark theme UI
(tokens only), and mobile-optimised editing.
