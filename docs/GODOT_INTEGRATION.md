# Godot World-Lens Integration

**Status: Phase 3 — bidirectional, mounted, auth-complete.** The gateway is
mounted in `server/server.js` (`mountGodotGateway(server, ...)`, gated on
`if (server)`, right after `tryInitWebSockets`), mirrors `realtimeEmit` /
`emitToWorld` outbound into Godot rooms, dispatches inbound `player:move` /
`player:mode` frames through the same server-authoritative logic the
socket.io path uses, and accepts both bearer-token and real API-key auth. See
[Integration TODO](#integration-todo) for what's done vs. still open (rate
limiting per-client tuning, `combat:attack` dispatch).

---

## Why a native Godot client?

The Three.js world-lens (`concord-frontend/lib/world-lens/`) is excellent for a
browser surface, but a native engine buys us authoritative physics parity, GLB
asset pipelines, and desktop-class rendering. Phase 1 lays the **network
foundation** only — a raw-WebSocket gateway on the server side and a poll-loop
client skeleton on the Godot side.

## Key decisions

| Decision | Rationale |
|---|---|
| **Raw WebSocket gateway, not socket.io** | There is no production-grade GDScript socket.io client, and socket.io's engine.io framing (packet-type prefixes, ping/pong protocol, session negotiation) is an implementation detail we do not want to reimplement in GDScript. A plain `{evt, data}` JSON envelope over `WebSocketPeer` is trivially correct and testable. |
| **`noServer` WebSocketServer claiming only `/godot-ws`** | Lets the gateway coexist with the existing socket.io/engine.io upgrade handling. The gateway's `upgrade` listener inspects the path and **ignores** any upgrade that is not `/godot-ws` — it never touches another handler's socket. |
| **GDScript over C#** | Headless-CI parseability (`gdparse`/`gdlint` via `gdtoolkit`, no .NET toolchain), and the client logic is simple enough that static typing in GDScript suffices. |
| **Interpolation-first netcode** | The Three.js client renders entity positions at `now − 120ms` against ~100ms server snapshots. `net/snapshot_buffer.gd` mirrors that exactly (RENDER_DELAY_MS = 120), so both clients agree on interpolated positions. No client-side prediction in Phase 1. |
| **Dependency injection over imports** | `godot-gateway.js` imports nothing from `server.js`. Auth, user lookup, scene export, and the db handle are all injected. This is what makes the module unit-testable against a bare `http.createServer()` with stubs, and mountable later without editing this file. |
| **Native-process packaging (future)** | The Godot client ships as a native binary that connects to the Concord server over `wss://`. Cookie auth (browser-only) does not apply; the client authenticates with a bearer token or API key. |

## Protocol spec

### Envelope

Every frame in **both** directions is a JSON object:

```json
{ "evt": "<string>", "data": { ... } }
```

**Outbound** frames (server → client) enrich `data` with reserved fields that
mirror `realtimeEmit` / `event-shapes.js`:

- `ts` — ISO-8601 timestamp string.
- `_seq` — monotonic per-gateway sequence counter (mirrors `_eventSeqCounter`).
- `_evt` — the event name (redundant with the top-level `evt`, for parity with the socket.io payloads).
- `_rid` — **reserved but NOT populated in Phase 1.** There is no HTTP request to
  correlate a Godot socket frame against on this path yet. Listed as reserved so
  the client never treats it as domain data.

`event-shapes.js` already treats `ts, _seq, _rid, _evt` as `RESERVED`.

### Auth handshake (auth-first)

1. Client connects to `ws://host:port/godot-ws`.
2. Client's **first** message MUST be `{"evt":"auth","data":{"token":"<bearer>"}}`
   (or `{"data":{"apiKey":"..."}}`).
3. On success: server replies `hello {clientId, authenticated:true, userId, username}`
   and auto-joins the client to `user:<userId>`.
4. On failure: server replies `auth:error {reason}` then closes.
5. Any non-`auth` message before authenticating → `error {reason:"auth_required"}` + close.

**Close codes (honest):**

