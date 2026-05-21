# code — Feature Gap vs Cursor / VS Code

Category leader (2026): Cursor (AI-native VS Code). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/code.js` — 58 macros: projects, files tree/read/write/delete/rename, virtual git (status/stage/commit/log/branch/checkout/merge/diff/blame/discard/stash), search + replace + rename-symbol, find-references, symbols-outline, diagnostics, todo-scan, exec, run-configs, bookmarks, tab-completion, inline-edit, explain, refactor, test-generate, format, multi-file plan/apply, agent tasks.

## Has (verified in code)
- Monaco editor: syntax highlight, multi-tab, folding, minimap; file tree explorer
- Virtual projects + workspaces; full virtual git (branches with tree isolation, merge w/ conflict detection, diff, blame, stash)
- Project-wide search/replace, find-references, rename-symbol, TODO scan, symbol outline
- Diagnostics/problems panel; sandbox JS/TS execution; run configurations
- AI: ghost-text tab completion, inline edit (cmd-K), explain, refactor, test-gen, multi-file agent plan+apply
- Snippets library, bookmarks, local-history snapshots; complexity/dependency/coverage analysis
- TerminalPanel, SourceControlPanel, MultiFileAgentReview; BYO key drawer

## Missing — buildable feature backlog
- [ ] `[L]` Live language-server IntelliSense (hover types, signature help)
- [ ] `[M]` Push/pull to a real remote GitHub repo (virtual git only)
- [ ] `[M]` Step debugger with breakpoints + watch + call stack
- [ ] `[M]` Codebase-wide AI chat with @-file context (Cursor's killer feature)
- [ ] `[S]` Extensions / plugin system
- [ ] `[S]` Split-pane multi-file editing
- [ ] `[M]` Real-time multiplayer / Live Share editing

## Parity
~72% of Cursor's surface. Unusually deep — Monaco, full virtual git, search/refactor, sandbox exec, and AI multi-file editing are all real. Gaps are LSP IntelliSense, remote git, a step debugger, and codebase-context AI chat.
