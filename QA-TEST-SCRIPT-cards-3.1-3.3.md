# Test script — Qalm slice 2, cards 3.1–3.3 (suites, case list, case editor)

Companion to `QA-CHECKLIST-cards-3.1-3.3.md`.
The checklist says *what* must be true. This script says *exactly what to do*
and *what to see*, step by step, so a failure can be reproduced without asking
anyone.

- **Build under test:** `master` @ `fbaf9f5` (22 commits ahead of `origin`,
  not pushed). `f403bf7` adds the six UI fixes, `49c01f0` the table-style
  fixes (selection-column alignment, Type/Updated widths), `21d501d` +
  `73db19e` the non-sticky header and the single-drawer rule, `85d9468` the
  header/column text alignment, `33470d4` the 20px checkbox inside its 32px
  target, `3bf6880` the hover-contrast fix, `6fe23b5` the New-case discard
  confirm, `0b2ab5d` the one-filter-menu-at-a-time accordion, `f90654d` the
  filter chevron sized to match the suite tree, `4d93a1e` the searchable
  suite combobox, `bbc8188` its flat filtered list with an ancestor trail, and
  `fbaf9f5` that same picker in the bulk "Move cases" dialog,
  all of which this script now covers;
  `fd48adb`/`59cc46a` are the `priority` sort behind them.
- **Tester:** you
- **Date run:** ______________
- **Environment:** dev, `web :3000` → `api :3001` → Postgres `postgres` (container `pgsql`)
- **Scope:** 3.1 suites tree · 3.2 two-pane cases screen · 3.3 case editor
- **Out of scope:** plans, runs, milestones, reports; Linked runs tab is a placeholder

---

## 1. How to run

1. Start the stack: `docker start pgsql`, then `cd server && npm run start:dev`,
   then `cd web && npm run dev`. Wait until http://localhost:3000 answers.
2. Open http://localhost:3000 and log in.
3. Work top to bottom. Each case is independent unless it says otherwise;
   where state matters the preconditions say so.
4. Every case is a **UI end-to-end check**: you drive the interface the way a
   user does — click, type, drag, tab, resize — and judge only what the screen
   shows you. No DevTools, no inspecting requests or responses, no calling the
   API directly, no reading the code. If a user could not see it, it is not
   verified here.
5. Record one status per case in §8: **PASS** · **FAIL** · **BLOCKED** · **SKIP**.
6. On FAIL, capture: the case id, the step number, what you saw and a
   screenshot. Use the template in §9.
7. Estimated time: **60–75 minutes** for all of it, **15 minutes** for the
   smoke set in §7.

## 2. Access

| Account | Password | Role | Used by |
|---|---|---|---|
| `john@gmail.com` | yours | Admin | most cases |
| `johnlead@gmail.com` | yours | Lead | TC-R05 |
| `tester@qalm.local` | `Passw0rd!dev` | Tester | TC-R01, R04 |
| `viewer@qalm.local` | `Passw0rd!dev` | Viewer | TC-R02, R04 |

## 3. Seeded data (do not rebuild it by hand)

**Active project — "Webshop QA"** (key `WEBSHOP`)
http://localhost:3000/cases?project=e0070372-2a30-4a8d-8444-b5e53c996fb2

```
Payments ............... 31 cases in subtree (22 direct)
  Checkout ............. 27  (22 direct)   <- default landing suite
    Cards .............. 3   depth 3
    Wallets ............ 2   depth 3
  Refunds .............. 4
Search ................. 5
Auth ................... 3
  Login ................ 3
  SSO .................. 0   empty child
Archive ................ 0   empty root
```

**Archived project — "Legacy Mobile"** (key `LEGACYMOB`)
`/cases?project=144b82d6-591e-4e11-8d25-16bdc9196907`

Facts you will assert against: 39 live cases numbered `C1`–`C40` with **`C7`
soft-deleted** (so the list has a gap and the allocator is at 40 → the next new
case is `C41`). `C1` has 3 history rows. One case has a 190-character title and
the maximum estimate `10080` minutes (= `168h`). Ask me to reset the data
between runs; ids are stable across resets.

## 4. Notation

- `→` = expected result at that step. A case fails if any expected result is
  not observed.
- **Never** mark a case PASS from reading the code. Run it.
- Where copy is quoted, compare it literally; wording differences are FAIL
  (cosmetic) unless they change meaning.

## 5. Traceability

| Card | Test cases |
|---|---|
| 3.1 suites tree | TC-S01 … TC-S21 |
| 3.2 cases screen | TC-L01 … TC-L17 |
| 3.2b case drawer | TC-D01 … TC-D08 |
| 3.3 case editor | TC-E01 … TC-E14 |
| Roles / archived | TC-R01 … TC-R05 |
| URL-as-state | TC-U01 … TC-U05 |
| Accessibility / polish | TC-A01 … TC-A05 |

---

# 6. Test cases

## 6.1 Suites tree (card 3.1)

### TC-S01 · Tree renders the seeded structure with correct indentation
**Checklist:** A1 · **Priority:** Medium · **Type:** Functional
*Pre:* Admin, `/cases?project=<WEBSHOP>`.
1. Look at the left pane. → It has the heading `Suites` and sits left of the
   case table, narrow enough that the table gets the majority of the width.
2. Read top to bottom. → `Payments`, `Checkout` (indented 1 step), `Cards` and
   `Wallets` (indented 2 steps), `Refunds` (1 step), then `Search`, `Auth`,
   `Login` (1 step), `SSO` (1 step), `Archive`.
3. Check the disclosure markers. → `Payments`, `Checkout`, `Auth` show `▾`
   (expanded); leaves (`Refunds`, `Search`, `Archive`, `Cards`, `Wallets`,
   `Login`, `SSO`) show none.
4. Look at the markers' size. → The `▾`/`▸` glyphs are large enough to notice
   at a glance (roughly the size of the row text), on every nesting level —
   not a hairline that you have to hunt for.
5. Click the `▾` next to `Payments`. → It becomes `▸` and its three children
   (`Checkout`, `Refunds`) disappear from view. Click again → they return.

