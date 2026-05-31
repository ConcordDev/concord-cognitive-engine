# SSE Streaming Hardening — Concordia behind nginx + Cloudflare (Spec)

## 0. Thesis

Concordia streams chat tokens over **Server-Sent Events** (`text/event-stream`). It works on
localhost but **degrades behind the production proxy chain (nginx → Cloudflare → RunPod)**: the stream
gets buffered and flushed only at the end, and long/idle streams drop at ~100s. This is a real,
current production bug — not just a quick-tunnel quirk. This spec makes SSE survive the proxy chain
with a ~6-line server change + a few nginx lines + a named tunnel, and documents the WebSocket
alternative.

---

## 1. Current state (audited, server.js:55343)

```js
res.setHeader('Content-Type', 'text/event-stream');   // ✓
res.setHeader('Cache-Control', 'no-cache');            // ⚠  missing `no-transform`
res.setHeader('Connection', 'keep-alive');             // ✓
res.flushHeaders();                                    // ✓
// ✗ NO  X-Accel-Buffering: no   header
// ✗ NO  heartbeat / keep-alive  anywhere in the stream path
```

- nginx (`nginx/conf.d/default.conf`) already sets `proxy_buffering off` + `proxy_http_version 1.1`
  on some locations — but the SSE/`/api` location is missing `proxy_set_header Connection ''` and
  `chunked_transfer_encoding off`.
- No heartbeat exists in the SSE path (grep-confirmed).

**Symptoms in production:** chat output arrives in one lump at the end (nginx/Cloudflare buffering),
and idle or long generations drop with a 524/connection-reset (~100s Cloudflare timeout).

---

## 2. Why it breaks (the proxy chain)

