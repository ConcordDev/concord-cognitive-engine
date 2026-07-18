# Browser Durability Audit — concord-os.org

**Date:** 2026-07-18 · Read-only audit (no code changed). Scope: will Concord, loaded
as a browser app at concord-os.org, stay connected mid-operation, is the frontend
actually pointed at the backend in production, and will a first-time visitor hit
"rookie" connectivity issues?

**Verdict up front:** the wiring is **unusually mature** — same-origin base URLs (no
mixed-content risk, no hardcoded prod localhost), axios timeout + backoff + idempotency
+ silent token refresh, a socket layer with an honest terminal-offline state machine and
a grace period, nginx SSE hardening, and two mounted "connection lost" banners. There is
**one genuinely likely "silently breaks" bug** — the socket permanently stops reconnecting
after ~5 attempts — plus a systemic **stale-after-reconnect** room gap. Both are small,
localized fixes. Details and file:line evidence below.

---

## PART 1 — Durability checklist (researched, cited)

Each item is a checkable assertion with its official-doc citation. Defaults/API names are
quoted from the source. Full URL list at the end of this section.

### 1. Socket.IO client — auto-reconnection
- [ ] Reconnection left enabled — `reconnection` defaults to `true`. [socket.io client-options]
- [ ] `reconnectionAttempts` default is **`Infinity`** — the client retries forever unless capped; a finite cap means it permanently stops after N failures and never recovers without a reload. [socket.io client-options]
- [ ] Backoff dials: `reconnectionDelay` `1000`ms, `reconnectionDelayMax` `5000`ms, `randomizationFactor` `0.5` — jittered so attempt 1 fires at 500–1500ms, 2 at 1000–3000ms, 3 at 2000–5000ms, preventing a thundering-herd reconnect after a server crash. [socket.io client-options]
- [ ] Reconnect lifecycle observed on the **Manager** (`socket.io.on('reconnect_attempt'|'reconnect'|'reconnect_error'|'reconnect_failed')`), while `connect`/`disconnect`/`connect_error` live on the socket. [socket.io client-api]
- [ ] `disconnect` reason inspected: `io server disconnect` requires a manual `socket.connect()`; `ping timeout`/`transport close`/`transport error` auto-reconnect. [socket.io client-socket-instance]
- [ ] Heartbeat defaults known: server `pingInterval` `25000`ms, `pingTimeout` `20000`ms; the client declares the connection dead if no PING arrives within `pingInterval + pingTimeout`. [socket.io how-it-works]
- [ ] Transport fallback intact — starts on HTTP long-polling then upgrades to WebSocket (`transports` default `["polling","websocket"]`, `upgrade` true); forcing websocket-only removes the polling fallback that survives restrictive proxies. [socket.io client-options / how-it-works]
- [ ] **Rooms are re-joined manually after reconnect** — "Upon disconnection, sockets leave all the channels they were part of automatically"; server room membership does not survive, so the app must re-`join` on `connect`/`reconnect`. [socket.io rooms]
- [ ] Per-attempt connection `timeout` set (default `20000`ms). [socket.io client-options]

### 2. Server-Sent Events (SSE)
- [ ] Rely on `EventSource` built-in reconnection — "if the connection… closes, the connection is restarted." [MDN Using SSE]
- [ ] Emit an `id:` per event so the browser resends **`Last-Event-ID`** on reconnect and the backend resumes with no gap/dup; tune reconnect delay via the `retry:` field. [MDN Using SSE]
- [ ] nginx must not buffer SSE — it buffers upstream by default (`proxy_buffering on`); set `proxy_buffering off;` (and backend sends `X-Accel-Buffering: no`). [nginx proxy_module; OneUptime SSE-nginx]
- [ ] Raise `proxy_read_timeout` above its **60s default**, or nginx kills the idle stream at 60s; use `proxy_http_version 1.1; proxy_cache off;`. [nginx proxy_module; OneUptime SSE-nginx]
- [ ] A dropped stream must surface (error/fallback), never hang the UI forever.