### TC-S02 · Counts include the whole subtree
**Checklist:** A2 · **Priority:** High · **Type:** Functional
*Pre:* all suites expanded.
1. Read the number on the right of `Payments`. → `31`.
2. `Checkout`. → `27`. 3. `Cards` → `3`. 4. `Wallets` → `2`. 5. `Refunds` → `4`.
6. `Search` → `5`. 7. `Auth` → `3`. 8. `Login` → `3`. 9. `SSO` → `0`.
10. `Archive` → `0`. 11. The `All suites` row. → `39`.
12. Cross-check: 22 + 3 + 2 + 4 = 31 for Payments, and 31 + 5 + 3 = 39.

### TC-S03 · Selecting a suite scopes the list and the breadcrumb
**Checklist:** A3 · **Priority:** High · **Type:** Functional
1. Click `Checkout`. → The row is visibly highlighted, the URL gains
   `&suite=<checkout id>`, and the list shows 27 cases.
2. Read the breadcrumb under the heading `Test cases`. →
   `Webshop QA › Payments › Checkout`.
3. Click `Cards`. → Breadcrumb `Webshop QA › Payments › Checkout › Cards`,
   exactly 3 cases, URL suite id changes.
4. Click `Payments`. → 31 cases (its own 22 + Checkout subtree 7 + Refunds 4).

### TC-S04 · "All suites" is unscoped
**Checklist:** A4 · **Priority:** Medium
1. Click the `All suites` row. → The row is visibly active; breadcrumb
   `Webshop QA › All suites`; URL has `suite=all`; the list shows 39 cases in
   the filter count.
2. Select any real suite, then `All suites` again. → Selection and list move
   back and forth without a page reload.

### TC-S05 · A deep link reveals a collapsed selection
**Checklist:** A5 · **Priority:** High
*Pre:* the URL currently selects `Cards`.
1. Copy the URL. Collapse `Checkout`, then `Payments`. → `Cards` is no longer
   visible.
2. Paste the copied URL into the address bar and press Enter. → The page
   reloads; `Payments` and `Checkout` are expanded again and `Cards` is
   highlighted; the list shows its 3 cases.

### TC-S06 · ↑/↓/Home/End move focus without selecting
**Checklist:** A6 · **Priority:** High · **Type:** Accessibility
*Pre:* all expanded, one tree row focused (click a row, then press Tab away and
Shift+Tab back so focus is on the row itself).
1. Press ↓ three times. → Focus moves down one visible row each time:
   `Payments → Checkout → Cards → Wallets`.
2. Press ↑ once. → Focus returns to `Cards`.
3. Press End. → Focus jumps to the last visible row (`Archive`).
4. Press Home. → Focus jumps to `Payments`.
5. After all of the above, check which suite the table is showing. → Unchanged
   from before the focus moves — arrows must not select.

### TC-S07 · ←/→ expand, collapse, enter and climb
**Checklist:** A7 · **Priority:** High · **Type:** Accessibility
*Pre:* focus on `Payments`, everything collapsed.
1. Press →. → `Payments` expands (children visible), focus stays on `Payments`.
2. Press → again. → Focus moves to its first child, `Checkout`.
3. Press ←. → Focus returns to `Payments` (row did not collapse because focus
   had left it).
4. Press ← again. → `Payments` collapses.
5. On a collapsed leaf (`Archive`), press ←. → Nothing happens (no error, no
   crash).

### TC-S08 · Enter and Space select the focused suite
**Checklist:** A8 · **Priority:** High · **Type:** Accessibility
1. Focus `Search` with the arrow keys. Press Enter. → `Search` is selected,
   highlighted, the list shows its 5 cases, breadcrumb ends in `Search`.
2. Focus `Auth`, press Space. → `Auth` becomes selected, 3 cases, breadcrumb
   `Webshop QA › Auth`.

### TC-S09 · Create a root suite
**Checklist:** A9 · **Priority:** High
1. Click `+ Add suite` in the pane header. → A dialog appears with a name field
   focused and a description field.
2. Enter `ZZ Smoke Root` + description `created by TC-S09`, press the submit
   button. → Dialog closes; notice `Suite “ZZ Smoke Root” created.`; the suite
   appears at the bottom of the tree; it becomes the selected suite; the URL
   carries its id; the list area says "No cases in ZZ Smoke Root." with an
   `Add case` button.
3. Submit again with the same name (new suite, same name at root level). →
   Inline error about the name already existing; nothing is created.

### TC-S10 · Create a child suite and auto-expand its parent
**Checklist:** A9 · **Priority:** High
1. Select `Auth` (collapsed). Click `+ Add child`. → The dialog names the parent
   (`Auth`).
2. Enter `ZZ Child` and submit. → `Auth` expands, `ZZ Child` appears under it at
   the same indent level as `Login`/`SSO`, it becomes selected, notice
   `Suite “ZZ Child” created.`
3. Check `Auth`'s count. → Still `3` (new suite has no cases).

### TC-S11 · Depth is capped at three levels
**Checklist:** A10 · **Priority:** High
1. Select `Cards` (depth 3). → `+ Add child` is **disabled**; hovering shows
   "Suites are limited to 3 levels".
2. Select `Checkout` (depth 2). → `+ Add child` is enabled.
3. Try to reach a 4th level by other means (create under `Cards` via the tree
   footer, drag something under `Cards`). → No path produces a level-4 suite.

### TC-S12 · Rename a suite
**Checklist:** A11 · **Priority:** Medium
1. Select `ZZ Child`. Click `Rename`. → Dialog pre-filled with `ZZ Child`.
2. Change it to `ZZ Child Renamed`, submit. → Tree updates; notice
   `Suite “ZZ Child Renamed” renamed.`; selection stays on it.
3. Open `Rename` again and press Cancel. → The dialog closes, the tree still
   shows `ZZ Child Renamed` and no notice appears.

### TC-S13 · Rename rejects an empty or duplicate name
**Checklist:** A11 · **Priority:** Medium
1. Select `ZZ Child Renamed` → `Rename` → clear the name → submit. → Inline
   error under the field and the dialog stays open; press Cancel and the tree
   still shows `ZZ Child Renamed`.
2. Type `Login` (an existing sibling under `Auth`) and submit. → Inline error
   about uniqueness; dialog stays open.

### TC-S14 · Delete an empty suite
**Checklist:** A12 · **Priority:** High
1. Select `ZZ Child Renamed` (no cases, no children) → `Delete`. → Confirm
   dialog `Delete suite?` naming the suite and saying it is empty; primary
   button `Delete suite`.
2. Confirm. → Dialog closes; notice `Suite “ZZ Child Renamed” deleted.`; the
   row disappears; if it was selected, the selection falls back sensibly and
   the URL drops `suite=` or moves to a valid one.
