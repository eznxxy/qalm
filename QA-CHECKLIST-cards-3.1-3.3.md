# QA checklist — Qalm slice 2, cards 3.1–3.3 (suites + cases, frontend)

You are Argus for this slice. Read the top section, then work down the
sections and tick boxes. Every item says what to do **and what should happen**;
if reality differs from "Expected", that is a bug — note the item number.

- Reviewer: you
- Scope: suites tree (3.1), two-pane cases screen (3.2), case editor (3.3)
- Not in scope: test plans, runs, milestones, reports (later slices);
  Linked runs tab is an intentional placeholder.

Legend: **★** = highest value, do these first if time is short.
**#** = the number to quote when reporting ("#B7 failed, got X instead").

---

## 0. Getting set up

### 0.1 Stack
| Piece | URL | How to start |
|---|---|---|
| Web | http://localhost:3000 | `cd web && npm run dev` |
| API | http://localhost:3001/api/v1 | `cd server && npm run start:dev` |
| Postgres | localhost:5432 (container `pgsql`) | `docker start pgsql` (needs Docker Desktop running) |

Health check: opening http://localhost:3001/api/v1/health returns
`{"data":{"status":"ok"}}`. The API exits on boot if Postgres is not up — start
Postgres **first**.

### 0.2 Log in
Two accounts already exist; use the passwords you set yourself.

| Account | Password | Role | Use it for |
|---|---|---|---|
| `john@gmail.com` | yours | Admin | everything writable |
| `johnlead@gmail.com` | yours | Lead | same write rights, different role name |
| `tester@qalm.local` | `Passw0rd!dev` | Tester | section D read-only |
| `viewer@qalm.local` | `Passw0rd!dev` | Viewer | section D read-only |

The Tester and Viewer were created by the seed, so section D needs no setup.
All four are already active; the first two keep whatever password you set.

### 0.3 The data is already seeded
A dataset sized for this checklist is already in the dev database. Project
**Webshop QA** (key `WEBSHOP`):

```
Payments ............... 31 cases in the subtree (22 of them direct)
  Checkout ............. 27  (22 direct)   <- default landing suite
    Cards .............. 3   (depth 3)
    Wallets ............ 2   (depth 3)
  Refunds .............. 4
Search ................. 5
Auth ................... 3
  Login ................ 3
  SSO .................. 0   (empty child: exercises the delete tooltip)
Archive ................ 0   (empty root: safe to delete, #A12)
```

- **Active project** →
  http://localhost:3000/cases?project=e0070372-2a30-4a8d-8444-b5e53c996fb2