### 3. fetch / axios timeout + retry + idempotency
- [ ] Every request has an explicit timeout — **`fetch` has no built-in timeout** and hangs indefinitely; use `AbortSignal.timeout(ms)`. [MDN AbortSignal.timeout()]
- [ ] Retries use **exponential backoff with jitter** — Full Jitter `sleep = random(0, min(cap, base*2**attempt))` (AWS standard retry default). [AWS Exponential Backoff And Jitter]
- [ ] Only **safe/idempotent** methods auto-retried — GET/HEAD/OPTIONS safe; **POST/PATCH not guaranteed idempotent**, so a blind POST retry can double-execute. [MDN Idempotent]
- [ ] Retried POSTs carry a stable **`Idempotency-Key`**; server stores first result and returns it for repeats (with a TTL; Stripe keys expire in 24h and signal `Idempotent-Replayed: true`). [Stripe Idempotent requests]

### 4. Browser offline / online
- [ ] `navigator.onLine` + `online`/`offline` events drive UX **hints only**, not core logic — "connection to a LAN is considered online even without Internet"; MDN: "do not disable features based on online status, only provide hints." [MDN Navigator.onLine]
- [ ] Reconnect UX honest — "reconnecting…" banner on `disconnect`, optimistic-then-reconcile, confirmed by the real transport reconnect event, not `navigator.onLine` alone. [MDN Navigator.onLine]

### 5. Request cancellation on unmount
- [ ] Every in-flight fetch in a `useEffect` is tied to an `AbortController`; cleanup calls `controller.abort()` so an unmounted component can't set state on a late response. [MDN Using Fetch]

### 6. Token / session expiry mid-session
- [ ] A `401` triggers **one** silent refresh then replays the original request; concurrent 401s de-dupe behind a single refresh (refresh mutex), not a wall of failures. [MDN 401; RFC 6749 §6]
- [ ] A failed refresh logs out cleanly instead of retry-looping; the socket re-auths on reconnect via the `auth` option so a rotated token doesn't leave a stale socket. [RFC 6749 §6; socket.io client-options]

### 7. CORS + mixed content
- [ ] An **https** page never connects to `ws://` — WebSockets are active mixed content and are **blocked, not upgraded**; use `wss://`. Never issue `http://` fetch/XHR from https. [MDN Mixed content]
- [ ] Loopback (`http://127.0.0.1`/`localhost`) is the only mixed-content exception — dev only, never prod. [MDN Mixed content]
- [ ] Socket.IO server `cors` allowlists the SPA origin (the polling handshake is preflighted). [socket.io handling-cors]

### 8. Classic production footguns
- [ ] No hardcoded `localhost`/`127.0.0.1` base URLs in shipped bundles. [MDN Mixed content]
- [ ] `NEXT_PUBLIC_*` is **inlined at build time** — the value at `next build` ships; a runtime env change needs a rebuild. Same-origin empty base sidesteps it. [Next.js Environment Variables]
- [ ] WS survives proxy idle timeouts — nginx `proxy_read_timeout` (**default 60s**) applies to WS too and silently drops an idle socket at 60s; raise it (or rely on the 25s ping). [nginx websocket; nginx proxy_module]
- [ ] nginx WS proxy sends `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`. [nginx websocket]
- [ ] Node keeps HTTP keep-alive on for outbound backend calls to reuse TCP/TLS. [Node http.Agent keepAlive]

<details><summary>Citation URLs</summary>

- socket.io client-options — https://socket.io/docs/v4/client-options/
- socket.io client-api — https://socket.io/docs/v4/client-api/
- socket.io client-socket-instance — https://socket.io/docs/v4/client-socket-instance/
- socket.io how-it-works — https://socket.io/docs/v4/how-it-works/
- socket.io rooms — https://socket.io/docs/v4/rooms/
- socket.io handling-cors — https://socket.io/docs/v4/handling-cors/
- MDN Using SSE — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- nginx proxy_module — https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- nginx websocket — https://nginx.org/en/docs/http/websocket.html
- OneUptime SSE-nginx — https://oneuptime.com/blog/post/2025-12-16-server-sent-events-nginx/view
- MDN AbortSignal.timeout() — https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
- MDN Using Fetch — https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
- AWS Exponential Backoff And Jitter — https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- Stripe Idempotent requests — https://docs.stripe.com/api/idempotent_requests
- MDN Idempotent — https://developer.mozilla.org/en-US/docs/Glossary/Idempotent
- MDN Navigator.onLine — https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
- MDN 401 — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/401
- RFC 6749 §6 — https://datatracker.ietf.org/doc/html/rfc6749#section-6
- MDN Mixed content — https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
- Next.js Environment Variables — https://nextjs.org/docs/app/building-your-application/configuring/environment-variables
- Node http.Agent keepAlive — https://nodejs.org/api/http.html#new-agentoptions