3. Repeat for a root: create `ZZ Root 2`, then delete it. → Same behaviour.

### TC-S15 · Delete is blocked when the suite is not empty
**Checklist:** A12 · **Priority:** High
1. Select `Payments` (31 cases). → `Delete` is disabled; tooltip
   "Move or delete its cases first".
2. Select `Auth` (no cases, but has children). → `Delete` is disabled; tooltip
   "Delete or move its child suites first".
3. Select a suite that has cases but no children (e.g. `Refunds`). → `Delete`
   disabled with the cases tooltip.
4. Try the disabled `Delete` anyway (click it, then focus it and press Enter).
   → Nothing happens: no dialog, no notice, the tree and the list are exactly
   as before.
5. Make a suite empty (move its cases out — TC-L14, or delete them), select it
   again. → `Delete` becomes enabled; deleting works.

### TC-S16 · "Move to…" moves a suite via the keyboard-friendly dialog
**Checklist:** A13 · **Priority:** High
1. Create a throwaway root `ZZ Move Me`. Select it → `Move to…`. →
   Destination picker opens with a list of allowed parents plus a top-level
   option.
2. Read the options in the dialog. → It does **not** offer `ZZ Move Me` itself.
3. Confirm `Payments`. → Notice `Suite “ZZ Move Me” moved.`; it now appears
   under `Payments` (as its last child), `Payments` is expanded, counts
   unchanged (0 cases).
4. Now select `Payments` → `Move to…` and read the list. → Its own descendants
   (`Checkout`, `Cards`, `Wallets`, `Refunds`) must **not** be offered.
5. Cancel the dialog. → Nothing moves.

### TC-S17 · Drag a suite inside another (drop on the middle)
**Checklist:** A14 · **Priority:** High · **Type:** Interaction
1. Hover over any suite row. → The row shows a move/grab cursor and a grip
   handle (`⠿`) at its right edge: the tree says, before you try, that rows can
   be dragged. A read-only tree (Tester/Viewer, archived project) shows neither.
2. Drag `ZZ Move Me` (currently under `Payments`) and hover over the **middle**
   of the `Search` row. → A drop indicator shows `Search` will receive it
   *inside*.
3. Drop. → Notice `Suite “ZZ Move Me” moved.`; it becomes a child of `Search`,
   indented one level deeper; `Search` expands.

### TC-S18 · Drop on a row edge reorders as a sibling
**Checklist:** A14 · **Priority:** High · **Type:** Interaction
1. Drag `ZZ Move Me` onto the **top edge** of `Auth`. → Indicator shows it will
   land *before* `Auth`.
2. Drop. → It becomes a root-level suite positioned immediately above `Auth`.
3. Drag it onto the **bottom edge** of `Search`. → Indicator shows *after*.
4. Drop. → It becomes a root-level suite immediately after `Search`.
5. During each drag, the row being dragged is visually marked and the cursor
   switches from the grab hand to a closed/grabbing hand until you drop.

### TC-S19 · Drag cannot create a fourth level
**Checklist:** A15 · **Priority:** High · **Type:** Interaction
1. Drag `Payments` (contains 2 levels below it) onto the **middle** of `Cards`
   (depth 3). → No drop indicator appears and the drop is refused.
2. Release. → Nothing moves; no error toast; the tree is unchanged.
3. Drag `Refunds` (leaf) onto the middle of `Cards`. → Refused too (Refunds >
   1 level would exceed 3).

### TC-S20 · Drag onto itself or its own descendant is refused
**Checklist:** A15 · **Priority:** High · **Type:** Interaction
1. Drag `Payments` onto its own row. → No indicator, no move.
2. Drag `Payments` onto `Checkout` (its child). → No indicator, no move.
3. Drag `Checkout` onto its own child `Cards`. → No indicator, no move.

### TC-S21 · Empty suites state
**Checklist:** A16 · **Priority:** Medium
*Pre:* a project with no suites. Use the throwaway project you create in
TC-L17 (or create one: Projects → New project → Test cases).
1. Open its Test cases page. → Left pane says "No suites yet. Add a suite to
   start organising cases." with an `Add suite` button; there is no `All suites`
   row; the right pane has no rows and no error message. Hover `Add case` → it
   is disabled and a tooltip explains "Add a suite first, then you can add
   cases to it".
2. Click `Add suite`, create one. → The empty state is replaced by the tree (plus
   `All suites`), the suite is selected, and the right pane shows
   "No cases in <suite>."

---

## 6.2 Cases screen (card 3.2)

### TC-L01 · Default suite is chosen and written to the URL
**Checklist:** B1 · **Priority:** High
*Pre:* logged in as Admin.
1. Open `/cases?project=<WEBSHOP>` with no `suite` parameter. → Within a moment
   the URL gains `&suite=<payments id>` and `Payments` is highlighted.
2. Reload. → Same result (no flicker of "All suites", no error).

### TC-L02 · Table columns and formatting
**Checklist:** B2 · **Priority:** Medium
1. Read the header row. → `ID`, `Title`, `Priority`, `Type`, `Steps`,
   `Updated`, then a selection column.
2. Read a row (e.g. `C1`). → `C1` in monospace; the title is clickable; priority
   shows an icon + label ("Critical"); type reads "Functional"; steps is a
   number; updated is a relative time ("2 days ago") and hovering it shows the
   full timestamp.
3. Compare the selection column: the header checkbox and every row checkbox. →
   They sit on one vertical line — the header box is centred over the row boxes,
   not shifted left of them. Ticking any one box shows the tick inside the same
   square of the column. The drawn box is small (~20px) but the click area around
   it is bigger (~32px): clicking just outside the box still ticks it.
4. Look at the `Type` and `Updated` columns. → Each is only as wide as the
   longest value it holds: `Type` shows "Functional" on a single line and
   `Updated` shows, e.g., "Oct 17, 2026" on a single line. No value wraps onto a
   second line, so the rows are evenly tall (a row is only taller when its
   *title* is long enough to wrap).
5. Compare each header with the values under it, especially the two columns you
   cannot sort (`Type` and `Steps`). → The header text starts on the same
   vertical line as the values: `Type` sits exactly over "Functional", and
   `Steps` (a right-aligned number column) ends on the same line as its numbers.
   No header is nudged left or right of its own column.
6. Scroll the case list. → The header row scrolls away with the rows; it is not
   pinned to the top of the table.