| Code | Meaning |
|---|---|
| `4401` | Auth failed / auth required (bad or missing credentials). |
| `4408` | Auth timeout — no `auth` frame within `authTimeoutMs` (default 10s). |
| `1009` | Frame exceeds `2× maxMessageBytes` (ws hard limit). Frames between our 64KB limit and 128KB get an honest `error {reason:"message_too_large"}` frame instead (connection survives). |
| `1001` | Gateway shutting down (`close()`). |

### API-key auth

**DONE (2026-07-23).** The mount call in `server.js` injects `verifyApiKeyPair`
— a closure over `AuthDB.getAllApiKeys()` + the same `verifyApiKey` hash
comparison the socket.io auth middleware uses (`server.js` ~line 9074-9088).
The two paths are call-for-call identical: iterate every active key hash,
`verifyApiKey(apiKey, keyData.keyHash)`, resolve `keyData.userId`. A real
`api_keys`-table key now authenticates a `/godot-ws` client exactly like it
authenticates a socket.io one. Covered end-to-end (mint a real key, connect,
`auth {apiKey}`, expect `hello`) by
`server/tests/godot-gateway-integration.test.js`. Without the injected
verifier (e.g. a bare standalone mount in the contract tests), an apiKey
attempt still returns an honest `auth:error {reason:"api_key_auth_unavailable"}`
— that fallback in `godot-gateway.js` itself is unchanged.

### Rooms

Room grammar: `^(world|user):[A-Za-z0-9_.\-]{1,64}$`.

- `room:join {room}` → `room:joined {room}` or `room:error {reason}`.
  - `invalid_room` — shape violation.
  - `forbidden_room` — a `user:<other>` join where `<other>` is not the client's own userId.
- `room:leave {room}` → `room:left {room}` (symmetric, cheap).
- `emitToRoom(room, evt, payload)` fans out to every OPEN socket in the room.
- `broadcast(evt, payload)` fans out to every **authenticated** OPEN socket.

### Scene transfer

- `scene:request {worldId}` → `scene:data <exportScene(db, worldId) result>`.
- The result is passed through **verbatim**, including honest `{ok:false, reason}`
  failures. The gateway never fabricates a scene.
- If `exportScene`/`db` were not injected → `scene:data {ok:false, reason:"scene_export_unavailable"}`.
- Format is `concord-scene/v1` (`server/lib/scene-export.js`): Y-up, `rotationY`
  in radians, `scale = [w, h, d]` footprint — which maps to Godot's Y-up
  convention directly (`world/scene_bootstrap.gd#node_to_transform`).

### Heartbeat

