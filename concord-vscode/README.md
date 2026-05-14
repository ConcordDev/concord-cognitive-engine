# Concord DX — VS Code Extension

Bring [concord-os.org](https://concord-os.org)'s detector intelligence into VS Code.

Concord is a cognitive operating system with a self-instrumented detector grid (27 detectors covering stale code, invariant guards, perf hotspots, secret leaks, lens health, heartbeat liveness, HTTP errors, UX/a11y gaps, and more). The Concord DX extension surfaces those findings inside the editor and bills you per call against your Concord Coin balance — so the platform pays for itself in proportion to how much you use it.

## What you get

- **Detector findings** for the active file — surfaced in the Concord side panel and as inline diagnostics.
- **Repair-cortex previews** — the engine suggests a fix; Accept / Ignore / Reject buttons in the webview send the decision to `dx.record_fix_decision` so your team's per-codebase severity weights tune over time.
- **Per-codebase severity** — once your team uses the extension on a repo, the engine learns which findings matter to *you*. False-positive rules get suppressed; high-impact rules get bumped to error.
- **Pay-per-call billing** — each LSP operation that maps to a server-side macro costs a fraction of a Concord Coin. The wallet view shows your balance in real time.

## Install (dev)

```bash
cd concord-vscode
npm install
npm run compile
# Open the folder in VS Code → Run → "Run Extension"
```

## Getting started

1. Install the extension from the VS Code Marketplace.
2. Click the Concord status-bar item (bottom right) → **Sign in with Concord**.
3. Your browser opens; sign in to your Concord account; click Allow.
4. Token is stored in the OS keychain (`vscode.SecretStorage`). No file on disk; no plaintext settings.
5. Open a file. Detector findings appear in the Concord side panel within seconds.

### Legacy paste-key fallback

If your Concord instance doesn't yet support the OAuth flow, the legacy
`Concord: Sign In (paste API key — legacy)` command is still available.
Issue a key at `<concord-server>/api-keys` and paste it in.

## What it does (architecture)

* Registers your workspace as a codebase via `dx.register_codebase`.
* Connects to the Concord `/dx` Socket.IO namespace and subscribes to your codebase.
* On file save (debounced 500ms): runs detectors, streams findings into the gutter as VS Code diagnostics.
* When repair-cortex proposes a fix: opens a webview with the diff + Accept / Ignore / Reject buttons.
* Your decisions feed `dx.record_fix_decision`, which tunes per-codebase severity weights — noisy rules quietly demote on subsequent sweeps; high-signal rules promote.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `concord.serverUrl` | `http://localhost:5050` | Concord server origin (HTTP + Socket.IO). Override for production: `https://concord-os.org`. |
| `concord.streamPath` | `/dx` | Socket.IO namespace for the DX stream. |
| `concord.runOnSave` | `true` | Run detectors automatically on file save (debounced 500ms). |
| `concord.severityWeights` | `{}` | Per-rule severity overrides. Keys are detector rule IDs; values are `error` / `warning` / `info` / `hint` / `off`. |
| `concord.lspServerCommand` | (bundled) | Override the LSP server binary. Useful for plugin development. |
| `concord.billing.confirmThresholdCC` | `0.10` | Prompt before any single operation that would cost more than this many Concord Coin. |

## Commands

All available via `Cmd+Shift+P` → *Concord:*

| Command | Description |
|---|---|
| `Concord: Sign in with Concord (OAuth)` | Browser-based OAuth (RFC 8252 loopback redirect). The recommended sign-in path. |
| `Concord: Sign In (paste API key — legacy)` | Paste your `csk_*` API key directly. |
| `Concord: Sign Out` | Wipe the local token. |
| `Concord: Register Codebase` | Register the current workspace as a codebase. |
| `Concord: Run Detectors on Workspace` | Trigger a workspace-wide detector pass. |
| `Concord: Show Findings Sidebar` | Reveal the Concord side panel. |
| `Concord: Open Wallet (browser)` | Open the wallet dashboard. |
| `Concord: Preview Suggested Repair` | Fetch the repair-cortex preview for the current selection. |

## How billing works

Every call into the Concord substrate (a detector pass, a repair preview, a council consult) is metered against your `csk_*` token. Reads cost less than writes. The first 10,000 reads/month and 1,000 writes/month are free; beyond that the per-call price is set by the [Concord Coin gauge](https://concord-os.org/lenses/wallet) — typically $0.0001–$0.001 per call.

You see the cost before any operation that exceeds `concord.billing.confirmThresholdCC` (default 0.10 CC). Lower the threshold to 0 to be prompted for every call.

## Privacy

- **Code never leaves your machine** in the LSP path. Findings are computed locally by the bundled `concord-lsp` server.
- **DTU citations**, when you choose to publish work, sync to the Concord substrate explicitly — never automatically.
- **Tokens** live in `vscode.SecretStorage` (OS keychain), not in workspace settings or sync.

## Support

- Issues: https://github.com/ryttps94jq-gif/concord-cognitive-engine/issues
- Docs: https://concord-os.org/docs

## License

See `LICENSE.txt` in this directory.
