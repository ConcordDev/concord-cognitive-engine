# Concord DX — JetBrains plugin

JetBrains IDE wrapper around `concord-lsp`. Backed by [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) so most behaviour is implemented in the language server, not in plugin-specific Kotlin.

## Develop

Build the language server first — the plugin bundles its compiled
output, and the Gradle build warns (and bundles nothing) without it:

```bash
npm --prefix ../concord-lsp ci && npm --prefix ../concord-lsp run compile
cd concord-jetbrains
./gradlew runIde
```

## Status

v0.1 — wired, not yet published to the JetBrains Marketplace.

What's real:

- **LSP registration** — `concord-lsp` is registered with LSP4IJ
  (plugin.xml, `com.redhat.devtools.lsp4ij.server`) and launched via
  stdio by `lsp/ConcordLanguageServer`, which passes
  `{ serverUrl, apiKey, streamPath }` as initializationOptions:
  apiUrl from Settings, the API key from the IDE PasswordSafe at
  server-start time. The compiled server + its `node_modules` are
  bundled at the plugin root as `lsp/` (prepareSandbox, build.gradle.kts),
  or point Settings → Tools → Concord → "LSP server override" at your
  own entrypoint. Attached to JS/TS/Python/JSON files; findings render
  as inline editor highlights, repair proposals as Accept / Ignore /
  Reject prompts (both are LSP4IJ client surfaces).
- **Settings** — Settings → Tools → Concord: API URL, billing-confirm
  threshold, severity weights, LSP override, OAuth sign-in.
- **Tool window** — Wallet tab reads the live Concord Coin balance;
  Findings tab reports the server's setup status (bundled server
  presence, API URL, sign-in state), each labelled as what it checks.

Not done: Marketplace publication (the dx-platform installer link has
no published listing behind it yet), and a findings *list* inside the
tool window — LSP4IJ 0.5.0's client owns publishDiagnostics, so
findings surface in the editor rather than a tree here.

## Build

```
npm --prefix ../concord-lsp ci && npm --prefix ../concord-lsp run compile
./gradlew buildPlugin        # Gradle 8.5 via the wrapper; JDK 17
```

`.github/workflows/jetbrains-plugin.yml` runs exactly this on every change here or in `concord-lsp/`, checks
that the plugin zip contains `lsp/server.js`, and uploads the zip. That workflow is the build evidence for
this plugin; it has not been compiled on the maintainers' Mac (a full IntelliJ Platform build downloads the
IDE SDK and is too heavy for that machine).