- **Archived project** "Legacy Mobile" (for #D3) →
  `/cases?project=144b82d6-591e-4e11-8d25-16bdc9196907`
- 39 live cases, numbers `C1`–`C40` with **`C7` deliberately deleted**. The
  allocator sits at 40, so the next case you create must be `C41` (#B15).
- Tag vocabulary in use: `a11y, api, auth, i18n, payments, search, security,
  smoke, ui`.
- The default landing suite is **Payments** (first root), so the list opens on
  page 1 of 2 without you touching a filter (#B4).
- Varied records on purpose: a 190-character title, the maximum estimate
  `10080`, a case with no steps/tags/estimate, a 5-step case, multi-line
  preconditions, an emoji title, and a case with an idle audit trail.
- `C1` carries a 3-row history (created, priority+estimate, tags) so #C5 has
  something real to show.

Nothing here is special-cased in the app: it was inserted with plain SQL and
then read back through the API, so it behaves exactly like data you create in
the UI. Ask me to reset it whenever you like — the script is kept outside the
repo.

Every item below is a **UI end-to-end check**: drive the interface like a user
(click, type, drag, tab, resize) and judge only what you can see. No DevTools,
no request or response inspection, no calling the API directly, no reading the
code.

---

## A. Suites tree (card 3.1)

Left pane, 280px wide, heading "Suites".

- [ ] **#A1 ★ Tree renders the shape you built.** Parents show a ▾/▸ toggle,
      leaves show none, nesting is indented one step per level, and the toggle
      glyphs are large and obvious on every level (not a hairline).
      *Expected:* `Payments › Checkout › Cards` indented 0 / 1 / 2 steps.
- [ ] **#A2 Counts include the whole subtree.** *Expected:* `Payments` shows
      `31` (22 direct + Cards 3 + Wallets 2 + Refunds 4), `Checkout` `27`,
      `Cards` `3`, `Wallets` `2`, `Refunds` `4`, `Search` `5`, `Auth` `3`,
      `Login` `3`, `SSO` `0`, `Archive` `0`; the `All suites` row shows the
      project total `39`.
- [ ] **#A3 Selecting a suite scopes the list.** Click `Checkout`.
      *Expected:* the table lists Checkout's cases plus its two child suites'
      (27 total, 22 of them directly in Checkout), the breadcrumb reads
      `Webshop QA › Payments › Checkout`, and the URL gains `&suite=<id>`.
- [ ] **#A4 `All suites` is unscoped.** Click the `All suites` row.
      *Expected:* all 39 cases, breadcrumb `Webshop QA › All suites`, URL has
      `suite=all`.
- [ ] **#A5 Deep link reveals the selection.** Copy the URL while `Cards` is
      selected, collapse `Payments` and `Checkout`, then reload the URL you
      copied. *Expected:* both parents re-expand so `Cards` is visible and
      highlighted as selected.
- [ ] **#A6 Keyboard: arrows.** Focus a tree row (Tab into the pane, or click
      one), then press ↓ ↑ Home End.
      *Expected:* ↓/↑ move focus one visible row at a time and do not select;
      Home/End jump to the first/last visible row.
- [ ] **#A7 Keyboard: ← →.** On `Payments` press → (expands), → again (focus
      moves to `Checkout`), ← (focus returns to `Payments`), ← again
      (collapses). *Expected:* exactly that; ← on a collapsed child moves to
      its parent.
- [ ] **#A8 Keyboard: Enter selects.** Focus `Search`, press Enter.
      *Expected:* it becomes selected, the table switches to Search's case, the
      URL updates. Space does the same.
- [ ] **#A9 ★ Add suite.** `+ Add suite` (pane header) creates a root suite;
      select a suite and `+ Add child` creates a child under it.
      *Expected:* the new suite appears, its parent expands, the toast says
      `Suite “X” created.`, and the new suite becomes selected.
- [ ] **#A10 Depth cap at 3.** Select `Cards` (depth 3).
      *Expected:* `+ Add child` is **disabled**, tooltip "Suites are limited to
      3 levels". No way to create a 4th level exists.
- [ ] **#A11 Rename.** Select a suite → `Rename` → change the name → Save.
      *Expected:* the tree updates, toast `Suite “X” renamed.`; cancelling
      leaves it untouched; emptying the name shows an inline error and does not
      save.
- [ ] **#A12 ★ Empty-suite delete is allowed, non-empty is blocked.** Select
      a freshly created empty suite → `Delete` → confirm.
      *Expected:* it disappears, toast `Suite “X” deleted.`, the confirm text
      says it is empty and lists nothing at risk.
      Now select `Payments` (has cases + children). *Expected:* `Delete` is
      **disabled**, tooltip "Move or delete its cases first" (or "…child
      suites first" for a suite with only children). A suite whose cases you
      move out first becomes deletable.
- [ ] **#A13 ★ Move to… (keyboard path).** Select `Search` → `Move to…`.
      *Expected:* a destination picker lists suites it may move under; it does
      **not** offer itself or its own descendants; "Top level" is offered.
      Choosing `Payments` moves it, expands Payments, toasts `Suite “Search”
      moved.`, and the URL selection follows the suite.
- [ ] **#A14 Drag and drop.** Hover a suite row first: it shows a grab cursor
      and a `⠿` grip handle on the right (read-only trees show neither). Drag
      `Search` onto the middle of `Payments`. Then drag it to the **top edge**
      of `Checkout`, then to the **bottom edge** of `Cards`. *Expected:*
      dropping on the middle nests it inside; the top/bottom edges reorder it as
      a sibling before/after the target; a visible drop indicator shows which of
      the three will happen; the cursor becomes a closed hand while dragging;
      dropping a suite onto itself or its own descendant is refused (no
      indicator, no change).
- [ ] **#A15 Drag respects depth.** Drag `Payments` (which has a 2-level
      subtree) onto the middle of `Cards` (depth 3). *Expected:* refused — no
      drop indicator, nothing moves. Nothing produces a 4th level.
- [ ] **#A16 Empty project.** With a project that has no suites, the pane says
      "No suites yet. Add a suite to start organising cases." and offers
      `Add suite`. *Expected:* no error message, no "All suites" row.

---

## B. Two-pane cases screen (card 3.2)

Right pane: breadcrumb, `Add case`, filter bar, table, pagination.

- [ ] **#B1 ★ Default suite.** Open `/cases?project=<id>` with no `suite` in
      the URL. *Expected:* the first root suite is selected automatically and
      the URL is rewritten with `suite=<firstRootId>` (not left bare).
- [ ] **#B2 Table columns.** *Expected:* `ID`, `Title`, `Priority`, `Type`,
      `Steps`, `Updated`. IDs look like `C1`, `C2`, … Priority has an icon +
      label. Titles are buttons that open the drawer. The selection column's
      header checkbox lines up with the row checkboxes (same vertical centre),
      and the small tick box has a larger click area around it.
      The `Type` and `Updated` columns are only as wide as their longest value —
      "Functional" and a date like `Oct 17, 2026` each stay on one line, so only
      long *titles* make a row taller. Each header sits over its own values —
      including the two unsortable columns: `Type` starts on the same line as
      "Functional", and `Steps` (numbers, right-aligned) ends on the same line
      as its digits. The header row scrolls away with the rows (it is not
      sticky).
- [ ] **#B3 ★ Sorting.** Click `ID`, then `Title`, then `Updated`, then
      `Priority`, clicking each twice. *Expected:* ascending first, descending
      on the second click, an arrow marks the active column, the URL gains
      `sort=case_number` / `-case_number` / `title` / `-title` / `updated_at` /
      `-updated_at` / `priority` / `-priority`, and the row order really
      changes. `Priority` sorts by severity — most urgent first
      (`critical → low`) — with equal priorities keeping their ID order.
      `Type` and `Steps` are **not** sortable (clicking does nothing) — that is
      intentional.
- [ ] **#B4 Pagination.** The seeded project lands on 31 cases in the Payments
      subtree, so `Page 1 of 2 (31 cases)` should already be visible with
      Previous/Next. *Expected:* page 1 shows 25 rows, page 2 shows 6, Previous
      is disabled on page 1, Next on the last page, the URL carries `page=2`,
      and returning to page 1 shows the same rows again. Hovering a disabled
      Previous/Next explains why ("You are on the first/last page"); hovering an
      enabled one says where it will go.
- [ ] **#B5 ★ Search.** Type `card` in "Search cases".
      *Expected:* the list narrows after a short pause (300 ms), not on every
      keypress; the URL gets `query=card`; the result count next to the filters
      updates and is announced to screen readers. Search is title-only per the
      contract — typing a tag (`smoke`) or a step's text finds nothing, and that
      is correct.
- [ ] **#B6 Priority / Type filters.** Open `Priority`, tick High and Low.
      Then `Type`, tick Functional. *Expected:* both menus show a count badge,
      the list narrows to matching cases, the URL carries
      `priority=high,low` (repeated/CSV, not JSON), and each menu's "Clear
      priority" / "Clear type" empties only that menu.
- [ ] **#B7 ★ Tag filter.** In `Tags`, tick `smoke`. Also type
      `Payments, smoke` in "Add a tag" and press Enter.
      *Expected:* the first filters to smoke-tagged cases; the typed one is
      lowercased and de-duplicated (`payments` and `smoke` only — `Payments`
      must not become a second filter), and the URL carries `tag=…`. Before you
      type, the `Add` button is disabled with a tooltip ("Type a tag first,
      then Add") and enables as soon as there is text.
- [ ] **#B8 ★ Active filter chips.** With a search + priority + tag active.
      *Expected:* a chip per filter (`Search: …`, `Priority: High`, `Tag:
      smoke`), each with an × that removes only that filter, plus `Clear all`
      which removes everything and resets the list.
- [ ] **#B9 No-match state.** Filter to something impossible (`zzzz`).
      *Expected:* "No cases match your filters." + "Try a different search, or
      clear the filters." + a working `Clear filters` button, shown as one
      centred block in the middle of the table area. Not a blank table, not a
      spinner, not left-hugging.
- [ ] **#B10 Empty suite state.** Select an empty suite you created.
      *Expected:* "No cases in <suite>." and, as Admin/Lead, an `Add case`
      button. No pagination.
- [ ] **#B11 ★ Row selection and the bulk bar.** Tick two rows.
      *Expected:* the filter bar is replaced by a bulk bar reading
      `2 selected` with `Move…`, `Delete…`, `Clear selection`. `Clear
      selection` restores the filter bar. The header checkbox selects the
      current page. Hovering `Move…`/`Delete…` says what each will do; where the
      action is disabled, the tooltip says why instead.
- [ ] **#B12 Selection is not sticky.** With 2 rows selected, change the suite
      (or the page, or a filter). *Expected:* the selection is dropped and the
      bulk bar disappears — old ids must never be carried into a bulk action.
- [ ] **#B13 ★ Bulk move.** Select 2 cases → `Move…` → choose another suite →
      `Move cases`. *Expected:* dialog names the count and the destination is a
      **searchable** field defaulting to the current suite (typing narrows the
      tree; a filtered row sits flush left with its ancestor trail such as
      `Cards   Payments › Checkout`). Both cases move, the
      list refreshes, toast `2 cases moved.`, suite counts update. The toast has
      a `×` that dismisses it without undoing the move.
- [ ] **#B14 Bulk delete.** Select 2 cases that you do not need → `Delete…`.
      *Expected:* confirm names the count (`Delete 2 cases?`), the body says
      numbers stay reserved and history is kept. Confirming removes them and
      toasts `2 cases deleted.`; cancelling changes nothing.
- [ ] **#B15 ★ Case numbers stay reserved.** The highest existing number is
      `C40` (and `C7` is already deleted, so the list has a visible gap). Delete
      any live case, then add a new one. *Expected:* the new case becomes
      `C41`, not the number you just freed — numbers are never reused.
- [ ] **#B16 Add case button states.** Not directly reachable with seeded data
      (every project already has suites). Optional: create a throwaway project,
      open its Test cases page, and check `Add case` is disabled with tooltip
      "Add a suite first, then you can add cases to it" and the empty state
      offers `Add suite` instead.
- [ ] **#B17 Project problems.** Open
      `/cases?project=00000000-0000-0000-0000-000000000000`.
      *Expected:* "Project not found" panel with a link back to projects.
      Also open bare `/cases` (no `project`): it should pick the first visible
      project and rewrite the URL instead of showing an empty screen.
      The "No projects yet." state cannot be reached now that the seed exists —
      skip it rather than deleting the only projects.
- [ ] **#B18 ★ Errors are recoverable.** Stop the API (Ctrl+C in its terminal),
      then reload `/cases?project=<id>`. *Expected:* a readable error message
      with a `Retry`, not a blank white page or a spinner that never stops. Start the API
      again and press Retry: the screen recovers without a full page reload.

---

## C. Case drawer and editor (card 3.2b / 3.3)

- [ ] **#C1 ★ Drawer opens and is non-modal.** Click a case title.
      *Expected:* a 480px panel slides in on the right titled
      `C1 · <title>`, the URL gains `&case=<id>`, keyboard focus moves into the
      panel, and the table behind stays clickable (by design — no scrim). Only
      one drawer is ever visible: with a case open, `Add case` replaces it with
      the `New case` form (and `case=` leaves the URL); with the `New case` form
      open, clicking a case title closes the form and opens that case.
- [ ] **#C2 Drawer content.** Details tab shows: title, Priority (icon +
      label), Type, Estimate, Suite, Preconditions, numbered Steps with
      `Expected: …`, Tags, `Created … · Updated …`.
      *Expected:* an empty estimate reads `None`; empty preconditions read
      "No preconditions."; no tags reads "No tags."; no steps reads
      "No steps recorded.".
- [ ] **#C3 ★ Esc closes, focus returns.** Press Esc, and separately click ×.
      *Expected:* the drawer closes, `case=` disappears from the URL, and
      focus lands back on the case title button you opened it from (press
      Enter again: it reopens).
- [ ] **#C4 Drawer deep link.** Copy a URL with `case=`, close the tab, open a
      new one at that URL. *Expected:* the drawer opens on that case with the
      list behind it.
- [ ] **#C5 ★ History tab.** Open a case you have edited, click `History`.
      *Expected:* newest first, one row per change with an action label
      (Created/Updated/…), a timestamp, `by <short actor id>` and readable
      lines like `Title: …` — no raw JSON anywhere. A case never edited shows
      "No history yet.". With 25+ entries, Previous/Next work.
- [ ] **#C6 History reflects real edits.** Edit a case's title, reopen the
      drawer, History. *Expected:* a new entry at the top listing the changed
      field and both values.
- [ ] **#C7 Tabs are keyboard-operable.** Focus a tab and press → ← Home End.
      *Expected:* focus moves between Details/History/Linked runs and the
      panel follows; only one tab is in the Tab order.
- [ ] **#C8 Linked runs is a placeholder.** Click `Linked runs`.
      *Expected:* "No linked runs yet." plus a sentence that runs arrive with a
      later slice. **Not a bug** — do not report it.
- [ ] **#C9 ★ Add case happy path.** `Add case` → fill Title, pick suite, add
      2 steps with expected results, Priority High, Type Functional, tags
      `Smoke, smoke, payments`, estimate `1h 30m` → `Add case`.
      *Expected:* drawer closes, toast `Case C<n> added.`, the row appears in
      the list and the suite count increments. Reopening it shows tags
      `smoke, payments` (lowercased, deduped) and Estimate `1h 30m`.
- [ ] **#C10 Estimate formats.** Save `90` → shows `1h 30m`; save `90m` →
      `1h 30m`; save `2h` → `2h`; save `45` → `45m`; blank → `None`; save
      `abc` → inline error and save does nothing.
- [ ] **#C11 ★ Inline validation.** Submit an empty form.
      *Expected:* `Title is required.` under the field, focus jumps to the
      first invalid field, a step added but left blank shows `Step text is
      required.` on that row, and no new case appears in the list.
      Errors appear on blur or submit — not while you are first typing.
- [ ] **#C12 Step reordering.** With 3 steps, press ↑/↓ and ✕ on each.
      *Expected:* the numbers renumber, ↑ is disabled on the first row, ↓ on
      the last, ✕ removes the right row, and saving persists the new order
      (reopen to confirm). Hovering a disabled ↑/↓ explains why ("This is the
      first/last step"); hovering an enabled one says "Move step up/down".
- [ ] **#C13 ★ Ctrl+Enter saves.** In the editor, press Ctrl+Enter (⌘+Enter on
      macOS). *Expected:* the case saves exactly as clicking the button; the
      hint "Ctrl + Enter saves" is visible at the bottom.
- [ ] **#C14 Edit mode.** Open a case → `Edit case`.
      *Expected:* the same drawer now titled `Edit C<n>`, fields pre-filled
      (tags as `smoke, payments`, estimate as `1h 30m`), button says
      `Save changes`, Cancel returns to Details with no changes saved.
- [ ] **#C15 No-op edit.** `Edit case` → `Save changes` without touching
      anything. *Expected:* "No changes to save.", and after a page reload the
      case still shows exactly the same values.
- [ ] **#C16 Partial edit.** Change only the title. *Expected:* the row updates
      in place, the toast says `Case C<n> saved.`, and reopening the case shows
      priority, type, tags, estimate and steps unchanged (History lists only the
      title change).
- [ ] **#C17 ★ Delete from the drawer.** `Delete case` → confirm.
      *Expected:* confirm names `C<n> · <title>` and says the number stays
      reserved, the drawer closes, toast `Case C<n> deleted.`, the row and the
      suite count update.
- [ ] **#C18 Server says no.** With the project archived by another tab (see
      D3) try to save a case. *Expected:* a readable form-level error
      ("…archived…" / "Editing is disabled"), the form stays open with your
      input intact, nothing is lost. After any action the success or error
      banner (above the table) has a `×` on its right that dismisses it.