### TC-L03 · Sorting by ID
**Checklist:** B3 · **Priority:** High
1. Click the `ID` header. → Rows sort ascending; an arrow marks `ID`; URL has
   `sort=case_number`; the first row is `C1`.
2. Click `ID` again. → Descending; URL `sort=-case_number`; first row is `C40`
   (the highest live number — you may see `C39` if you deleted cases in earlier
   tests; what matters is descending order).
3. Confirm `C7` is absent from both orders. → Yes (deleted).

### TC-L04 · Title, Updated and Priority sorting; other columns do nothing
**Checklist:** B3 · **Priority:** Medium
1. Click `Title`. → Ascending alphabetical; URL `sort=title`; ascending arrow.
2. Click `Title` again. → Descending; URL `sort=-title`.
3. Click `Updated`. → Sorts by last change; URL `sort=updated_at`.
4. Click `Priority`. → Sorts by severity, most urgent first: `Critical`, then
   `High`, `Medium`, `Low` (URL `sort=priority`). Click again → the reverse
   order (`Low` first, URL `sort=-priority`). Cases with the same priority keep
   their ID order, so the list is stable.
5. Click `Type`, `Steps`. → Nothing happens: no sort arrow, no URL change, and
   the rows stay in the same order. (Only `ID`, `Title`, `Priority` and
   `Updated` are sortable.)
6. Reload with `sort=-title` in the URL. → The arrow and the order match.

### TC-L05 · Pagination
**Checklist:** B4 · **Priority:** High
*Pre:* `Payments` selected (31 cases).
1. Look under the table. → `Page 1 of 2 (31 cases)` with Previous/Next.
2. Hover `Previous`. → It is disabled and a tooltip says "You are on the first
   page". Click Next. → 6 rows, `Page 2 of 2`, URL `page=2`, Previous enabled,
   Next disabled; hovering `Next` now says "You are on the last page".
3. Go back to page 1. → Same 25 rows as before, in the same order.
4. Switch to `All suites` (39 cases). → `Page 1 of 2 (39 cases)`, 25 + 14 rows.

### TC-L06 · Search is debounced and written to the URL
**Checklist:** B5 · **Priority:** High
1. In "Search cases", type `card` one letter at a time, pausing ~150 ms between
   keys. → The list does not change on every keystroke; it settles once, a
   moment (~300 ms) after you stop typing, and then shows the matching rows.
2. Read the result. → Count next to the filters shows the narrowed total
   (4 in the whole project; fewer inside `Payments`), rows match.
3. Read the URL. → `query=card`; a chip `Search: card` appears.
4. Type a tag instead (`smoke`). → No results, and that is correct: search
   matches titles only.
5. Clear the box. → The full list returns and `query` leaves the URL.

### TC-L07 · Priority and Type filters
**Checklist:** B6 · **Priority:** High
1. Open the `Priority` menu, tick `High` and `Low`. → Menu summary shows a count
   badge `2`; the list narrows; URL carries `priority=high,low`; two chips
   appear.
2. Open `Type`, tick `Functional`. → Badge `1`; list narrows further (AND across
   filter kinds); URL carries `type=functional`.
3. In the Priority menu click "Clear priority". → Only the priority filter is
   removed; the type filter and its chip remain.
4. Do the same with "Clear type". → Both gone, list restored, URL clean.

### TC-L08 · Tag filter normalises what you type
**Checklist:** B7 · **Priority:** High
1. Open `Tags`. → Tags present on the current page are listed as checkboxes.
2. Tick `smoke`. → List narrows to 5 smoke-tagged cases (whole project; fewer
   inside `Payments`); URL has `tag=smoke`; chip `Tag: smoke`.
3. Look at the "Add a tag" box before typing. → Its `Add` button is disabled and
   a tooltip says "Type a tag first, then Add"; once you type a tag the button
   becomes enabled.
4. In the "Add a tag" box type `Payments, smoke` and press Enter. → Input
   clears; **two** filters exist, `payments` and `smoke`; no `Payments` chip and
   no duplicate `smoke` chip — the input was lowercased then de-duplicated.
5. Type `zzz-nope` and press Enter. → Filter is added, list shows "No cases
   match your filters." (not an error, not a crash).

### TC-L09 · Active filter chips and "Clear all"
**Checklist:** B8 · **Priority:** High
1. Set: search `card`, priority `High`, tag `smoke`. → Three chips
   (`Search: card`, `Priority: High`, `Tag: smoke`) plus `Clear all`.
2. Click the × on the priority chip. → Only priority is removed; the other two
   and the list stay.
3. Click `Clear all`. → All filters and chips removed, search box emptied, list
   back to 31 cases (Payments), URL has no `query/priority/type/tag`.

### TC-L10 · No-match state offers a way out
**Checklist:** B9 · **Priority:** Medium
1. Search `zzzzzzz`. → "No cases match your filters." + "Try a different
   search, or clear the filters." + a `Clear filters` button, laid out as one
   **centred** block in the middle of the table area (not pinned to the left
   edge). No pagination.
2. Click `Clear filters`. → Filters reset, 31 cases return.

### TC-L11 · Empty-suite state
**Checklist:** B10 · **Priority:** Medium
*Pre:* the `Archive` suite (no cases).
1. Select `Archive`. → "No cases in Archive." and, as Admin, an `Add case`
   button. No pagination, no error.
2. As Tester (switch later or in TC-R01): same message, **no** `Add case`.

### TC-L12 · Row selection and the bulk bar
**Checklist:** B11 · **Priority:** High
1. Tick the checkbox on two rows. → The filter bar is replaced by a bulk bar:
   `2 selected`, `Move…`, `Delete…`, `Clear selection`; the header checkbox is
   indeterminate.
2. Click `Clear selection`. → Checkboxes clear, the filter bar returns.
3. Tick the header checkbox. → All 25 rows on page 1 are selected, bulk bar says
   `25 selected`; nothing from page 2 is selected.
