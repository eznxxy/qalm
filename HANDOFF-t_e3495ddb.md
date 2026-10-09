# Handoff — t_e3495ddb: DataTable primitive (design step 4)

## Goal
Build `web/src/components/ui/DataTable` (+ `TableSkeleton`) per DESIGN.md §5/§2.5/§8
and refactor the admin-users and projects tables onto it. **Ordering note (Athena):
the table refactors are deferred** until step 1 (tokens, t_62938355) merges — this
run delivers the primitive, unit tests, and browser verification only. No existing
screen changed (verified: users/projects pages byte-identical to master on this branch).

## Files changed (branch feature/t_e3495ddb-datatable, 7 commits, pushed — tip ebe6d55)
- `web/src/components/ui/DataTable.tsx` — the primitive (see API below)
- `web/src/components/ui/DataTable.css` — component styles, token vars only
- `web/src/components/ui/index.ts` — barrel export
- `web/src/components/ui/__tests__/DataTable.test.tsx` — 26 unit tests
- `web/src/styles/tokens.css` — **STUB** owned by t_62938355; §2.1/§2.2 names + §2.5
  row heights, imported by the primitive until step 1 wires tokens app-wide
- `web/src/app/design/page.tsx` + nav link — temporary demo page (states/densities);
  remove or repurpose when a real screen ships on DataTable
- Commits: dfa4436 (primitive), e612408 (token import), 1f0cc16 (density fix), c90ba4d (ink-500),
  9e158ef (foreground fix), 48dc01f (light color-scope)

## Primitive API (stable — refactor PR will consume this)
```ts
<DataTable<T>
  columns={[{ key, header, sortable?, sortValue?, align?: "number",
              render?, description?, className? }]}
  rows={rows}                      // ReadonlyArray, never mutated
  getRowId={(row) => id}           // stable identity
  caption="…"                      // sr-only
  ariaLabel="…"                    // optional
  loading | error + onRetry + retryLabel | emptyTitle/emptyBody/emptyAction   // §6
  rowHeight="default" | "compact" | "comfortable"                             // 36/32/44
  selectable + selectedIds + onSelectedIdsChange                              // Set<string>
  sort + onSortChange   // controlled; or defaultSort for uncontrolled
  disabled className />
<TableSkeleton rows columns rowHeight label />   // standalone skeleton table
```
Controlled-props note: if `sort`/`selectedIds` are passed they win; `defaultSort`
only seeds the uncontrolled variant.

## Verification actually run
- `npx tsc --noEmit` exit 0; `npm run lint` 0 findings; `npm test` 151/151
  (26 new DataTable tests: sort cycle asc→desc→unsorted, numeric vs lexicographic,
  sortValue-mapped sorting, aria-sort + SR hints, selection incl. indeterminate
  header checkbox via DOM property + selection surviving sort, j/k/arrows/Home/End
  row nav with clamping, all §6 states + precedence, disabled, density var).
- Real browser (dev server + contract stub on 3001): rendered demo page — sticky
  header, ink-700 13px header, token colours resolve; sort + selection clicks work
  (status line "8 selected", indeterminate = true after deselecting one); keyboard
  j/k focus bar renders; densities computed 33(=32+border)/36/44; 375px viewport:
  `.dt-root` scrolls horizontally, body does not; loading/empty/error shots taken.
- Login to /users on the stub worked (3 seeded users); /projects shows its normal
  error state because the contract stub implements no /projects route — environment,
  not regression.

## Assumptions / decisions
- Virtualisation deliberately NOT built (§5 allows "OR document why not needed"):
  both current consumers paginate server-side at 25 rows/page; sorting is a shallow
  copy + localeCompare with stable id tiebreaker. Revisit if a client paginates
  200+ rows.
- Numbers right-aligned via `align: "number"` (adds .dt-cell-number);
  tabular-nums set table-wide per §2.4.
- indeterminate state set via DOM property (`aria-indeterminate` is flagged invalid
  by jsx-a11y and is not a boolean attribute).
- The table sets its own `color: var(--ink-900)` and `color-scheme: light` on the
  root: browser verification (vision check on the screenshot) caught inherited
  light text on the white surface / brand-tint selection and dark native checkbox
  chrome while the host app still runs `color-scheme: dark`. Both are scoped to
  the primitive; step 1's app-wide light flip will not need to change them.
- Partial header-checkbox click completes selection (native checkbox convention);
  from indeterminate the label reads "Select all N rows".
- Controlled-vs-uncontrolled split lets the refactor PR keep its own state shape.

## How to verify (reviewer)
1. `cd web && npm test` — 151 pass.
2. `npm run dev` (+ real API on :3001, or contract stub: `node scripts/contract-stub-api.mjs 3001`,
   bootstrap an admin, login) → nav link "Design: table" → /design.
3. Exercise: header buttons sort (aria-sort + hint visible in DOM), header checkbox
   select-all/indeterminate, j/k in the table body, State select = loading/empty/error,
   Row height select = compact/default/comfortable, narrow window < 768 → table
   scrolls inside its frame.
4. Screenshots: this file rides on the completion as an artifact, together with
   data / compact / comfortable / loading / empty / error / 375px-scroll shots and
   before-users (users screen unchanged; projects before-shot shows the stub's error
   state — see above). On this shared box the files also remain under
   ~/.hermes/profiles/frontendengineer/cache/scratch/datatable-*.png.

## Open risks / notes for next cards
- tokens.css is a STUB: t_62938355 must replace it and add the app-wide import; the
  primitive already imports it, so a double import is harmless (same file, and CSS
  custom properties are idempotent). If step 1 renames any token, only DataTable.css
  consumes them (single consumer).
- Refactor PR (this card's remaining half, after step 1 merges): swap users/projects
  tables onto DataTable. Feature parity surface: users = search/role filter/pagination/
  badges/Edit; projects = search/admin status filter/pagination/role-gated actions/
  confirm dialogs. Neither table currently sorts or multi-selects — the primitive
  offers both; adding them later is opt-in per column, not a behaviour change.
- The demo page + nav link are temporary; drop them when a real screen lands.
- NOTE for operator: attachment id 8 ("placeholder", 3 bytes) on this card is junk —
  a mis-fired attach call from me. No delete tool exists; please ignore/remove it.
  The real screenshots are attached with datatable-*/before-* filenames.
