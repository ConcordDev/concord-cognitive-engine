# Godot World-Lens Integration

**Status: Phase 1 — Foundation (built, NOT mounted).** The gateway module, its
contract tests, and the Godot 4 client skeleton exist and are validated at the
levels stated below. Nothing is wired into `server/server.js` yet — the gateway
is dead code until the orchestrator performs the integration steps in the
[Integration TODO](#integration-todo). This is by design (honest-by-construction:
no half-mounted surface pretending to be live).

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

The apiKey path is only active if the integration injects `verifyApiKeyPair`.
Without it, an apiKey attempt returns an honest
`auth:error {reason:"api_key_auth_unavailable"}` — it never fabricates a session.

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

### Phase-2 (planned, NOT built)

- `player:move` at ≤30Hz with server ack/nack and snap-back on rejection.
- Server → client `city:positions` snapshots (~100Hz aggregate, ~100ms cadence)
  consumed by `snapshot_buffer.gd`.
- Per-client rate limiting (deferred — see below).

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

The orchestrator must perform these steps to make the gateway live. None of them
are done in Phase 1.

1. **Declare `ws` in `server/package.json` dependencies.** It is currently present
   at `server/node_modules/ws` (v8.21.0) only as a **transitive** dependency (via
   engine.io). The gateway imports it directly; a future `npm prune`/dedupe could
   remove it. Add `"ws": "^8.21.0"` explicitly. (Noted in a code comment at the
   top of `godot-gateway.js`.)
2. **Mount in `server.js`** after the TDZ-safe point (`app` at ~27554, HTTP server
   creation, and after `LENS_ACTIONS`):
   ```js
   import { mountGodotGateway } from "./lib/godot-gateway.js";
   const godotGateway = mountGodotGateway(httpServer, {
     verifyToken,                 // existing token verifier
     getUser: AuthDB.getUser,     // existing user lookup
     exportScene,                 // from ./lib/scene-export.js
     db: STATE.db,
   });
   ```
   The upgrade handler only claims `/godot-ws`, so it coexists with socket.io.
3. **Mirror `realtimeEmit` into Godot rooms** via `createGatewayEmitter(godotGateway)`
   — fan the existing `world:*` / `user:*` room emits into the gateway so Godot
   clients see the same world events the Three.js client does.
4. **Per-client rate limiting** (deferred from Phase 1 by design). A token bucket
   keyed on `client.userId` should gate the message handler at mount time. Marked
   with a comment in `handleMessage`.
5. **API-key auth path wiring** — inject `verifyApiKeyPair` built from
   `AuthDB.getAllApiKeys` + `verifyApiKey`, matching the socket.io auth mirror.
6. **Cookie auth is intentionally NOT wired** — the Godot client is a native
   process, not a browser; it authenticates with a bearer token or API key.

## Honest caveats

- `ws` is transitive-only until step 1 above.
- Rate limiting is not implemented in Phase 1.
- `_rid` is reserved but never populated on this path in Phase 1.
- The Godot project has never been opened in a real editor or renderer — validation
  is parse-and-lint-only. See `world-lens-godot/VISUAL_QA.md`.
- The gateway is dead code until mounted (steps 1–2).

## Reproduction commands

```bash
# Gateway contract tests (standalone, no boot):
cd server && node --test tests/godot-gateway.test.js

# GDScript parse + lint (requires: pip install gdtoolkit):
cd world-lens-godot && for f in $(find . -name '*.gd'); do gdparse "$f"; done && gdlint .
```