| Layer | Failure without the fix | Source |
|---|---|---|
| **nginx** | buffers the whole `text/event-stream` response, flushes at end | needs `X-Accel-Buffering: no` + `proxy_buffering off` |
| **Cloudflare** | buffers SSE / may transform; drops connection silent for ~100s (524) | needs `no-transform` + a ≤30s heartbeat |
| **Cloudflare Quick Tunnel** (`trycloudflare.com`) | buffers SSE **entirely** — events only flush when the connection closes; also no SSE support + 200-req cap | use a **named/account tunnel**, not quick (cloudflared #1449) |
| **RunPod proxy** | may buffer like any reverse proxy | same headers apply end-to-end |

---

## 3. The fix — three layers

### Layer 1 — server (`server/server.js`, the SSE setup @ ~55343)
```js
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache, no-transform');   // + no-transform (CF must not transform)
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no');                   // ← THE critical add: nginx must not buffer
res.flushHeaders();

// Heartbeat: a comment line every 15s beats Cloudflare's ~100s idle drop.
const hb = setInterval(() => { try { res.write(':keepalive\n\n'); } catch { /* closed */ } }, 15000);
res.on('close', () => clearInterval(hb));
```
Apply to **every** `text/event-stream` endpoint (grep `text/event-stream` in `server/server.js` +
`server/guidance.js`). A shared `startSSE(res)` helper is the clean form — one place to set the four
headers + wire the heartbeat + register `close` cleanup.

### Layer 2 — nginx (`nginx/conf.d/default.conf`, the `/api/` location)
```nginx
location /api/ {
    proxy_http_version 1.1;
    proxy_set_header   Connection '';        # ← keep the upstream connection open
    proxy_buffering    off;
    proxy_cache        off;
    chunked_transfer_encoding off;           # ← let the app control framing
    proxy_read_timeout 3600s;                # don't time out long streams at the nginx hop
    # X-Accel-Buffering: no (set by the app) is honored here
}
```

### Layer 3 — the tunnel / edge
- **Named/account-managed Cloudflare tunnel**, not the quick `trycloudflare.com` one (quick buffers
  SSE entirely). Named tunnels stream SSE correctly once Layers 1–2 are in place.
- Ensure no Cloudflare **transform rule / Rocket Loader / compression** rewrites `text/event-stream`.
- On the free plan the ~100s timeout is mitigated by the heartbeat (Layer 1); paid plans allow longer
  edge timeouts but the heartbeat is still best practice.

---

## 4. The alternative: stream over the existing WebSocket

Concordia is already **heavily WebSocket-driven** (socket.io, ~273 event types). Cloudflare tunnels
carry WebSockets cleanly — none of the SSE buffering/timeout class. Routing chat tokens over the
existing socket channel (emit `chat:token` deltas, `chat:done`) **sidesteps this entire problem** and
reuses infra that's already proxy-proven.

- **Keep SSE** if you want the simpler one-way stream and don't mind the 3-layer hardening above.
- **Move to WS** if you'd rather stop fighting proxies; the socket layer already exists and is the
  more robust long-term path for a multiplayer real-time game.

Recommendation: ship the SSE hardening now (smaller change, unblocks prod + the browser audit), and
keep the WS path as the documented migration if SSE friction recurs.

---

## 5. REUSE-vs-BUILD

**REUSE:** the existing SSE endpoints (`server.js`, `guidance.js`), the existing nginx config (already
has `proxy_buffering off` on some blocks), the existing socket.io infrastructure (for the WS
alternative).

**BUILD:**
1. `startSSE(res)` helper in `server/lib/` — sets the four headers + heartbeat + close-cleanup; refactor
   each `text/event-stream` site to call it.
2. nginx `/api/` location additions (`Connection ''`, `chunked_transfer_encoding off`,
   `proxy_read_timeout`).
3. Deploy doc: named Cloudflare tunnel config (replaces quick tunnel for any SSE/stream/preview use).

No kill-switch needed (headers are additive + safe); the change is byte-compatible on localhost.

---

## 6. Verification

- **Local curl (must stream incrementally, not lump):**
  `curl -N -H 'Accept: text/event-stream' http://localhost:5050/<sse-endpoint>` — tokens should arrive
  as they generate, not all at once. Confirm `X-Accel-Buffering: no` in the response headers.
- **Heartbeat:** with no activity, a `:keepalive` comment arrives every ~15s; the stream survives past
  100s.
- **Through nginx:** repeat the curl against the nginx-proxied port — still incremental.
- **Through the named tunnel:** repeat against the `*.<domain>` tunnel URL — still incremental, no 524
  at >100s. (Quick tunnel will fail this — expected; that's why named.)
- **Browser audit (RunPod):** with the real headless-browser sweep (see
  `FRONTEND_RUNTIME_RUNBOOK` / the browser-audit plan), confirm the chat lens streams live rather than
  appearing to "hang then dump."
- **Regression:** localhost behavior unchanged; non-SSE routes unaffected.

---

## 7. The finding, restated

Concordia's SSE is missing **`X-Accel-Buffering: no`** and a **heartbeat**, and the nginx `/api/`
location is missing **`Connection ''`** + **`chunked_transfer_encoding off`** — so chat streaming
buffers and ~100s-drops behind the production proxy chain *today*, not only on the quick tunnel. The
fix is ~6 server lines + a few nginx lines + a named tunnel; the durable alternative is to stream over
the WebSocket channel that already exists.

**Sources:** [CF SSE + proxy](https://community.cloudflare.com/t/using-server-sent-events-sse-with-cloudflare-proxy/656279) ·
[CF buffering SSE streams](https://community.cloudflare.com/t/cloudflare-buffering-sse-streams/506921) ·
[~100s SSE timeout](https://community.cloudflare.com/t/server-side-events-sse-is-interrupted-in-approx-100s/424548) ·
[cloudflared quick-tunnel SSE buffering #1449](https://github.com/cloudflare/cloudflared/issues/1449) ·
[cloudflared SSE buffered #199](https://github.com/cloudflare/cloudflared/issues/199)
