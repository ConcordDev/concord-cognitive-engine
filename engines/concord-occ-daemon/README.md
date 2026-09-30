# concord-occ-daemon

Long-lived **warm OpenCascade** process. Replaces the per-request
`execFile(python, [conkay_occ_cli.py, cmd, json])` in
`server/lib/conkay/occ-bridge.js` — which paid a cold `import OCP` (~0.7s) on
**every** call and let feature-rebuild bursts stack Python processes (OCC is not
reentrant, nothing serialised them).

Concurrency Refactor **Phase 2** — audit finding "OCC execFile 60s stacking".

## What it is

- `server/scripts/conkay_occ_daemon.py` — imports `conkay_occ_cli` **once**, serves
  its `COMMANDS` table over a Unix-domain-socket HTTP API.
- All OCC work runs on a single worker thread (`ThreadPoolExecutor(max_workers=1)`)
  with a per-job timeout. One job at a time, always.
- `server/lib/sidecars/occ-daemon-client.js` — fail-soft Node client. `isAvailable()`
  is a cached ~3s probe.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET  | `/v1/health` | — | `{ok, served, errors, busy, commands}` |
| POST | `/v1/occ` | `{cmd, payload, timeoutMs?}` | the command's own result dict (identical shape to the CLI) |

## Run (macOS, launchd)

```sh
cp engines/concord-occ-daemon/com.concord.occ-daemon.plist ~/Library/LaunchAgents/
launchctl bootout  gui/$(id -u)/com.concord.occ-daemon 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concord.occ-daemon.plist
launchctl kickstart -k gui/$(id -u)/com.concord.occ-daemon
curl --unix-socket /Users/dutch/concord/run/concord-occ-daemon.sock http://x/v1/health
```

**Restart the daemon after editing `conkay_occ_cli.py` / `conkay_occ_industrial.py`** —
it holds the imported module in memory:
`launchctl kickstart -k gui/$(id -u)/com.concord.occ-daemon`

## Node side

`occ-bridge.js#runOccCli` tries the daemon first; any transport error (or the
daemon being down) drops through to the original `execFileAsync` cold path
unchanged. Kill-switch: `CONCORD_OCC_DAEMON_DISABLE=1`.

The INDUSTRIAL_CLASS / solid-world cert harnesses
(`concord-frontend/scripts/conkay-*-cert.mjs`) call the CLI **directly** via
`spawnSync`, not through `occ-bridge.js`, so they exercise the kernel unchanged
and are unaffected by the daemon.