- [ ] **#C19 ★ Discard confirm on a non-empty New case.** `Add case`, type a
      title, then try to dismiss it four ways: the drawer `×`, `Esc`, the
      form's `Cancel`, and clicking a case row in the table.
      *Expected:* each attempt asks `Discard this new case?`; `Keep editing`
      keeps the form and your text, `Discard` closes it (and, for the clicked
      row, opens that case). Now `Add case` again and dismiss with nothing
      typed — all four ways close it immediately with **no** prompt.
- [ ] **#C20 ★ The Suite field is a searchable tree.** In `Add case`, click the
      `Suite` field. *Expected:* a list drops below the field in tree order
      (`Payments`, `Checkout` indented one step, `Cards`/`Wallets` two, then
      `Refunds`, `Search`, `Auth`, `Login`/`SSO`, `Archive`), with a tick on the
      current suite. Typing `card` narrows it to `Cards`; a filtered row sits
      flush left and carries a muted ancestor trail after the name
      (`Cards   Payments › Checkout`) instead of the indent — the search is on
      the suite **name**, so you never type an indent or the trail. ↓/↑ move
      the highlight and Enter (or a click) picks the row and closes the list;
      typing something with no match shows `No suites match.`.
      **Esc closes only the list** — the drawer stays open and the value is
      unchanged; a second Esc then closes the drawer. Clicking elsewhere on the
      form closes the list without changing the value.

