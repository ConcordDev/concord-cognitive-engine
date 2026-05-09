# Concord DX

Detectors + repair-cortex proposals + per-codebase severity tuning, streamed live from your Concord instance.

## Install (dev)

```bash
cd concord-vscode
npm install
npm run compile
# Open the folder in VS Code → Run → "Run Extension"
```

## Sign in

1. Issue an API key in your Concord dashboard at `https://your-concord/api/keys` (or via `POST /api/keys`).
2. Run `Concord: Sign In` from the Command Palette and paste the key (starts with `csk_…`).
3. The plugin stores it in `vscode.SecretStorage` (OS keychain). It is never logged.

## What it does

* Registers your workspace as a codebase via `dx.register_codebase`.
* Connects to the Concord `/dx` Socket.IO namespace and subscribes to your codebase.
* On file save (debounced 500ms): runs detectors, streams findings into the gutter as VS Code diagnostics.
* When repair-cortex proposes a fix: opens a webview with the diff + Accept / Ignore / Reject buttons.
* Your decisions feed `dx.record_fix_decision`, which tunes per-codebase severity weights — noisy rules quietly demote on subsequent sweeps; high-signal rules promote.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `concord.serverUrl` | `http://localhost:5050` | Concord server origin (HTTP + Socket.IO). |
| `concord.streamPath` | `/dx` | Socket.IO namespace for the DX stream. |
| `concord.runOnSave` | `true` | Run detectors automatically on file save. |

## Commands

| Command | Description |
|---|---|
| `Concord: Sign In` | Paste your `csk_*` API key. |
| `Concord: Sign Out` | Clear the stored key + disconnect. |
| `Concord: Register Codebase` | Re-register the active workspace. |
| `Concord: Run Detectors on Workspace` | Manually trigger a detector sweep. |
| `Concord: Show Findings Sidebar` | Open the Concord findings tree. |

## Privacy

* The plugin sends file contents to your Concord server only via `dx.upsert_shadow` (when explicitly opted in by your activation flow). Detectors run server-side against the registered codebase id.
* The plugin **never auto-applies** a repair-cortex fix. Acceptance is always an explicit click.
* The API key is stored in the OS keychain via `vscode.SecretStorage`. `Concord: Sign Out` deletes it.

## Status: alpha (v0.1)

This is the Phase A4 scaffold. UX polish (inline CodeLens, settings UI, JetBrains parity, web-editor variant) lands in Phase A5.

— [/root/.claude/plans/okay-dope-now-with-dreamy-dijkstra.md](../okay-dope-now-with-dreamy-dijkstra.md)
