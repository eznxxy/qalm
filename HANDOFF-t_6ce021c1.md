# Handoff — t_6ce021c1 (qalm-design-2c: shell keyboard shortcuts + help dialog)

## Goal
DESIGN.md §7 shortcuts on the app shell with the `?` help dialog: `/` search,
`g`→`c`/`r`/`p` navigation, `?` help, `n` new (context-aware), Esc closing
dialogs; a reusable keymap util in `web/src/lib/`; no shortcut fires while
typing; deferred shortcuts documented, not half-wired.

## Files changed (branch `feature/t_6ce021c1-shell-shortcuts`, 8 commits, local)
- `web/src/lib/keymap.ts` (new) — `ShortcutDefinition`, `resolveShortcut`
  (typing guard, modifier discipline, `data-shortcut-scope` scoping),
  `useGlobalShortcuts` hook, `isTypingTarget`. Reusable by later screens.
- `web/src/components/help-dialog.tsx` (new) — §7 dialog: `role=dialog`,
  `aria-modal`, focus trap (capture-phase Tab), Esc close, overlay click
  close, focus restore on unmount, capture-phase key shield so page
  shortcuts can't fire under the modal. Lists wired shortcuts AND the
  deferred ones under "Coming later".
- `web/src/components/app-shell.tsx` — shortcut wiring: `/` (input opt-in),
  `n` (context-aware), `?`, `g` chord (1000 ms arm window, repeat/modifier
  guarded) via `useGlobalShortcuts`; help dialog state; the `?` affordance
  is now a `<button aria-haspopup="dialog">` (was a dead link to /help — no
  such route existed); help dialog rendered at shell root.
- `web/src/components/confirm-dialog.tsx` — minimal addition: while the
  confirm dialog is open it swallows every non-Esc/Tab key (same modal
  shield); its Esc-close behaviour is untouched (verified by the existing
  projects-page Esc test).
- `web/src/app/globals.css` — `.help-dialog` (max-height + scroll), section
  headings, `dl` rows, `kbd` chip styling (token-based).
- Tests: `web/src/lib/__tests__/keymap.test.tsx` (22), 
  `web/src/components/__tests__/shell-shortcuts.test.tsx` (15);
  `app-shell.test.tsx` updated to expect the dialog affordance.

## Assumptions
- "n is context-aware" today = Projects screen only: with the create form
  closed it clicks the toolbar's "New project" toggle and focuses the form's
  Name field (a same-URL router.push would be a no-op); with it open it
  focuses the first field; anywhere else it navigates to /projects (scoped).
  Discovery contract: form `[aria-label="Create project"]`, trigger button
  text "New project". Built screens wire their own `n` against this contract.
- `?` fires on `KeyboardEvent.key === "?"` (shift+/ on US layouts); IME
  variants are out of scope.
- `g` chord: bare `g` navigates nowhere; any non-mapped second key just
  leaves the arm to expire (1000 ms).
- The top-bar search input carries `data-shortcut-scope="shell"` so scoped
  maps (future result-form `P`/`F`/…) never fire while the caret is in it.
- **Deliberately deferred (documented in the dialog, not wired):**
  `Ctrl+Enter` save and `P F B R S` status → result form slice;
  `j`/`k` row movement → run-detail slice.

## How to run and verify
- Gates (all run, all green): `npm run lint` (0 findings), 
  `npx tsc --noEmit -p tsconfig.json` (clean), `npx jest` → **242/242 across
  16 suites** (+37 new), `npm run build` (8 static + 2 partial-prerender,
  unchanged).
- Live (prod build on :3000, stub API :3001, iris@qalm.test): on /projects —
  `/` focuses the search box; `?` opens the dialog (focus moves to Close,
  19 kbd chips, n/`g` swallowed while open, Esc closes and restores focus to
  the `?` button); `g`+`c`/`r`/`p` → /wip/cases|runs|plans with
  `?project=p-acc`; lone `c` does nothing; Ctrl+N does nothing; typing
  `?`/`n`/`g` inside the search box does nothing while `/` still refocuses;
  `n` (form closed) opens the form and focuses #project-name, `n` again
  keeps focus there without toggling.
- Evidence: `shots/t_6ce021c1-projects-help-dialog.png` (vision-checked:
  dialog open over Projects, kbd chips, three sections, Close, unclipped;
  Navigation heading sits just above the scroll line at 577px viewport —
  the dialog scrolls by design).

## Open risks / notes for Daedalus
- `n`'s DOM-discovery contract (aria-label + button text) is a convention —
  if later screens should register shortcuts differently (a screen-level
  registry), decide before the cases screen lands.
- jest's jsdom does not implement the contentEditable IDL; `isTypingTarget`
  reads the attribute too (browsers keep both in sync).
- Esc on native widgets (select dropdown, date picker) is browser-native and
  untouched; the account menu already had Esc (unchanged).
- Local-only commits like the rest of the stack; push gate when approved:
  `QALM_PUSH_APPROVED=1 git push -u origin feature/t_6ce021c1-shell-shortcuts`.