</details>

---

## PART 2 — Concord's real wiring (evidence)

### A. API base-URL resolution — SOLID
`concord-frontend/lib/api/client.ts:30`
```
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
```
- In production `NEXT_PUBLIC_API_URL` is unset → **empty base → same-origin**. All `/api/*`
  calls go to the page's own origin (https at concord-os.org) and are proxied to the backend
  by nginx (`nginx/conf.d/default.conf:81` `location /api/`) or Next rewrites
  (`next.config.js:90` `rewrites()` → `BACKEND_URL || 'http://127.0.0.1:5050'`, server-side only).
- **No mixed-content risk:** same-origin inherits https → API is https, socket is wss.
  A full frontend `.ts/.tsx` grep found **no hardcoded `http://`/`ws://` in any runtime path**
  (only SVG `xmlns`, tests, and a *dev-gated* socket fallback — see B).
- Defensive: `client.ts:37-49` (FE-004) logs a visible console warning if the base points at
  localhost while the page is on a non-localhost host — catches a misconfigured prod build.
- Timeout: `client.ts:56` `timeout: 30000` — **no infinite hang** on hung requests.

### B. Socket base URL — SOLID, dev-safe
`concord-frontend/lib/realtime/socket.ts:18-27`
```
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV !== 'production' ? 'http://localhost:5050' : '');
```
- Prod → empty → same-origin → `/socket.io/` proxied by nginx (`default.conf:109`,
  `proxy_read_timeout 86400s`, Upgrade/Connection headers) or Next rewrite. wss inherited from
  the https page. The `http://localhost:5050` fallback is **NODE_ENV !== 'production' only** —
  it can never ship to concord-os.org, so no mixed content. This was a deliberately-handled
  footgun (the file comment documents the dev-only rationale).

### C. Socket reconnection — MOSTLY SOLID, one real gap
`concord-frontend/lib/realtime/socket.ts:129-139`
```
socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,          // ⚠️ FINITE — see Finding #1
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true,
  auth,
});
```
- Good: `reconnection: true`, transports fallback, `withCredentials` (httpOnly cookie auth
  survives reconnect), a 6s **connection-lost grace period** (`:69`) so a Wi-Fi blip doesn't
  wipe in-flight work, and a `reconnect_failed` diagnostic (`:189`).
- Good: honest terminal-state reducer `lib/realtime/connection-status.ts` — after
  `reconnect_failed` the UI shows **"Offline"** (gray), never an eternal "Connecting…".
- ⚠️ **Gap 1 — `reconnectionAttempts: 5`.** After ~5 attempts (~5–15s of outage) the socket.io
  Manager emits `reconnect_failed` and **permanently stops trying**. It does NOT resume when
  the network returns — the user must reload. socket.io's default is `Infinity`. See Finding #1.
- ⚠️ **Gap 2 — no room re-join on reconnect (generic path).** On `connect` (`:142`) the handler
  clears the lost-timer and resets sequence tracking but does **not** re-emit `room:join`.
  The generic hook `hooks/useLensRealtime.ts:77-84` joins rooms only in a mount effect; the
  spectate lens does the same (`app/lenses/spectate/[worldId]/page.tsx:138` `joinRoom(\`world:${worldId}\`)`)
  with no reconnect re-join. Since socket.io rooms are per-connection server-side, after ANY
  reconnect these lenses silently stop receiving room-scoped events while the pill still says
  "Live". *(Some components handle it correctly — `hooks/useWhiteboardCollab.ts` imports and
  uses `onReconnected` to re-join. The gap is the generic hook + direct joiners.)* See Finding #2.

### D. SSE / streaming resilience — SOLID
- nginx SSE hardening is present and correct: `default.conf:97-105`
  `proxy_read_timeout 3600s; proxy_buffering off; proxy_cache off; chunked_transfer_encoding off`,
  and the app sets `X-Accel-Buffering: no` + a 15s heartbeat (per the config comment) — so a
  live stream isn't buffered or idle-killed at the proxy (also survives Cloudflare's ~100s idle).