4. Hover `Move…` and `Delete…`. → Each shows a short tooltip saying what it will
   do ("Move the selected cases to another suite" / "Delete the selected
   cases"). In a project with only one suite, `Move…` is disabled and the
   tooltip instead explains why ("Nowhere to move them yet — add another suite
   first").

### TC-L13 · Selection never leaks across a context change
**Checklist:** B12 · **Priority:** High
1. Select 2 rows. → Bulk bar shows `2 selected`.
2. Change the suite (click `Search`). → Selection is dropped; the bulk bar is
   gone and the filter bar is back.
3. Repeat, then change a filter, then the page, then the sort. → Each change
   drops the selection. A bulk action can never act on ids from another view.

### TC-L14 · Bulk move
**Checklist:** B13 · **Priority:** High
1. Select 2 cases in `Checkout` that you are happy to move. → Bulk bar
   `2 selected`.
2. Click `Move…`. → Dialog `Move cases` naming the count. The destination is a
   **searchable** field defaulting to the current suite; typing narrows the
   suite tree, and a filtered row sits flush left with its ancestor trail
   (`Cards   Payments › Checkout`) instead of an indent. A `Move cases` button
   is below.
3. Pick `Refunds` and confirm. → Dialog closes; notice `2 cases moved.`; both
   rows leave the list; `Refunds` count increases by 2 and `Checkout` drops by
   2 in the tree; the selection is cleared.
4. Click the `×` at the right end of the notice. → The notice disappears
   immediately (the move is **not** undone; the tree counts stay updated).
5. Open one of the moved cases. → Details shows `Suite: Refunds`.

### TC-L15 · Bulk delete
**Checklist:** B14 · **Priority:** High
1. Select 2 throwaway cases → `Delete…`. → Confirm `Delete 2 cases?` explaining
   numbers stay reserved and history is kept; button `Delete 2 cases`.
2. Cancel. → Nothing changes.
3. Confirm. → Notice `2 cases deleted.`; rows disappear; tree counts drop; the
   pagination total drops by 2. The notice has a `×` on its right; clicking it
   dismisses the notice without undoing the deletion.
4. For a single row: confirm title is `Delete 1 case?` and button `Delete case`.
5. Optional error path (reuses the API-down trick from the checklist's error
   item): stop the API, select a case and `Delete…` → confirm. → A red error
   banner appears above the table; it too carries a `×` that dismisses it.
   Start the API again when done.

### TC-L16 · Case numbers are never reused
**Checklist:** B15 · **Priority:** High
1. Note the highest number in the project (`C40` on fresh data).
2. Delete a live case with a lower number (e.g. whichever you deleted in
   TC-L15).
3. Click `Add case`, fill Title, choose `Payments`, submit. → New case is
   numbered with the **counter's next value** (`C41`), not the freed number.
4. Check the list. → The gap left by the deleted number is still there.

### TC-L17 · Project problems are stated, not swallowed
**Checklist:** B17 · **Priority:** Medium
1. Open `/cases?project=00000000-0000-0000-0000-000000000000`. → "Project not
   found" panel + "Back to projects" link; no crash, no endless spinner.
2. Open bare `/cases`. → It resolves the first visible project and rewrites the
   URL with `project=`.
3. Open `/cases` in a fresh private window while logged out. → Redirected to
   `/login?next=%2Fcases`, and after logging in you land back on the cases page.

---

## 6.3 Case drawer (card 3.2b)

### TC-D01 · The drawer opens over the table and is intentionally non-modal
**Checklist:** C1 · **Priority:** High
1. Click the title of `C1`. → A ~480px panel slides in from the right, title
   `C1 · Guest can complete checkout with a saved card`; URL gains `&case=<id>`.
2. Click a different case's title behind the panel. → That case loads in the
   same panel (this is deliberate: there is no backdrop and no focus trap).
3. Confirm there is no dimming overlay. → Correct by design.
4. With a case drawer open, click `Add case`. → The `New case` form replaces it
   (the case drawer closes and `case=` leaves the URL). Then click a case title
   behind the `New case` form. → The form closes and that case's drawer opens.
   The two panels never stack — only one drawer is visible at a time.

### TC-D02 · Details tab content and empty-field fallbacks
**Checklist:** C2 · **Priority:** High
1. With `C1` open, read the Details tab. → Title, `Priority: Critical` (with
   icon), `Type: Functional`, `Estimate: 1h 30m`, `Suite: Checkout`,
   preconditions text, 4 numbered steps each with `Expected: …`, tags
   `smoke payments ui`, and `Created … · Updated …`.
2. Open the case with the maximum estimate (the long-titled `C14`). →
   `Estimate: 168h`.
3. Open a case with no estimate/tags (create one in TC-E02 if needed). → The
   fields read `None` / `No tags.`; empty preconditions read
   "No preconditions."; a case with no steps would read "No steps recorded."

### TC-D03 · Esc closes and focus returns to the opener
**Checklist:** C3 · **Priority:** High · **Type:** Accessibility
1. Click the title of `C3` to open the drawer, note which row you clicked.
2. Press Esc. → Drawer closes; `case=` leaves the URL; focus lands back on the
   `C3` title button.
3. Press Enter immediately. → The drawer reopens on `C3`.
4. Press the panel's × button instead. → Same closing behaviour, focus returns
   to the opener.

### TC-D04 · Deep link opens the drawer
**Checklist:** C4 · **Priority:** Medium
1. Copy a URL containing `case=`; open it in a new tab. → The drawer opens on
   that case, list behind it, correct suite selected.
2. Change the case id in the URL to a non-existent UUID and reload. → Panel
   shows "Case not found. It may have been deleted." with a `Close` button, not
   a crash.

### TC-D05 · History tab
**Checklist:** C5 · **Priority:** High
1. Open `C1`, click `History`. → Newest first, 3 rows: Updated, Updated,
   Created. Each row shows the action label, a timestamp, `by <8-char id>` and
   readable change lines (`Priority: high → critical`,
   `Estimate: 60 min → 90 min`, `Tags: smoke, payments → smoke, payments, ui`).
   No raw JSON anywhere.
2. Open a case you have never edited. → "No history yet."
3. Open a case you edited during this run. → The new `Updated` row is on top.

### TC-D06 · History records your own edit
**Checklist:** C6 · **Priority:** Medium
1. Open a case → `Edit case` → change the title and the priority → save.
2. Reopen `History`. → A new entry at the top listing both fields with
   `from → to`, timestamped now, attributed to your user id.

### TC-D07 · Tabs are operable by keyboard
**Checklist:** C7 · **Priority:** Medium · **Type:** Accessibility
1. Focus the `Details` tab and press →. → Focus and selection move to
   `History`, panel changes.
2. Press → again. → `Linked runs`. Press →. → Wraps to `Details`.
3. Press End / Home. → Last / first tab.
4. Press ← / → several times, then Tab. → Only the selected tab is in the Tab
   order (one stop, not three).

### TC-D08 · Linked runs is an honest placeholder
**Checklist:** C8 · **Priority:** Low
1. Click `Linked runs`. → "No linked runs yet." + a sentence that runs arrive
   with a later slice. No fake data, no error. *(Expected — not a defect.)*

---

## 6.4 Case editor (card 3.3)

### TC-E01 · Create a case with every field filled
**Checklist:** C9 · **Priority:** High
*Pre:* `Checkout` selected.
1. Click `Add case`. → Drawer `New case` with the editor; Suite pre-selected to
   `Checkout`; labels `Title`, `Suite`, `Preconditions`, `Steps`, `Priority`,
   `Type`, `Tags`, `Estimate`.
2. Fill: Title `TC-E01 payment happy path`; Preconditions `A saved card exists`;
   add 2 steps with expected results; Priority `High`; Type `Smoke`;
   Tags `Smoke, smoke, payments`; Estimate `1h 30m`.
3. Press `Add case`. → Drawer closes; notice `Case C<n> added.`; the row appears
   with the right priority/type/steps count; `Checkout` count +1.
4. Reopen it. → Tags read `smoke, payments` (lowercased, de-duplicated) and
   Estimate reads `1h 30m`.

### TC-E02 · A case may have no steps, no tags and no estimate
**Checklist:** C9/C2 · **Priority:** Medium
1. `Add case` → Title only, no steps, no tags, empty estimate → save. → Saved
   successfully (these fields are optional per contract); row appears with
   `Steps 0`.
2. Open its drawer. → "No steps recorded.", "No tags.", `Estimate: None`.

### TC-E03 · Estimate accepts the documented formats
**Checklist:** C10 · **Priority:** High
*Pre:* one case in edit mode.
1. Set Estimate `90`, save, reopen. → Displays `1h 30m`.
2. `90m` → `1h 30m`. 3. `2h` → `2h`. 4. `45` → `45m`.
5. `10080` → `168h` (the maximum).
6. `10081` → inline error "Estimate must be at most 10,080 minutes." and
   pressing save does nothing (the drawer stays in edit mode).
7. `abc` → inline error 'Enter minutes ("90") or hours and minutes ("1h 30m").'
   with the same result on save.
8. Blank → saves as no estimate (`None`).

### TC-E04 · Required fields are validated on submit, with focus moving to the first
**Checklist:** C11 · **Priority:** High
1. `Add case` on an empty form (with a suite chosen) → press `Add case`. →
   `Title is required.` under Title; focus is in the Title field; the drawer
   stays open and no new row appears in the list.
2. Type a title, add a step but leave the step text empty, submit. →
   `Step text is required.` on that row; focus moves to that step's text area.
3. Fix it, submit. → Saves.

### TC-E05 · Errors appear on blur or submit, not while typing
**Checklist:** C11 · **Priority:** Medium
1. In a fresh form, click into Title and type two characters, then tab away. →
   No error while the field is valid; an error only appears once the field is
   invalid and blurred.
2. Type a 201-character title. → `Title must be at most 200 characters.` after
   blur/submit; the input itself caps at 200 characters (`maxlength`).

### TC-E06 · Step reordering and removal
**Checklist:** C12 · **Priority:** High
1. Add 3 steps with distinct text (`one`, `two`, `three`). → Rows numbered 1, 2,
   3; ↑ disabled on row 1; ↓ disabled on row 3. Hover the disabled ↑ on row 1 →
   a tooltip says "This is the first step"; the disabled ↓ on row 3 says "This
   is the last step". Hovering an enabled ↑/↓ says "Move step up/down".
2. Press ↓ on row 1. → Order becomes `two, one, three` and numbering renumbers
   to 1–3.
3. Press ✕ on row 2. → That row is removed, remaining rows renumber, and the
   inputs keep the correct text (no shifting of values between rows).
4. Save, reopen the case. → Steps persist in the new order.

### TC-E07 · Ctrl+Enter saves
**Checklist:** C13 · **Priority:** Medium · **Type:** Accessibility
1. In the editor, make a valid change and press Ctrl+Enter (⌘+Enter on macOS).
   → Saves exactly as the button would; notice appears; drawer shows the
   updated case.
2. Press Ctrl+Enter with an invalid form. → Validation blocks, same as the
   button.
3. Read the footer. → The hint "Ctrl + Enter saves" is visible.

### TC-E08 · Edit mode is pre-filled and Cancel discards
**Checklist:** C14 · **Priority:** High
1. Open a case → `Edit case`. → Panel title `Edit C<n>`; every field prefilled
   (tags as `smoke, payments`; estimate as `1h 30m`); primary button
   `Save changes`.
2. Change the title and press `Cancel`. → Back to Details with the **old**
   title, and the row in the table still shows the old title. Reopen
   `Edit case`: the field shows the old title again — the cancelled edit was
   not kept.

### TC-E09 · A no-op edit writes nothing
**Checklist:** C15 · **Priority:** High
1. `Edit case` → `Save changes` with no changes. → Message "No changes to
   save.", the drawer stays on the form and the Details tab still shows the
   same values. Reload the page and open the case again → still exactly the
   same values.
2. Change something and change it back, then save. → The same message, and
   again nothing differs after a reload.

### TC-E10 · A partial edit changes only what you edited
**Checklist:** C16 · **Priority:** High
1. Open a case and note its details: priority, type, tags, estimate, steps and
   history length.
2. `Edit case` → change only the Title → `Save changes`. → Notice
   `Case C<n> saved.`; the row's title updates in place; suite counts and the
   case number stay the same.
3. Reopen the case and switch to `History`. → The new `Updated` entry lists the
   title change only — priority, type, tags, estimate and steps are untouched
   and identical to step 1.

### TC-E11 · Delete from the drawer
**Checklist:** C17 · **Priority:** High
1. Open a throwaway case → `Delete case`. → Confirm `Delete case?` naming
   `C<n> · <title>` and explaining that the number stays reserved and history is
   kept.
2. Confirm. → Drawer closes, notice `Case C<n> deleted.`, row gone, tree count
   down, `case=` removed from the URL.
3. Try the same case's URL again. → "Case not found."

### TC-E12 · Saves are refused on an archived project, with your input kept
**Checklist:** C18 · **Priority:** Medium
*Pre:* Admin, archived project "Legacy Mobile" (TC-R03 shows it is read-only).
1. Open a case there. → No `Edit case` button at all (so this case is really
   about defence in depth).
2. Optional, if you want to see the error path: open the same case in the
   active project, start editing it, archive the active project from Projects in
   another tab, then save. → A readable message about the archived project
   appears in the form; nothing you typed is lost.

### TC-E13 · Closing a non-empty New case form asks first
**Checklist:** C19 · **Priority:** High
*Pre:* Admin or Lead (Tester/Viewer never see `Add case`).
1. `Add case`, and type a title. Try each dismissal: the drawer `×`, `Esc`,
   the form's `Cancel`, and clicking a case row in the table.
   → Each shows `Discard this new case?`. `Keep editing` leaves the form open
   with your text intact; `Discard` closes the form (and, for the row you
   clicked, opens that case instead).
2. `Add case` again and dismiss it with nothing typed (the same four ways).
   → It closes immediately, with no prompt.
3. `Add case`, type a title, then type it back to empty and dismiss. → No
   prompt: an emptied form is not "input".

### TC-E14 · The Suite field is a searchable tree
**Checklist:** C20 · **Priority:** High
*Pre:* Admin or Lead; `Payments` selected so the default suite is known.
1. `Add case`. Click the `Suite` field (Tab to it and press ↓ also works). →
   A list drops below the field in tree order: `Payments`, `Checkout` indented
   one step, `Cards`/`Wallets` two, `Refunds`, `Search`, `Auth`,
   `Login`/`SSO`, `Archive`; the current suite carries a tick.
2. Type `card`. → The list narrows to `Cards` alone, now flush left with a
   muted ancestor trail after the name: `Cards   Payments › Checkout`. A
   filtered row drops the indent — it only reads as hierarchy while the
   parents are on screen — and the trail says where the match lives. The
   search is on the suite **name**, so it matches names, not the trail.
3. Press ↓ then Enter (clicking the row works too). → The list closes and the
   field shows `Cards`; the tick has moved. Saving puts the case in `Cards`.
4. Reopen the list and press Esc. → The list closes, the drawer stays open and
   the field keeps its value. Press Esc again. → The drawer closes (with the
   `Discard this new case?` prompt if you have typed anything, per TC-E13).
5. Reopen the list and type `zzz`. → The list reads `No suites match.`;
   pressing Enter does nothing. Esc closes the list.
6. Reopen the list, then click somewhere else on the form. → The list closes
   and the value is unchanged.

---

## 6.5 Roles and archived projects

### TC-R01 · Tester is read-only everywhere
**Checklist:** D1 · **Priority:** High
*Pre:* log out, log in as `tester@qalm.local`.
1. Open the cases screen. → Banner: "Read-only: adding or editing cases needs
   the Admin or Lead role."
2. Look at the suite pane. → No `+ Add suite`, no `+ Add child`, no `Rename`, no
   `Move to…`, no `Delete` (the whole footer is absent).
3. Look at the header. → No `Add case`.
4. Tick rows / try to select. → No checkboxes, no bulk bar.
5. Open a case. → Details render; no `Edit case`, no `Delete case`.
6. Browse: change suite, filter, sort, paginate, open drawer, History tab. →
   Everything read-only works.

### TC-R02 · Viewer behaves like Tester
**Checklist:** D2 · **Priority:** High
*Pre:* log in as `viewer@qalm.local`.
1. Repeat the checks of TC-R01. → Identical: zero write controls, full read
   access.

### TC-R03 · An archived project is read-only even for an Admin
**Checklist:** D3 · **Priority:** High
*Pre:* Admin.
1. Open `/cases?project=144b82d6-591e-4e11-8d25-16bdc9196907`. → Loads; banner
   "This project is archived. Cases and suites are read-only."
2. Look for write controls. → None: no Add case, no suite actions, no row
   checkboxes, no Edit/Delete in the drawer — despite being Admin.
3. Restore the project from Projects and reopen. → The controls come back.

### TC-R04 · Archived projects are invisible to non-Admins
**Checklist:** D3 · **Priority:** Medium
*Pre:* logged in as Tester or Viewer.
1. Open the same archived URL. → "Project not found" panel with the note that
   archived projects are only visible to Admins; `Back to projects` works.
2. Check the Projects list. → The archived project is not listed.

### TC-R05 · Lead has full write access
**Checklist:** D5 · **Priority:** Medium
*Pre:* log in as `johnlead@gmail.com`.
1. Open the cases screen. → No read-only banner; `Add case` present.
2. Create and delete a throwaway suite and case. → Both succeed, same as Admin.

---

## 6.6 URL-as-state and navigation

### TC-U01 · A full state survives a reload
**Checklist:** E1 · **Priority:** High
1. Set: suite `Checkout`, search `card`, priority `High`, sort `-title`, page 2
   if available, and open a case. → Note the exact view.
2. Copy the full URL, open it in a new tab. → Identical view: same suite, same
   filters and chips, same sort arrow and order, same page, drawer open on the
   same case.

### TC-U02 · Back and forward restore each view
**Checklist:** E2 · **Priority:** High
1. Apply three changes in a row (e.g. search `card` → add priority `High` →
   select `Cards`). → Three entries in history.
2. Press Back three times, then Forward three times. → Each step restores the
   previous view exactly, including the text visible in the search box.

### TC-U03 · Changing a filter returns to page 1
**Checklist:** E3 · **Priority:** Medium
1. Go to page 2 of a paginated list.
2. Change any filter or the sort. → You land on page 1 with results (never a
   stale `page=2` showing an empty page).

### TC-U04 · Choosing a suite closes the drawer
**Checklist:** E4 · **Priority:** Medium
1. Open a case's drawer. 2. Click a different suite. → Drawer closes, `case=`
   removed, list scoped to the new suite.

### TC-U05 · A link is shareable
**Checklist:** E5 · **Priority:** Low
1. Copy a URL with suite + filters + sort. 2. Paste it in a private window and
   log in as Lead. → Same view (subject to Lead's permissions).

---

## 6.7 Accessibility and polish

### TC-A01 · Narrow viewport stacks the panes
**Checklist:** F1 · **Priority:** Medium
1. Resize the browser to ~700px wide. → The panes stack: the suite tree sits
   above the table; nothing overlaps or is cut off.
2. Resize to ~400px and open a case. → The drawer takes the full width; the
   content is still readable. ("It stacks" is by design; "it overlaps" is a
   bug.)
3. Scroll horizontally on both widths. → The page itself does not scroll
   sideways.

### TC-A02 · Reduced motion is respected
**Checklist:** F2 · **Priority:** Low
1. Turn on your operating system's "reduce motion" setting.
2. Reload the cases page and open and close a case. → The drawer still opens
   and closes correctly, just without the slide animation.

### TC-A03 · 200% zoom stays usable
**Checklist:** F3 · **Priority:** Medium
1. Press Ctrl/Cmd + twice (200% zoom).
2. Navigate the cases screen and the editor. → Text is readable, controls are
   still clickable, nothing is cut off, and the page does not scroll sideways.

### TC-A04 · Button labels stay readable on hover
**Checklist:** F4 · **Priority:** High
1. On the cases screen, hover (do not click) `Next` (plain), and with rows
   ticked, `Delete…` (red fill). Open `Add case` and hover its submit and
   `Cancel`.
   → The label is as readable on hover as at rest: dark text on the plain
   buttons, light text on the blue and red fills. The fills must **not** turn
   their label near-black when you hover.
2. Repeat on another page (Projects, Users or Settings). → Same.

### TC-A05 · Only one test-case filter menu is open at a time
**Checklist:** F5 · **Priority:** Medium
1. In the cases filter bar, open `Priority`, then `Type`, then `Tags`.
   → Opening each one closes the one before: exactly one menu shows the accent
   (blue) border and its panel, never two at once.
2. Click the open menu's own summary. → It collapses; no menu is open.
3. Set a Priority filter, then open `Type`. → The Priority chip stays applied;
   only which menu is open changed. The menu's ▾ caret is the same size as the
   suite tree's expand/collapse triangles.

---

## 7. Smoke set (15 minutes, if you only have a short window)

Run these in order. If all pass, the slice is broadly healthy; the rest is depth.

| # | Case | Why |
|---|---|---|
| 1 | TC-S02 | Counts are the tree's whole point |
| 2 | TC-S03 | Selection → scoping → breadcrumb → URL |
| 3 | TC-S11 | Depth cap |
| 4 | TC-S14 + TC-S15 | Empty suite deletable, non-empty blocked |
| 5 | TC-S17 | Drag-and-drop, the least unit-tested surface |
| 6 | TC-L05 | Pagination |
| 7 | TC-L08 | Tag normalisation (a real bug was fixed here) |
| 8 | TC-L13 | Selection never leaks into a bulk action |
| 9 | TC-L16 | Numbers stay reserved |
| 10 | TC-D03 | Esc + focus return |
| 11 | TC-E01 | Create path end to end |
| 12 | TC-E09 | No-op edit |
| 13 | TC-E04 | Validation |
| 14 | TC-R01 | Tester read-only |
| 15 | TC-R03 | Archived read-only for Admin |
| 16 | TC-E14 | The suite picker replaced the plain select |

## 8. Results log

Fill one row per case. `Notes` is for the step number and the deviation.

| Case | Status | Notes |
|---|---|---|
| TC-S01 | | |
| TC-S02 | | |
| TC-S03 | | |
| TC-S04 | | |
| TC-S05 | | |
| TC-S06 | | |
| TC-S07 | | |
| TC-S08 | | |
| TC-S09 | | |
| TC-S10 | | |
| TC-S11 | | |
| TC-S12 | | |
| TC-S13 | | |
| TC-S14 | | |
| TC-S15 | | |
| TC-S16 | | |
| TC-S17 | | |
| TC-S18 | | |
| TC-S19 | | |
| TC-S20 | | |
| TC-S21 | | |
| TC-L01 | | |
| TC-L02 | | |
| TC-L03 | | |
| TC-L04 | | |
| TC-L05 | | |
| TC-L06 | | |
| TC-L07 | | |
| TC-L08 | | |
| TC-L09 | | |
| TC-L10 | | |
| TC-L11 | | |
| TC-L12 | | |
| TC-L13 | | |
| TC-L14 | | |
| TC-L15 | | |
| TC-L16 | | |
| TC-L17 | | |
| TC-D01 | | |
| TC-D02 | | |
| TC-D03 | | |
| TC-D04 | | |
| TC-D05 | | |
| TC-D06 | | |
| TC-D07 | | |
| TC-D08 | | |
| TC-E01 | | |
| TC-E02 | | |
| TC-E03 | | |
| TC-E04 | | |
| TC-E05 | | |
| TC-E06 | | |
| TC-E07 | | |
| TC-E08 | | |
| TC-E09 | | |
| TC-E10 | | |
| TC-E11 | | |
| TC-E12 | | |
| TC-E13 | | |
| TC-E14 | | |
| TC-R01 | | |
| TC-R02 | | |
| TC-R03 | | |
| TC-R04 | | |
| TC-R05 | | |
| TC-U01 | | |
| TC-U02 | | |
| TC-U03 | | |
| TC-U04 | | |
| TC-U05 | | |
| TC-A01 | | |
| TC-A02 | | |
| TC-A03 | | |
| TC-A04 | | |
| TC-A05 | | |

**Summary:** ___ / 75 PASS · ___ FAIL · ___ BLOCKED · ___ SKIP

## 9. Reporting a failure

```
TC-<id>, step <n>
What I did:  <the step, verbatim>
Expected:    <the → from the script>
Actual:      <what happened + screenshot>
Where:       <which pane / which suite or case>
URL:         <full URL>
Role:        admin | lead | tester | viewer
Severity:    blocker | major | minor | cosmetic
```

Severity: **blocker** = cannot create/edit/delete at all, data loss, crash.
**major** = a listed behaviour is wrong but there is a workaround.
**minor** = keyboard/state roughness or confusing copy. **cosmetic** = spacing
or wording.

## 10. Known and expected — do not report

1. **Linked runs is a placeholder** (no runs contract yet).
2. **The drawer is non-modal** — no backdrop, no focus trap, the table stays
   clickable (design decision, awaiting sign-off).
3. **Drag only drops before / inside / after a row** — no "drop anywhere".
4. **`Type` and `Steps` are not sortable** — the contract allows `case_number`,
   `title`, `priority` and `updated_at` only. `Priority` sorts by severity
   (`critical → low`), not alphabetically.
5. **Search matches titles only** — tags and step text are not searched.
6. **Sidebar → Settings is 404** — pre-existing, not part of 3.1–3.3.
7. **Archived projects error for non-Admins** — Admin-only visibility by
   contract; "Project not found" is the correct answer for a Tester.
