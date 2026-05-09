# Concord DX — JetBrains plugin

JetBrains IDE wrapper around `concord-lsp`. Backed by [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) so most behaviour is implemented in the language server, not in plugin-specific Kotlin.

## Develop

```bash
cd concord-jetbrains
./gradlew runIde
```

## Status

Scaffold only (v0.1). The plugin currently bundles a reference to `concord-lsp` and registers it via LSP4IJ. The settings panel for API key entry + the dedicated tool-window for the findings tree land in v0.2 (deferred to A5+ polish).

— [/root/.claude/plans/okay-dope-now-with-dreamy-dijkstra.md](../okay-dope-now-with-dreamy-dijkstra.md)
