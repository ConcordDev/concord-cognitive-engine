# SSE Streaming Behind the Proxy Chain

Concordia streams chat tokens / logs / events over **Server-Sent Events**
(`text/event-stream`). It works on localhost but buffered-then-dumped and
~100s-dropped behind the production proxy chain (nginx → Cloudflare → RunPod).
Fixed in three layers.

## Layer 1 — server (done)
`server/lib/sse.js#startSSE(res)` is the one place every SSE endpoint sets up. It
sets the four proxy-chain-critical headers and a 15s heartbeat:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`  ← Cloudflare must not transform/compress
- `Connection: keep-alive`
- `X-Accel-Buffering: no`  ← **the critical one** — nginx must not buffer
- `:keepalive` comment every 15s → beats Cloudflare's ~100s idle drop; cleared on `close`.

Wired into all SSE endpoints: `server.js` (`/api/admin/logs/stream`), `guidance.js`
(`/api/events/stream`), `routes/chat.js` (×2), `routes/chat-agent-stream.js`,
`routes/mcp.js`. Tunable via `CONCORD_SSE_HEARTBEAT_MS` (default 15000). Test:
`server/tests/sse.test.js`.

## Layer 2 — nginx (done)
`nginx/conf.d/default.conf` `/api/` location: `proxy_buffering off` + `proxy_cache
off` + `chunked_transfer_encoding off` (let the app frame events) + `proxy_read_
timeout 3600s` (don't drop long streams at the nginx hop). The app's
`X-Accel-Buffering: no` is honored here.

## Layer 3 — the tunnel / edge (deploy)
- **Use a named / account-managed Cloudflare tunnel, NOT the quick
  `trycloudflare.com` one** — the quick tunnel buffers SSE entirely (events only
  flush on close) and caps at 200 reqs (cloudflared #1449). Named tunnels stream
  SSE correctly once Layers 1–2 are in place.
- Ensure no Cloudflare transform rule / Rocket Loader / compression rewrites
  `text/event-stream`.
- Free plan's ~100s edge timeout is mitigated by the Layer-1 heartbeat.

## Verify
```
curl -N -H 'Accept: text/event-stream' http://localhost:5050/api/events/stream
```
Tokens/events should arrive incrementally (not one lump); confirm
`X-Accel-Buffering: no` in the response headers; with no activity a `:keepalive`
arrives every ~15s and the stream survives past 100s. Repeat through the
nginx-proxied port and the named tunnel — still incremental, no 524 at >100s.

## Alternative — stream over the existing WebSocket
Concordia is already heavily socket.io-driven (~273 event types), and Cloudflare
tunnels carry WebSockets cleanly (none of the SSE buffering/timeout class).
Routing chat tokens over the socket channel (`chat:token` deltas + `chat:done`)
sidesteps the whole problem and reuses proxy-proven infra. Ship the SSE hardening
now (smaller change); keep WS as the documented migration if SSE friction recurs.
