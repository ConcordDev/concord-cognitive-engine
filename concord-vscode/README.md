# Concord DX — VS Code Extension

Bring [concord-os.org](https://concord-os.org)'s detector intelligence into VS Code.

Concord is a cognitive operating system with a self-instrumented detector grid (22 detectors covering stale code, invariant guards, perf hotspots, secret leaks, lens health, heartbeat liveness, and more). The Concord DX extension surfaces those findings inside the editor and bills you per call against your Concord Coin balance — so the platform pays for itself in proportion to how much you use it.

## What you get

- **Detector findings** for the active file — surfaced in the Concord side panel and as inline diagnostics.
- **Repair-cortex previews** — the engine suggests a fix; you accept or decline. Accepts go through your editor's standard apply path.
- **Per-codebase severity** — once your team uses the extension on a repo, the engine learns which findings matter to *you*. False-positive rules get suppressed; high-impact rules get bumped to error.
- **Pay-per-call billing** — each LSP operation that maps to a server-side macro costs a fraction of a Concord Coin. The wallet view shows your balance in real time.

## Getting started

1. Install the extension from the VS Code Marketplace.
2. Click the Concord status-bar item (bottom right) → **Sign in with Concord**.
3. Your browser opens; sign in to your Concord account; click Allow.
4. Token is stored in the OS keychain (`vscode.SecretStorage`). No file on disk; no plaintext settings.
5. Open a file. Detector findings appear in the Concord side panel within seconds.

## Configuration

| Setting | Default | What it does |
|---|---|---|
| `concord.apiUrl` | `https://concord-os.org` | Concord API endpoint. Override for local dev or self-hosted instances. |
| `concord.severityWeights` | `{}` | Per-rule severity overrides. Keys are detector rule IDs; values are `error` / `warning` / `info` / `hint` / `off`. |
| `concord.lspServerCommand` | (bundled) | Override the LSP server binary. Useful for plugin development. |
| `concord.billing.confirmThresholdCC` | `0.10` | Prompt before any single operation that would cost more than this many Concord Coin. |

## Commands

All available via `Cmd+Shift+P` → *Concord:*
- **Sign in with Concord** — browser-based OAuth (RFC 8252 loopback redirect).
- **Sign out** — wipes the local token.
- **Run detector pass on current file** — manual trigger (auto-runs on save by default).
- **Open wallet (browser)** — see your CC balance + recent charges.
- **Preview suggested repair** — fetch the repair-cortex preview for the current selection.

## How billing works

Every call into the Concord substrate (a detector pass, a repair preview, a council consult) is metered against your `csk_*` token. Reads cost less than writes. The first 10,000 reads/month and 1,000 writes/month are free; beyond that the per-call price is set by the [Concord Coin gauge](https://concord-os.org/lenses/wallet) — typically $0.0001–$0.001 per call.

You see the cost before any operation that exceeds `concord.billing.confirmThresholdCC` (default 0.10 CC). Lower the threshold to 0 to be prompted for every call.

## Privacy

- **Code never leaves your machine** in the LSP path. Findings are computed locally by the `concord-lsp` server bundled with the extension.
- **DTU citations**, when you choose to publish work, sync to the Concord substrate explicitly — never automatically.
- **Tokens** live in `vscode.SecretStorage` (OS keychain), not in workspace settings or sync.

## Support

- Issues: https://github.com/ryttps94jq-gif/concord-cognitive-engine/issues
- Docs: https://concord-os.org/docs
- Discord: link forthcoming

## License

See `LICENSE.txt` in this directory.
