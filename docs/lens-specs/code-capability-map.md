# code — capability map (Frontend Rebuild Program, Wave 3)

Reference apps: **VS Code** (editor, file tree, source control, terminal,
run/debug, search, extensions) and **GitHub Copilot Chat / Cursor** (AI
pair-chat, inline edit, multi-file agent review). Parity target: the only
difference should be that this is a browser-hosted, per-user virtual
workspace rather than a local filesystem — feature-for-feature it should
read like a real IDE, not a code-snippet toy.

## Backend macro surface

`server/domains/code.js` — **80 macros** via `registerLensAction("code", ...)`,
spanning: virtual multi-project file CRUD (`projects-*`, `files-*`),
full virtual git (`git-status/log/diff/stage/unstage/discard/commit/branch-
create/checkout/merge/stash/stash-pop/blame`), LSP-shaped semantics
(`hover`, `completions`, `diagnostics`, `references`/`find-references`,
outline), search, snippets, run/execute, AI-assisted actions (`explain`,
`refactor-suggest`, `test-generate`, `format-code`, `inline-edit`), agent
composer/multi-file review, GitHub trending, Live Share (real Yjs CRDT +
a legacy polling path), and a `workspace-summary` dashboard rollup.

`node scripts/lens-unsurfaced.mjs --lens code` → was **6/80 unsurfaced**
before this rebuild (`files-rename`, `git-blame`, `projects-delete`,
`refactor-suggest`, `test-generate`, `workspace-summary`) — **now 1/80**
(only `refactor-suggest`, honest-relabeled below).

## Pre-existing depth (found before this rebuild)

This lens is already the deepest in the fleet: a 127KB primary page
implementing a full "quick-script workspace" (ad hoc script tabs, run/share,
GitHub trending, snippets library, an AI-Pair chat side panel routed through
`llm.local` with file context, a multi-file agent-review flow, Live Share),
PLUS a second, independently real sub-system — `CodeWorkbenchSection.tsx` —
implementing a genuine multi-file **virtual-git project workspace** (VS
Code-shaped: activity bar, file explorer, outline, search, source control,
agent composer, run/debug, problems panel, status bar), PLUS a third,
independently real `CodeAdvancedPanel.tsx` covering 7 Cursor/VS-Code-parity
features (live IntelliSense, remote GitHub push/pull, step debugger,
codebase-wide chat, extensions, split-pane layout, real-time multiplayer).

These three surfaces are **not duplicates of each other** — they cover
genuinely different feature sets (quick scripts vs. full git projects vs.
power-user IDE features) built on different backend concepts (an ad hoc
tabs+snapshots model vs. the full virtual-git project model). Each was
independently verified free of fabricated data (no `Math.random`, no
hardcoded arrays presented as live data, no unfulfilled dead buttons).

**Honest observation, not fixed this pass**: the three surfaces each carry
their own "pick a project" state (the quick-script tabs have none; the
virtual-git workspace has `ProjectSwitcher`; the advanced panel has its own
separate `ProjectSwitcher` instance) — a real UX friction (three independent
project contexts on one page) but out of scope for this pass given the risk
of touching all three simultaneously. **Flagged as a scoped future build
task**: thread a single shared `projectId` through all three via lifted
state or a small context, no backend changes needed.

## What this rebuild changed (closing the 5 confirmed gaps)

All five real gaps lived in the virtual-git project sub-system
(`CodeWorkbenchSection` + its children), the cleanly separable part of the
page:

- **`files-rename`** — `FileExplorer.tsx` gained an inline VS-Code-style
  rename (pencil icon → in-place text input, Enter/blur commits, Escape
  cancels, basename pre-selected). A `renameSignal` prop threads the
  (from, to) pair into `EditorPane.tsx` so an already-open tab is relabeled
  in place instead of silently recreating the old path on next Save (which
  a naive "just reopen the new path" approach would have caused).
- **`projects-delete`** — `ProjectSwitcher.tsx` gained a delete (trash)
  button next to the project select, with a confirm dialog naming the
  project and warning it removes files + git history. Clears the selection
  in `CodeWorkbenchSection` on delete.
- **`git-blame`** — `EditorPane.tsx` gained a "Blame" toolbar button
  (shown whenever a project is open) that renders a per-line commit
  attribution table (line no / short commit id / author / code, with a
  hover tooltip for the full message + timestamp) — the real per-line
  chronological diff the backend already computes, previously entirely
  unreachable from any UI.
- **`workspace-summary`** — `CodeWorkbenchSection.tsx`'s status bar now
  shows a live project/file count plus running-agent-task and dirty-project
  badges (refreshed alongside git/diagnostics status), so the dashboard
  rollup the backend computes is actually visible somewhere.
- **`explain` / `test-generate`** — `EditorPane.tsx` gained one-click
  "Explain" (selection or whole file → prose panel, distinct from typing
  into the free-form AI-Pair chat) and "Generate tests" (whole file → a
  real test file in a save-preview panel with "Save as `<suggested-path>`",
  deriving `foo.ts` → `foo.test.ts` and opening the saved file). These are
  the code-only, no-prompt-typing counterparts to what a user could
  previously only get by typing "explain this" / "write a test" into the
  AI-Pair chat and manually extracting a code block.

## Disposition ledger (step 1.5)

- **ALREADY REAL**: the full quick-script workspace (tabs, run, AI-Pair
  chat, multi-file agent, snippets, GitHub trending, Live Share); the full
  virtual-git project workspace (files, git status/stage/commit/branch/
  merge/stash/diff, outline, search, problems, run/debug); the 7
  Cursor/VS-Code power features in `CodeAdvancedPanel`; `find-references`
  and `format-code` (already wired in `SearchPanel`/`EditorPane`).
- **BACKEND-CAPABLE-BUT-UNSURFACED → now wired**: `files-rename`,
  `projects-delete`, `git-blame`, `workspace-summary`, `explain`,
  `test-generate` (all six, above).
- **GENUINELY MISSING / honest relabel**: `refactor-suggest` — a whole-file,
  canned-goal ("improve readability") code-only rewrite. Left unwired by
  design: `inline-edit` (already wired, ⌘K) takes an arbitrary instruction
  on a selection — including "refactor for readability" verbatim, per its
  own placeholder text — and is strictly more general (any instruction, any
  selection size) than the canned single-goal macro. Wiring a second button
  for a strict subset of an already-wired capability would be redundant UI,
  not new capability — honest relabel, not a gap.
- **Flagged as a scoped future build task**: unify the three project-picker
  states across the page's three sub-systems (see "Honest observation"
  above) — presentation-only, no backend work.

## Verification

- `npx eslint app/lenses/code/page.tsx components/code/FileExplorer.tsx components/code/ProjectSwitcher.tsx components/code/EditorPane.tsx components/code/CodeWorkbenchSection.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `code` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `code`: `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens code` — 6/80 → 1/80 (only the honestly-relabeled `refactor-suggest` remains).
- `npx vitest run tests/editor-pane-ctrlk-race.test.tsx` — 2/2 passing (the new Explain/Tests/Blame state doesn't interfere with the existing Ctrl+K capture-phase race fix).
