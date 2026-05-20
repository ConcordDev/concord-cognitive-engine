# code — Feature Completeness Spec

Rival app(s): Visual Studio Code, Cursor
Sources:
- https://code.visualstudio.com/docs/getstarted/userinterface
- https://code.visualstudio.com/docs/editor/codebasics
- https://code.visualstudio.com/docs/sourcecontrol/overview
- https://code.visualstudio.com/docs/editor/editingevolved (IntelliSense, references, outline)
- https://code.visualstudio.com/docs/debugtest/tasks

## Features

### Workspace & projects
- [x] Virtual projects / multi-root workspaces (macro: code.projects-*)
- [x] Project scaffolding (node-ts template) (macro: code.projects-create scaffold)
- [x] Workspace summary dashboard (macro: code.workspace-summary)

### File explorer & editing
- [x] File tree (macro: code.files-tree)
- [x] Read / write / delete / rename files (macro: code.files-*)
- [x] Monaco editor — syntax highlight, multi-tab, folding, minimap (frontend)
- [x] Command palette / quick open (frontend useLensCommand + ProjectSwitcher)
- [x] Symbol outline / breadcrumbs — functions, classes, methods per file (macro: code.symbols-outline)

### Search
- [x] Project-wide search — plain / regex / case / whole-word / globs (macro: code.search-project)
- [x] Search & replace across the project (macro: code.replace-project)
- [x] Find all references to a symbol (macro: code.find-references)
- [x] Rename a symbol project-wide (macro: code.rename-symbol)
- [x] TODO / FIXME / HACK tracker across the project (macro: code.todo-scan)

### Problems & diagnostics
- [x] Diagnostics — static-analysis problems panel per file (macro: code.diagnostics)
- [⚠] Live language-server IntelliSense (hover types, signature help) — BOUNDARY:
  needs a per-language LSP process; substitute: LLM tab-completion + regex symbol
  outline + heuristic diagnostics

### IntelliSense & AI assist
- [x] Inline ghost-text completion (macro: code.tab-completion)
- [x] Inline edit — Cursor cmd-K (macro: code.inline-edit)
- [x] Explain code (macro: code.explain)
- [x] Refactor suggestion (macro: code.refactor-suggest)
- [x] Generate tests (macro: code.test-generate)
- [x] Multi-file agent plan + apply — Cursor Composer (macro: code.multi-file-plan / multi-file-apply)
- [x] Agent task surface (macro: code.agent-task-*)

### Source control (virtual git)
- [x] Status / stage / unstage (macro: code.git-status / git-stage / git-unstage)
- [x] Commit with content snapshot per commit (macro: code.git-commit)
- [x] Commit log / history (macro: code.git-log)
- [x] Branches — create / checkout with real per-branch tree isolation (macro: code.git-branch-create / git-checkout)
- [x] Merge a branch into the current branch — 3-way with conflict detection (macro: code.git-merge)
- [x] File diff vs HEAD — line-level hunks (macro: code.git-diff)
- [x] Blame — per-line commit attribution (macro: code.git-blame)
- [x] Discard working changes to a file (macro: code.git-discard)
- [x] Stash / stash list / stash pop (macro: code.git-stash / git-stash-list / git-stash-pop)
- [x] Diff viewer (frontend MonacoDiffViewer)
- [⚠] Push / pull to a remote GitHub repo — BOUNDARY: needs authenticated remote
  git transport; substitute: in-platform virtual git + commit-snapshot DTUs +
  GitHub trending read panel

### Run & tasks
- [x] Sandbox code execution — JS/TS (macro: code.exec)
- [x] Run configurations — named build/test/run tasks, tasks.json equivalent (macro: code.run-config-*)
- [x] Code formatting (macro: code.format-code)
- [⚠] Step debugger with breakpoints / watch — BOUNDARY: needs a debug adapter
  attached to a live runtime; substitute: sandbox exec with stdout/stderr +
  diagnostics

### Navigation & marks
- [x] Bookmarks — file + line marks (macro: code.bookmark-*)
- [x] Local history / timeline (macro: code.commit-snapshot / snapshots-list)
- [x] Snippets library (macro: code.snippets-*)

### Code intelligence (analytical)
- [x] Complexity analysis — cyclomatic / cognitive / maintainability (macro: code.complexityAnalysis)
- [x] Dependency audit — licenses, versions, circular deps (macro: code.dependencyAudit)
- [x] Coverage analysis (macro: code.coverageAnalysis)
- [x] Change-risk assessment (macro: code.changeRiskAssessment)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live language-server IntelliSense | per-language LSP process | LLM tab-completion + regex symbol outline + heuristic diagnostics |
| Push / pull to a remote GitHub repo | authenticated remote git transport | virtual git + commit-snapshot DTUs + GitHub trending panel |
| Step debugger (breakpoints / watch) | debug adapter on a live runtime | sandbox exec with stdout/stderr + diagnostics |

## Verification log
- (in progress) — backend macros + tests; frontend panels; feature walkthrough.
