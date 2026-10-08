# HANDOFF — t_10da9c7a (qalm-design-4b: users + projects tables onto DataTable)

Branch: `feature/t_10da9c7a-datatable-refactor`
Base: merge `b95d530` (= t_328401f8 stack tip + t_62938355 tokens merged in)
Tip: `ec097b6` (6 commits, see below)

## What shipped

Rendering-layer swap of both existing tables onto the DataTable primitive
(`web/src/components/ui/DataTable.tsx`), behaviour unchanged.

Commits:
1. `1feaf47` feat — DataTable additive extension (`rowClassName` prop, `.row-muted`
   rule, loading skeletons in their own `tbody` with `role="status" aria-label="Loading"`)
2. `404b6d6` refactor — `web/src/app/users/page.tsx` on DataTable
3. `2e559d5` refactor — `web/src/app/projects/page.tsx` on DataTable
4. `337d086` chore — deleted the temporary `/design` demo page + its nav link

### Merge integration (why this branch)
The design work was split across two stacked lines sharing master. The DataTable
primitive lives on the t_328401f8 line (datatable → typography → status-badges);
the tokens foundation (t_62938355) is a separate line off master. This card needed
both, so it branches off the status-components tip and merges the tokens line in
(`b95d530`). Three files conflicted — `tokens.css` (took the real tokens file, a
strict superset of the primitive's stub), `layout.tsx` (kept both imports, tokens
before globals), and `globals.css` (13 hunks; resolved as: keep the status line's
§2.4 typography roles + its deletion of the legacy `.badge*` pill CSS, keep the
tokens line's alias layer / textarea / neutral `.form-notice` / `a.button-link`
hover; dropped stale pre-token content that the status line never rebased onto
tokens — its legacy `textarea` dup, `button.danger` raw `#fff`, and `--ok` aliases).
Result: zero hex outside `tokens.css`, `--ok`/`--badge*` fully absent.

## Decisions honoured (per the card)
- Pages keep their own search/filter/pagination state; DataTable is `sort={null}`
  + `selectable={false}` (no sorting/selection columns — parity).
- Captions adapted, not rewritten: `Users, page N of M` / `Projects, page N of M (archived)`
  (the primitive renders them `sr-only`); `aria-label` set on the table element.
- `rowHeight="default"` (36).
- Loading → skeleton rows inside the table (replaces the "Loading …" paragraph),
  `role="status"` semantics preserved via the skeleton `tbody`'s `aria-label="Loading"`.
- Errors → the §6 error row inside the table with a working **Retry**.
  The page also keeps its toolbar `.form-error role="alert"` paragraph so the
  message is announced/visible regardless of table state (the error text itself is
  rendered once, in the table — no double-render). This is the one place the
  "render inside the table" instruction was interpreted to preserve the existing
  role="alert" announcement contract; see Behaviour drift below.

## Parity evidence (real browser, prod build, contract stub API)

Stub: `web/scripts/contract-stub-api.mjs` on :3001, seeded via `/auth/bootstrap`
(ada=admin) + 3 created users (grace=tester, alan=lead, edsger=viewer, deactivated).
After stack :3000, before stack :3100 (worktree at `b95d530`).

/users (admin):
- headers Email·Name·Role·Status·Actions; caption `Users, page 1 of 1`; aria-label `Users`
- `sortButtons=0`, `checkboxes=0` (parity: old table had none)
- badges: Active / Deactivated / temp password all present
- deactivated row class `dt-row row-muted`; computed cell colour `rgb(92,107,130)`
  (--text-muted) vs `rgb(23,32,46)` on active rows
- search "grace" → 1 row; role filter Lead → 1 row; combined → `No users match.`;
  300ms debounce confirmed
- Edit → `form[aria-label="Edit grace@example.com"]`; Reset password → "Share this
  password now" panel + `.secret-value` + row `temp password` badge appear only on
  a successful PATCH (stub 200)
- loading (throttled refetch): skeleton `tbody`, `role=status aria-label="Loading"`,
  15 bars, `aria-busy="true"`
- error (CDP-blocked API): `tbody tr[role=alert]` = "Could not load users. Please try
  again." + Retry; Retry after unblock → row restored, alert gone

/projects (admin):
- active: cols Key·Name·Description·Actions, `.cell-description` present,
  rows show `Edit`+`Archive`
- `#project-status-filter` → `?status=archived`; archived view adds the **Status**
  column (`Archived` badge) and rows show `Edit`+`Restore`; caption suffix `(archived)`
- name search → `?query=…`; search-no-match → `No projects match your search.`
- Archive row button → `[role=alertdialog]` "Archive project?" with "disappear from
  the list" body; Escape closes it (no API call)

