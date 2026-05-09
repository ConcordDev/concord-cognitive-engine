# Concord LSP

Concord DX as a Language Server. One server, three clients:
* **VS Code** consumes it via `vscode-languageclient` (replacing the bespoke handlers in `concord-vscode/`).
* **JetBrains** consumes it via [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij).
* **Web editor** (Monaco) consumes it via `monaco-languageclient`.

Single source of truth — every IDE-specific bug becomes a parity bug surfaced by one of the three clients, fixable in one place.

## Develop

```bash
cd concord-lsp
npm install
npm run compile
node out/server.js --stdio
```

## InitializationOptions

```jsonc
{
  "serverUrl": "http://localhost:5050",
  "apiKey": "csk_…",
  "streamPath": "/dx"
}
```

## Capabilities

* `textDocument/publishDiagnostics` — driven by `/dx` socket events
  (`detector:finding.added` → buffer; `detector:run.complete` → flush).
* `window/showMessageRequest` — repair proposals surface as
  Accept / Ignore / Reject. Click → `dx.record_fix_decision`.
* `textDocument/didSave` — debounced trigger of `detectors.runAll`.

Status: alpha (v0.1). The vscode extension under `concord-vscode/`
will migrate from its bespoke handlers to consume this LSP in the next
patch.

— [/root/.claude/plans/okay-dope-now-with-dreamy-dijkstra.md](../../okay-dope-now-with-dreamy-dijkstra.md)