---

## D. Roles and archived projects

Switch users with the avatar menu → Log out. Reuse the Tester and Viewer you
created in 0.2.

- [ ] **#D1 ★ Tester is read-only.** As Tester: *Expected:* no `+ Add suite`,
      no `+ Add child`, no `Rename`, no `Move to…`, no `Delete` in the tree
      footer; no `Add case`; no row checkboxes/bulk bar; drawer shows no
      `Edit case` / `Delete case`; a read-only banner under the heading says
      "Read-only: adding or editing cases needs the Admin or Lead role."
      Browsing, filtering, sorting and opening cases all still work.
- [ ] **#D2 ★ Viewer behaves like Tester.** *Expected:* identical read-only
      behaviour to #D1.
- [ ] **#D3 ★ Archived project is read-only for everyone.** As Admin, open the
      seeded archived project directly:
      `/cases?project=144b82d6-591e-4e11-8d25-16bdc9196907` ("Legacy Mobile",
      already archived). *Expected:* the screen loads, the banner says "This
      project is archived. Cases and suites are read-only." and every write
      control is gone — even though you are Admin. Restoring it from Projects
      brings them back. Also try the same URL as Tester: archived projects are
      Admin-only, so the tester should get the "Project not found" panel.
- [ ] **#D4 Hiding is not security.** As Tester/Viewer, no write control is
      offered anywhere: no Add case, no suite actions, no row checkboxes, no
      Edit/Delete in the drawer. (Backend enforcement is covered by the backend
      e2e suite; it is not re-tested here.)
