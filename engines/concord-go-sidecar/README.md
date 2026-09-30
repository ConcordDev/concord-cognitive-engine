# concord-go-sidecar

Long-lived Go process that owns **Whisper / Piper / sandbox** subprocess execution
so the Node event loop never `spawnSync`s them on a request path.

Concurrency Refactor **Phase 1** — audit finding **C03** ("spawnSync on hot paths
masquerading as async"). See `docs/CLAUDE_HANDOFF_CONCURRENCY_REFACTOR-2026-09-08.md`.

## What it is

- stdlib-only Go, single file (`main.go`)
- HTTP over a **Unix domain socket** (`CONCORD_GO_SIDECAR_SOCK`, default
  `/Users/dutch/concord/run/concord-go-sidecar.sock`)
- bounded child-process concurrency (`CONCORD_GO_SIDECAR_MAX_EXEC`, default 4)

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET  | `/v1/health`  | — | `{ok, uptimeSec, maxExec, whisper, piper}` |
| POST | `/v1/whisper` | `{audioPath \| audioBase64, model?, timeoutMs?}` | `{ok, transcript}` / `{ok:false, error}` |
| POST | `/v1/piper`   | `{text, modelArg?, timeoutMs?}` | `{ok, wavBase64}` / `{ok:false, error}` |
| POST | `/v1/sandbox` | `{command, workDir?, timeoutMs?, maxOutputBytes?, env?}` | `{exitCode, stdout, stderr, timedOut}` |

The sandbox endpoint re-applies Node's own allowlist + chain-operator guard
(defense in depth — Node still gates first). Whisper/Piper stay env-gated: if
`WHISPER_CPP_BIN` / `PIPER_BIN` are unset the endpoint returns an honest
`*_not_configured` error, exactly like the inline path.

## Build

```sh
GOFLAGS=-trimpath go build -ldflags="-s -w" -o bin/concord-go-sidecar .
```

`bin/` is gitignored — build on the deploy box.

## Run (macOS, launchd — NOT pm2)

```sh
cp deploy/com.concord.go-sidecar.plist ~/Library/LaunchAgents/
launchctl bootout  gui/$(id -u)/com.concord.go-sidecar 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concord.go-sidecar.plist
launchctl kickstart -k gui/$(id -u)/com.concord.go-sidecar
curl --unix-socket /Users/dutch/concord/run/concord-go-sidecar.sock http://x/v1/health
```

Keep the sidecar's `WHISPER_CPP_BIN` / `PIPER_BIN` / `PIPER_VOICE` /
`PIPER_VOICES_DIR` in lockstep with `com.concord.backend`, or a request Node
thinks is configured gets `not_configured` from the sidecar and falls back to
the (slower but correct) inline `spawnSync` path.

## Node side

`server/lib/sidecars/go-sidecar-client.js` — fail-soft client. `isAvailable()`
is a cached ~3s probe; every call rejects on transport failure and the four
call sites in `server/server.js` (`executeInSandbox`, `voice.transcribe`,
`voice.tts`, `processVoiceNote`) catch and fall back inline. **The sidecar being
down never breaks a request — it just stops being fast.**
