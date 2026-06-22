# Concord Load Test

Answers the real question: **will the website actually serve everyone?** —
by measuring the *knee*, the concurrency at which p95 latency or the error
rate climbs off the floor. That turns "should handle thousands" into a number.

Models Concord's real traffic shape: **read-heavy browsing + a large pool of
held-open WebSocket connections**, plus **opt-in** Concordia writes and chat
(LLM) so each ceiling is measured separately.

## Safety

- **Default run is read-only + WebSocket.** It hits public GET endpoints and
  opens/holds Socket.IO connections. It does **not** write to your DB or spend
  GPU. Safe to point at production.
- **Write + chat scenarios are opt-in** (`ENABLE_CONCORDIA=1`, `ENABLE_CHAT=1`)
  and need a token pool from `setup-users.mjs`, which creates **real accounts**.
  Use a staging box for those, or accept test data + GPU spend in prod.
- Running a heavy load test against prod *is* generating real traffic. Start
  small, watch the pod's `ops-telemetry` lens + `pm2 logs` while it ramps.

## Quick start (no install)

```bash
# Zero-dependency Node read smoke — fast "does it hold?" gut-check.
node scripts/loadtest/quick-smoke.mjs --url https://concord-os.org -c 200 -d 30

# Staircase 50→1000 workers to eyeball the read knee:
./scripts/loadtest/run.sh https://concord-os.org
```

## Full harness (k6 — recommended)

Install k6 (`brew install k6`, `apt install k6`, or the docs). Then:

```bash
# Read + WebSocket ramp to 2000 VUs (find the connection + read knee):
BASE_URL=https://concord-os.org k6 run scripts/loadtest/k6-mix.js

# Lower the peaks on a small box:
BASE_URL=https://concord-os.org BROWSE_PEAK=500 WS_PEAK=500 \
  k6 run scripts/loadtest/k6-mix.js

# Soak (20m hold — surfaces memory leaks / WAL growth):
RAMP=soak BASE_URL=https://concord-os.org k6 run scripts/loadtest/k6-mix.js

# Spike (instant slam — tests cold-start / burst):
RAMP=spike BASE_URL=https://concord-os.org k6 run scripts/loadtest/k6-mix.js
```

### Opt-in write + chat scenarios

```bash
# 1. Provision a token pool (REAL accounts — prefer a staging URL):
node scripts/loadtest/setup-users.mjs --url https://concord-os.org -n 200 -o tokens.json

# 2. Run with the authed scenarios enabled:
ENABLE_CONCORDIA=1 ENABLE_CHAT=1 TOKENS_FILE=tokens.json \
  BASE_URL=https://concord-os.org k6 run scripts/loadtest/k6-mix.js

# Point the Concordia scenario at a specific macro (default discovery.trending):
ENABLE_CONCORDIA=1 CONCORDIA_DOMAIN=fishing CONCORDIA_MACRO=cast ...
```

## Reading the results

| Signal | What it tells you | Concord's expected wall |
|---|---|---|
| `concord_read_latency` p95 | Read path under browsing load | scales far — WAL + mmap; thousands |
| `concord_ws_connected` vs `_failed` | Connection/FD ceiling (the old crash) | tens of thousands after the ulimit fix |
| `concord_write_latency` p95 | SQLite single-writer pressure | the real architectural knee — watch this |
| `concord_chat_latency` / errors | LLM throughput | ~50–150 concurrent — Ollama-bound |

**Finding the knee:** in the per-stage k6 output, find the VU stage where p95
stops being flat and starts climbing. The stage *before* that jump is your safe
ceiling for that traffic type. Reads and WS should ramp clean to the top; the
write scenario is where you'll see the first real bend.

## Env reference (k6-mix.js)

| Env | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:5050` | Target server |
| `WS_URL` | derived from BASE_URL | WebSocket origin (ws://…) |
| `BROWSE_PEAK` | 2000 | Peak read VUs |
| `WS_PEAK` | 2000 | Peak held WS connections |
| `CONCORDIA_PEAK` | 200 | Peak authed writer VUs |
| `CHAT_PEAK` | 30 | Peak LLM chat VUs |
| `RAMP` | `normal` | `normal` \| `soak` \| `spike` |
| `ENABLE_CONCORDIA` | off | `1` to run authed writes |
| `ENABLE_CHAT` | off | `1` to run LLM chat |
| `TOKENS_FILE` | — | JSON token pool from setup-users.mjs |
