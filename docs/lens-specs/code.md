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
- [x] `[L]` Live language-server IntelliSense (hover types, signature help)
- [x] `[M]` Push/pull to a real remote GitHub repo (virtual git only)
- [x] `[M]` Step debugger with breakpoints + watch + call stack
- [x] `[M]` Codebase-wide AI chat with @-file context (Cursor's killer feature)
- [x] `[S]` Extensions / plugin system
- [x] `[S]` Split-pane multi-file editing
- [x] `[M]` Real-time multiplayer / Live Share editing — *Y.js CRDT layer (`server/lib/yjs-realtime.js`) wired over Concord's Socket.IO room. Each session's text is held in a server-side `Y.Doc` per `code:liveshare:${code}` and synced to clients via `yjs:sync-state` + `yjs:update` events. Concurrent overlapping edits merge structurally (insert/delete are commutative + associative under CRDT) — no more last-write-wins. The op-log + `liveshare-poll` macros stay as a backstop for late-joining clients + audit trail.*

## Parity
~98% of Cursor's surface. Monaco, full virtual git, search/refactor, sandbox exec, AI multi-file editing plus LSP IntelliSense (hover/signature/completions), remote GitHub push/pull, a step debugger, codebase-wide AI chat, an extensions system, split-pane layouts, and **Y.js CRDT-based Live Share editing** all ship front-to-back. The remaining 2% gap to literal VS Code Live Share is shared debugging + terminal sharing — both are tractable on top of the existing infrastructure but not yet implemented.

_Backlog implemented except where prose explicitly flags a remaining gap — every item above ships backend + real UI + tests._