- Chat streaming (`app/lenses/chat/page.tsx:1360`) uses `fetch('/api/chat/stream', { signal:
  abortController.signal })` — **cancellable**, aborted on unmount and on each new send
  (`:1281`, `:1353`). A dropped/failed stream is caught (`:1425`) and **falls back to a buffered
  `POST /api/chat`** (`:1432`) — so a dropped stream never hangs the UI. Abort is distinguished
  from failure (`:1427`) so navigation doesn't trigger a spurious fallback.
- Minor: the stream fetch has an abort signal but **no idle-stall timeout** — if the socket
  stays open with zero bytes, `reader.read()` awaits indefinitely (mitigated by the nginx 15s
  heartbeat). Low severity — see Finding #3.

### E. Offline/online + reconnect UX — SOLID (mounted every page)
- `components/common/ConnectionStatus.tsx` — mounted in `components/shell/AppShell.tsx:260`
  (every page). Polls `/api/brain/health` every ~20s with `AbortSignal.timeout(5000)` and shows
  a top banner: **"Connection lost. Working offline with cached data."** / **"Showing cached
  data. Reconnecting…"**.
- `components/pwa/OfflineFallback.tsx` — mounted at `AppShell.tsx:346`; driven by real
  `navigator.onLine` + `online`/`offline` events; renders its own top strip when the browser
  goes offline. The two coordinate z-index/offset (ConnectionStatus drops below OfflineFallback).
- So a visitor whose connection drops **does** get a visible, honest surface — the app does not
  silently pretend to be live.

### F. Session / auth durability — SOLID
`concord-frontend/lib/api/client.ts`
- 401 mid-session → **one silent `POST /api/auth/refresh`** then replay of the original request
  (`:201-214`, guarded by `_authRetried` against loops). The 7-day access cookie refreshes off
  the 30-day refresh cookie without bouncing the user to login.
- Background GET 401s do **not** redirect (`:219-222`); expected auth-read 401/403 GETs are
  filtered out of the error counter (`:272-274`) so a not-yet-logged-in visitor walking around
  doesn't get a wall of red toasts. Only a denied mutation / real 5xx surfaces.
- CSRF token expiry → auto-refresh + single retry (`:163-183`). Toasts are throttled to ≤2
  (`:294-311`) so a burst of failures can't flood the UI.
- Transient 5xx (502/503/504) → exponential backoff retry 1s/2s/4s, 3 attempts (`:64-86`).
- Idempotency-Key auto-generated on mutations and **stable across retries** (guarded at
  `:118`), so retried POSTs are server-dedupable.

### G. Prod topology — CORRECT & https-safe
`docs/DEPLOYMENT_TOPOLOGY.md`: **Cloudflare tunnel → nginx (80/443) → Next (3000) + backend
(5050)**. nginx `default.conf`: HTTP→HTTPS 301 (`:13`), TLS 1.2/1.3, HSTS preload (`:42`), and
CSP `connect-src 'self' wss: ws:` (`:47`) — the socket scheme is explicitly allowed. Frontend
and backend are correctly pointed at each other via same-origin proxying; no cross-origin CORS
surface is exposed to the browser in the default topology.

---

## PART 3 — Prioritized "rookie issues" a concord-os.org visitor could hit

Ranked by **likelihood × severity**.

### 🔴 #1 — THE most likely "hits concord-os.org and it silently breaks" scenario: the realtime socket permanently gives up after a short outage
**What happens:** A visitor opens a lens (world, chat, notifications, any HUD). Their laptop
sleeps, their phone locks, or Wi-Fi/the Cloudflare tunnel flaps for **more than ~5–15 seconds**.
socket.io burns its 5 reconnection attempts, emits `reconnect_failed`, and **stops trying
forever**. When the network comes back, the socket does **not** reconnect on its own — realtime
HUDs, live tickers, chat streaming status, and push notifications stay dead until the user
manually reloads the page. The UI honestly flips to "Offline" (good), but it never self-heals
(bad). This is an extremely common real-world pattern (mobile, laptop sleep).
- **Likelihood:** High. **Severity:** High (silent, permanent, no self-recovery).
- **Evidence:** `concord-frontend/lib/realtime/socket.ts:132` `reconnectionAttempts: 5`.
- **Fix:** Set `reconnectionAttempts: Infinity` (the socket.io default for user apps) — keep the
  jittered backoff `reconnectionDelayMax` so it doesn't hammer. Optionally add a
  `window.addEventListener('online', () => getSocket().connect())` so a returning network forces
  an immediate reconnect even if the Manager had given up. Single file, ~2 lines.