Role gates:
- lead: `/users` → Forbidden panel; `/projects` rows show `Archive` only (no Edit),
  no status filter, New project present
- tester: `/users` → Forbidden; `/projects` rows read-only (`Accounts` link only, no
  buttons), no status filter, no New project

Keyboard: tabbing to the users `tbody` and pressing `j`/`j` sets `dt-row-focused`
with the 2px brand bar (`rgb(38,63,160) … inset`).

tsc + eslint + 180/180 unit tests green on both the merge and after each screen
commit (users suite 6/6, projects suite 18/18 unchanged — they assert by role/text,
so the swap is transparent to them).

Screenshots: `shots/t_10da9c7a-{before,after}-{users,projects}-{1440,1024,768}.png`
(before = `b95d530` worktree, after = this tip, same seeded data).

## Behaviour drift

Target was none; the only non-visual-equivalent decisions:

1. **List errors** additionally render a §6 error row *inside* the table (with
   Retry) while the toolbar `.form-error role="alert"` paragraph is kept. Rationale:
   the card says render errors inside the table, but the original page announced via
   `role="alert"` at the toolbar position — dropping it would regress the
   announcement contract. Error text is not duplicated in the DOM. If the intended
   reading is "errors only in the table", delete the `{listError && …}` paragraph in
   each page (2 one-line deletions) — call it and I'll adjust.
2. **`showEmpty`**: the primitive hides the empty state while `error` is set; with
   the toolbar paragraph present the user still sees the error, so this matches the
   old "error paragraph + empty table" composition.

## Notes for downstream (t_a192444c shell card)
- DataTable gained one optional prop (`rowClassName`) and now renders loading
  skeletons in a dedicated `<tbody class="dt-skeleton-tbody" role="status">`; the
  primitive stylesheet gained `.row-muted` and a skeleton-tbody selector group.
- The `.users-table*` CSS in `globals.css` is now dead (no consumer). Left in place
  deliberately: the shell card removes the 60rem `.page` cap and reworks layout;
  if it doesn't reintroduce `.users-table`, delete that block (`.users-table`,
  its `th/td`, `tbody tr:hover`, and the `@media (max-width:640px)` block) in the
  same pass. `projects-table` was only ever a co-selector and is already unused.
- Do not re-add `/design`; the demo page is gone and the nav link removed.

## Verification addendum (run 70, 2026-10-09)

The original run (69) completed the code + committed evidence but timed out before
its final sweep. Run 70 re-verified on a rebuilt stack (fresh stub on :3001 seeded
via bootstrap + 3 created users incl. one deactivated; fresh prod build on :3000):

- Gates re-run on tip `ec097b6`: tsc exit 0, eslint 0 findings, 182/182 unit tests
  (13 suites).
- Live render check (headless Chrome, viewport 1440): /users dt-table with the 5
  parity headers, 4 rows, badges Active ×4 / "temp password" ×3 / Deactivated ×1,
  1 `.row-muted` row, 0 sort buttons / 0 row checkboxes, caption + aria-label.
  Search "grace": rows 4 → 1 with the debounce intact (still 4 at ~150ms, 1 after).
  Role filter Lead → 1 row; reset → 4. /projects: 4 rows Edit+Archive (admin),
  status filter → `?status=archived` adds the Status column + `Archived` badge +
  Restore + caption `(archived)` suffix; `?query=zzz-nonexistent` → "No projects
  match your search."; Archive opens the alertdialog ("Archive project?
  Accounts will be archived…"), Escape closes it with the list unchanged.
- Both screenshots vision-checked (light theme, legible badges, muted deactivated
  row, no clipping/breakage).
- Fresh after-shots per screen (one per the amended screenshot speed mode):
  `shots/t_10da9c7a-final-users-1440.png`, `shots/t_10da9c7a-final-projects-1440.png`.
  The 1440/1024/768 before/after sets from run 69 remain committed for width parity.

### Push status (action needed)
The branch is NOT on the remote: `git push` is gated behind an approval flag
(`QALM_PUSH_APPROVED=1`, approver Arif) and run 69's "pushed" note was wrong.
Every sibling design branch is on the remote. After approval:
`git push -u origin feature/t_10da9c7a-datatable-refactor` (tip `ec097b6`).
No commits after `416a17d` change code — `416a17d` (residue), the screenshot +
handoff-amendment commit, and `ec097b6` (run 69) are docs/shots/tests only.

## Verify it yourself
```
cd /home/ubuntu/qalm && git checkout feature/t_10da9c7a-datatable-refactor
cd web && npm run build && npx tsc --noEmit && npx eslint src && npm test
# runtime (stub API + prod build):
node scripts/contract-stub-api.mjs 3001        # then bootstrap the first admin
npm run start                                   # :3000
# browse http://localhost:3000 → login → /users, /projects
```