- [ ] **#D5 Lead can write.** As `johnlead@gmail.com`: *Expected:* every
      Admin write control is present and works.

---

## E. URL-as-state and browser navigation

- [ ] **#E1 ★ Reload keeps everything.** Set suite + search + priority + sort +
      page (and open a case). Copy the URL, reload it in a new tab.
      *Expected:* identical screen: same suite selected, same filters and chips,
      same sort arrow, same page, drawer open on the same case.
- [ ] **#E2 ★ Back/forward.** Apply three filters, then press Back three times
      and Forward three times. *Expected:* each step restores the previous view
      exactly, including the visible text in the search box.
- [ ] **#E3 Changing a filter resets the page.** Go to page 2, then change a
      filter. *Expected:* you land back on page 1 (a stale `page=2` must not
      show an empty page).
- [ ] **#E4 Selecting a suite closes the drawer.** With a drawer open, click a
      different suite. *Expected:* the drawer closes and `case=` is removed.
- [ ] **#E5 Shareable URL.** Paste the copied URL into a private window and log
      in as Lead. *Expected:* same view (permissions permitting).

---

## F. Polish pass (5 minutes, easy to spot regressions)

- [ ] **#F1 Narrow viewport.** Resize to ~700px wide, then ~400px.
      *Expected:* below ~768px the panes stack and the drawer goes full width;
      nothing overlaps or gets clipped horizontally. (Known design bet — note
      anything ugly, don't treat "it stacks" as a bug.)
- [ ] **#F2 Reduced motion.** Turn on the OS "reduce motion" setting.
      *Expected:* the drawer still opens/closes, just without the slide.
- [ ] **#F3 Zoom 200%.** Ctrl+ (×2). *Expected:* no horizontal scrolling of the
      page itself, text remains readable, buttons stay clickable.
- [ ] **#F4 ★ Button label contrast on hover.** Hover (do not click) every kind
      of button: a blue filled one (`Add case`, `Save changes`), a red one
      (`Delete…` with rows ticked), and plain ones (`Next`, `Cancel`, the `×`
      on a banner). *Expected:* the label stays as readable on hover as at
      rest — light text on the blue/red fills, dark text on the plain ones. A
      near-black label on the dark fill is exactly the bug this guards against.
- [ ] **#F5 ★ One filter menu open at a time.** In the cases filter bar, open
      `Priority`, then `Type`, then `Tags`. *Expected:* opening one closes the
      previous, so only the open menu ever shows the blue accent border — never
      two at once. Clicking the open menu's own summary closes it.

---

## G. Things that are known and are NOT bugs

1. **Linked runs is a placeholder.** Runs are a later slice with no contract yet.
2. **The drawer is non-modal** — no dimmed backdrop, no focus trap; you *can*
   Tab out to the table behind it on purpose. Reported as a risk for design
   sign-off, not as a defect.
3. **Drawing/dropping "somewhere" is not supported** — only before/inside/after
   a row. There is no drag-to-scroll or drag into a collapsed parent.
4. **`Type` and `Steps` sorting do not exist** in the list (the contract allows
   `case_number`, `title`, `priority`, `updated_at`). `Priority` sorts by
   severity (`critical → low`), not alphabetically.
5. **Sidebar → Settings returns 404.** Pre-existing from an earlier slice: the
   nav item exists, the route was never built. Do not file it against 3.1–3.3.
6. **Seed/data**: the dev DB is shared and additive; if the numbers differ from
   this checklist's examples, that's fine — the *behaviour* is what matters.

---

## H. Reporting

For each failure, quote the checklist id and paste this into a comment:

```
#<id> — <one-line summary>
Steps: 1) … 2) … 3) …
Expected: <what the checklist said>
Actual: <what happened, incl. a screenshot if it helps>
Severity: blocker | major | minor | cosmetic
URL: <full URL where it happened>
Role: admin | lead | tester | viewer
```

Severity guide — **blocker**: cannot create/edit/delete at all, data loss,
crash/white screen. **major**: a listed behaviour is wrong but a workaround
exists (wrong move destination, filters not applied). **minor**: keyboard/state
roughness, confusing copy. **cosmetic**: spacing, wording, alignment.

Then hand the list back; fixes are Iris's, and the definition of done says
nothing gets marked verified until it was actually re-run.