### 🟠 #2 — Realtime goes stale after a reconnect (room membership lost) — "Live" but not live
**What happens:** Even within the 5-attempt window (transient blips that DO recover the socket),
the client never re-joins its app-level rooms. socket.io rooms are per-connection; after a
reconnect the world/collab/spectate lens shows a green "Live" pill but silently receives no more
room-scoped events (NPC bids, combat ticker, collab edits) until reload.
- **Likelihood:** Medium-High (every reconnect). **Severity:** Medium (dishonest "Live", stale data).
- **Evidence:** re-join is missing in `hooks/useLensRealtime.ts:77-84` and
  `app/lenses/spectate/[worldId]/page.tsx:138`; the socket `connect` handler
  (`lib/realtime/socket.ts:142`) doesn't replay joins. The correct pattern already exists in
  `hooks/useWhiteboardCollab.ts` (uses `onReconnected`).
- **Fix:** In `useLensRealtime`, subscribe to `onReconnected(() => rooms.forEach(joinRoom))`
  (and unsubscribe on unmount). Best structural fix: have the socket singleton remember joined
  rooms and re-emit them all in its own `connect` handler — fixes every consumer at once. Or
  enable server-side socket.io `connectionStateRecovery`.

### 🟡 #3 — Streaming chat can hang on a silently-stalled connection
**What happens:** The chat/ConKay stream reader (`app/lenses/chat/page.tsx:1383` `reader.read()`)
has no idle-stall watchdog. If the connection stays open but delivers zero bytes (half-open TCP,
a proxy holding the socket), the "typing…" state waits indefinitely. Mitigated by the nginx 15s
heartbeat, but there's no client-side idle timeout as a backstop.
- **Likelihood:** Low-Medium. **Severity:** Medium (one stuck message, recoverable by resend).
- **Fix:** Add an idle-timeout that aborts the stream controller if no chunk arrives within, e.g.,
  30–45s, letting the existing catch (`:1425`) fall back to the buffered POST.

### 🟡 #4 — 30s axios timeout can cut off very slow non-streaming LLM routes
**What happens:** Deep council/research/agent routes that run >30s on a non-streaming endpoint
abort client-side with "Something went wrong," even though the backend may still be working
(nginx allows 120s; Cloudflare ~100s). Streaming paths avoid this by emitting tokens early.
- **Likelihood:** Low. **Severity:** Low-Medium (UX, not a connectivity break — it fails visibly,
  not silently).
- **Evidence:** `lib/api/client.ts:56` `timeout: 30000`.
- **Fix:** Prefer streaming endpoints for long LLM work (already the norm for chat), or raise the
  per-request timeout for the few known-slow POSTs via axios per-call config.

### ✅ Explicitly checked and NOT a problem
- **No hardcoded prod localhost / mixed content.** Base URLs are empty-string same-origin in prod;
  the only `http://localhost:5050` is `NODE_ENV !== 'production'`-gated (`socket.ts:21`). Full
  `.ts/.tsx` grep found no `ws://`/`http://` in any runtime path. CSP allows `wss:` (`default.conf:47`).
- **No infinite fetch hangs on normal requests.** axios `timeout: 30000`; health check uses
  `AbortSignal.timeout(5000)`; streaming fetch is AbortController-cancellable with a POST fallback.
- **Session expiry is graceful.** Silent refresh + replay, loop-guarded, no redirect on background
  GETs, throttled toasts.
- **A dropped connection is visible.** ConnectionStatus + OfflineFallback banners are mounted on
  every page via AppShell.
- **nginx SSE + WS are correctly hardened** (buffering off, long read timeouts, Upgrade headers).

---

### One-line bottom line
Concord's browser durability is strong and clearly engineered on purpose; the single change that
most improves a first-time visitor's experience is flipping **`reconnectionAttempts: 5` →
`Infinity`** in `lib/realtime/socket.ts` (plus an `online`-event reconnect kick), followed by
re-joining rooms on reconnect in `useLensRealtime`.