The gateway pings each socket every `heartbeatMs` (default 25s, matching
socket.io's default). A socket that has not `pong`ed since the last ping is
`terminate()`d. The interval is `.unref()`ed so it never keeps the process alive.

### Inbound dispatch (client → server)

**DONE (2026-07-23).** The mount call injects an `onClientMessage(client, evt,
data)` that routes recognized client→server frames through the SAME shared
core the socket.io `player:move`/`player:mode` handlers call
(`applyPlayerMove`/`applyPlayerMode`, declared at module scope in `server.js`
just above `tryInitWebSockets`) — not a separate or laxer copy of the logic.
Wired today:

- `player:move` → `cityPresence.updateUserPosition` (same reach/speed/
  teleport anti-cheat as the browser path) → `player:move:ack` /
  `player:move:nack` (with `shouldDisconnect` honored via `client.ws.close()`
  the same way the socket.io path calls `socket.disconnect(true)`).
- `player:mode` → the same walk/sprint/fly/mount/vehicle legitimacy gate
  (mount ownership via `getActiveMountPayload`, vehicle via
  `cityPresence.getUserVehicle`) → `player:mode:ack` / `player:mode:nack`.
- `room:join` / `room:leave` were already handled natively inside
  `godot-gateway.js`'s own `handleMessage` switch (world:*/user:* room grammar)
  and never reach `onClientMessage` at all.
- Anything else (notably **`combat:attack` — not wired**; see Honest caveats)
  gets an honest `error {reason:"unsupported_evt", evt}` — a more specific
  signal than the gateway's own generic `unknown_evt`, naming exactly what's
  missing instead of implying uniform non-support.

Covered end-to-end by `server/tests/godot-gateway-integration.test.js`: a real
ws client authenticates, sends `player:move` twice (first establishes a
baseline position and must ack; the second is an implausible ~1,271m jump
inside the world envelope and must nack with `teleport_detected` or
`speed_hack_detected`, with `prev` reflecting the last GOOD position — proof
cityPresence's real anti-cheat ran, not a stub), and a `player:mode` round
trip (legitimate `sprint` acks; an unowned `mount:*` claim nacks
`not_mounted`).

Server → client `city:positions` snapshots (~100Hz aggregate, ~100ms cadence)
consumed by `snapshot_buffer.gd` remain **NOT built** — the gateway mirrors
individual `realtimeEmit`/`emitToWorld` events, not a dedicated aggregate
snapshot stream.

### Per-client rate limiting

Built in Phase 1 as a generic per-client token bucket (`rateLimitPerSec`/
`rateLimitBurst`, keyed by `userId` once authenticated) gating `handleMessage`
for every event including `player:move`/`player:mode` — this is coarser than
the socket.io path's dedicated ~30Hz (33ms) `player:move`-specific gate, which
is a real (small) behavior difference: a Godot client's move-frame cadence is
capped by the generic 20/sec-sustained bucket rather than a move-specific
30Hz one. See Honest caveats.

## Files

| File | Role |
|---|---|
| `server/lib/godot-gateway.js` | The gateway module (DI, `noServer` WS, auth, rooms, scene passthrough, heartbeat, envelope). Exports `mountGodotGateway` + `createGatewayEmitter`. |
| `server/tests/godot-gateway.test.js` | 13 standalone contract tests (bare http server + stub deps + `ws` client). |
| `world-lens-godot/project.godot` | Godot 4.4 project config (forward+ renderer, `boot.tscn` main scene). |
| `world-lens-godot/scenes/boot.tscn` | Minimal text-format boot scene → `world/boot.gd`. |
| `world-lens-godot/world/boot.gd` | Thin entry point: wires GatewayClient signals, requests a scene. |
| `world-lens-godot/net/gateway_client.gd` | `WebSocketPeer` poll loop, backoff reconnect, pure-static envelope codec. |
| `world-lens-godot/net/snapshot_buffer.gd` | Pure `RefCounted` interpolation buffer (sample at now−120ms, shortest-arc heading lerp). |
| `world-lens-godot/world/scene_bootstrap.gd` | Consumes `concord-scene/v1`; pure-static transform mapper + BoxMesh placeholders. |
| `world-lens-godot/assets/glb_loader.gd` | HTTP GLB download → `GLTFDocument`, in-memory cache, honest failure signals. |
| `world-lens-godot/assets/asset_resolver.gd` | Resolve endpoint → `/models/{kind}/{id}.glb` static fallback. |

## Validation achieved

- **Server gateway:** `cd server && node --test tests/godot-gateway.test.js` →
  **13 pass / 0 fail** (12 numbered cases + one `scene_export_unavailable`
  sub-case). Reproducible; no repo boot or no-egress preload required (the module
  is standalone).
- **GDScript:** the official Godot 4.4 headless linux binary download from the
  `godotengine/godot` GitHub releases is **403-blocked by the agent proxy**, so
  engine-import validation was not possible. Fallback achieved:
  **`gdtoolkit` 4.5.0 `gdparse` — all 6 `.gd` files parse cleanly, and `gdlint`
  reports 0 problems.** This is **parse-and-lint-only validation**: the code is
  syntactically valid, loadable Godot 4 GDScript, but **has never been opened in
  a real editor or renderer.** All visual/runtime claims are queued in
  `world-lens-godot/VISUAL_QA.md`.
- `project.godot` and `boot.tscn` are INI-like text assets validated by eye only;
  they get true engine validation only under the (blocked) headless-import path.

## Integration TODO

1. **Declare `ws` in `server/package.json` dependencies.** — **still open.** It is
   currently present at `server/node_modules/ws` (v8.21.0) only as a
   **transitive** dependency (via engine.io). The gateway imports it directly; a
   future `npm prune`/dedupe could remove it. Add `"ws": "^8.21.0"` explicitly.
   (Noted in a code comment at the top of `godot-gateway.js`.) Not touched by
   this unit — out of scope, flagged again so it doesn't get lost.
2. **Mount in `server.js`** — **DONE.** Mounted after the TDZ-safe point (`server`
   itself created, `app` ~27554, `LENS_ACTIONS` ~36537 both long since declared),
   right after `tryInitWebSockets(server)`. Gated on `if (server)` — a
   `CONCORD_NO_LISTEN=true` / test-mode boot with no bound `http.Server` stays
   unmounted (honest: no listener, no gateway, never fabricated).
3. **Mirror `realtimeEmit` into Godot rooms** — **DONE**, via
   `createGatewayEmitter(godotGatewayHandle)` assigned to `_godotGatewayEmitter`
   at the mount site.
4. **Per-client rate limiting** — **DONE** (generic token bucket, built in Phase
   1 and live now that the gateway is mounted). **Not yet tuned** to mirror the
   socket.io path's move-specific ~30Hz gate — see the rate-limiting section
   above and Honest caveats.
5. **API-key auth path wiring** — **DONE.** `_godotVerifyApiKeyPair` (defined in
   `server.js` just above the mount block) is injected as `verifyApiKeyPair`;
   see the API-key auth section above.
6. **Inbound dispatch wiring** (this unit, 2026-07-23) — **DONE for
   `player:move`/`player:mode`.** `_onGodotClientMessage` is injected as
   `onClientMessage`; see the Inbound dispatch section above.
   **`combat:attack` is NOT wired** — see Honest caveats.
7. **Cookie auth is intentionally NOT wired** — the Godot client is a native
   process, not a browser; it authenticates with a bearer token or API key.
   Unchanged, by design.

## Honest caveats

- `ws` is still transitive-only (package.json declaration, item 1 above, is
  still open).
- `_rid` is reserved but never populated on this path.
- The Godot project has never been opened in a real editor or renderer — validation
  is parse-and-lint-only. See `world-lens-godot/VISUAL_QA.md`.
- **`combat:attack` has no gateway-side dispatch.** A Godot client sending it
  gets an honest `error {reason:"unsupported_evt", evt:"combat:attack"}` — never
  a fabricated hit result. The socket.io `combat:attack` handler
  (`server.js`, the `_attackCd`/`_newAttackCooldownState` region) was left
  untouched by this unit (a separate unit's committed code, out of scope here);
  wiring it would follow the exact same shared-core-extraction pattern used for
  `player:move`/`player:mode` in a future unit.
- **Godot-path rate limiting is coarser than the socket.io path's.** The
  socket.io handler gates `player:move` specifically at ~30Hz (33ms) per
  socket; the gateway's generic per-client token bucket (default 20/sec
  sustained, burst 30) covers ALL inbound events for a client, not a
  `player:move`-specific cadence. Functionally safe (still can't flood), but
  not byte-identical throughput tuning — a future pass could special-case
  `player:move` inside `_onGodotClientMessage` with its own 33ms gate to match
  exactly.
- The two shared-core functions (`applyPlayerMove`/`applyPlayerMode` in
  `server.js`) re-validate `userId`/`data` internally even though the socket.io
  wrapper already validated them before calling — intentional defense-in-depth
  so the functions are also safe to call directly from the gateway path, which
  has no equivalent pre-check.

## Reproduction commands

```bash
# Gateway contract tests (standalone, no boot):
cd server && node --test tests/godot-gateway.test.js

# Real-server integration tests (boots server.js for real, real ws client,
# real auth, real cityPresence anti-cheat — the mount + inbound-dispatch +
# apiKey-auth proof):
cd server && node --test tests/godot-gateway-integration.test.js

# GDScript parse + lint (requires: pip install gdtoolkit):
cd world-lens-godot && for f in $(find . -name '*.gd'); do gdparse "$f"; done && gdlint .
```
