# concord-ollama-proxy

Fail-fast reverse proxy in front of Ollama. One chokepoint for every brain call
with a hard connect timeout, a shared circuit breaker, and per-model admission
control — so a dead upstream (local Ollama down, or the A40 SSH tunnel wedged)
fails in **~2s** instead of piling up 45–120s hangs in `_llmQueue`.

Concurrency Refactor **Phase 4** — the failure mode behind the Sep 7–8 lockups.

## ⚠️ STATUS: BUILT + PROVEN, wired as an OPT-IN, not the default

Activation is gated on A40 return (**NEED_DUTCH**). Right now the A40 pod is down
and every brain points at Mac-local `:11434`, so the dead-*tunnel* case can't be
validated end-to-end on the live stack.

**To activate (2 steps):**
1. `cp engines/concord-ollama-proxy/com.concord.ollama-proxy.plist ~/Library/LaunchAgents/`
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concord.ollama-proxy.plist`
2. add `OLLAMA_PROXY_URL=http://127.0.0.1:11480` to `com.concord.backend`'s env,
   then `launchctl kickstart -k gui/$(id -u)/com.concord.backend`

`brain-config.js#_candidatesForBrain` then routes every local Ollama brain
(`pickBrainEndpoint`) through the proxy. Unset `OLLAMA_PROXY_URL` → unchanged.

The ~15 direct `fetch(OLLAMA_URL/...)` sites in `server.js` are **not** repointed
— that full cutover is the same A40-gated step.

## Behaviour

| Path | Treatment |
|---|---|
| `/api/chat`, `/api/generate`, `/api/embeddings`, `/v1/chat/completions` | circuit check → per-model admission → proxied with a 2s connect bound |
| everything else (`/api/tags`, `/api/show`, `/api/pull`, …) | transparent passthrough |

- **Connect timeout** `CONCORD_OLLAMA_PROXY_CONNECT_TIMEOUT_MS` (2000): a SYN-blackhole
  upstream fails here instead of at the OS default (~75s).
- **Circuit breaker** `..._BREAK_THRESHOLD` (5) consecutive upstream failures → OPEN
  for `..._BREAK_COOLDOWN_MS` (15000); one half-open probe recovers it. Open =
  instant `503 {"error":"upstream_circuit_open"}`, no connect attempt.
- **Per-model admission** `..._MAX_QUEUE_PER_MODEL` (24): instant
  `503 {"error":"queue_full"}` instead of unbounded queueing.
- **Generation timeout** `..._GEN_TIMEOUT_MS` (300000): the real generation can
  still take minutes once the connection is established.

`GET /v1/proxy-health` → breaker state, per-model queue depths, upstream probe.

## Proof

`node engines/concord-ollama-proxy/proof/run-proof.mjs` — upstream = SYN
blackhole, burst of 16 `/api/chat`:
- DIRECT `fetch(upstream)`: every request hangs ~10.5s (→ up to 300s in prod), 0 structured failures
- VIA PROXY: max 2.03s, all 16 fast-fail with a structured 503 the caller can react to

`~/.zuko/remaining-work/concord-ollama-proxy-proof.json`

## Build

```sh
cd engines/concord-ollama-proxy
GOFLAGS=-trimpath go build -ldflags="-s -w" -o bin/concord-ollama-proxy .
```
