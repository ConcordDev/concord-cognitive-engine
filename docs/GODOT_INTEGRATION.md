# Godot World-Lens Integration

**Status: Phase 4 — bidirectional, mounted, auth-complete, combat wired.** The
gateway is mounted in `server/server.js` (`mountGodotGateway(server, ...)`,
gated on `if (server)`, right after `tryInitWebSockets`), mirrors `realtimeEmit`
/ `emitToWorld` outbound into Godot rooms (including the ~100ms `city:positions`
aggregate from `city-presence.js`), dispatches inbound `player:move` /
`player:mode` / `combat:attack` / `combat:dodge` through the same
server-authoritative logic the socket.io path uses, applies a move-specific
~30Hz (33ms) cadence gate matching the browser path, and accepts both
bearer-token and real API-key auth. See [Integration TODO](#integration-todo).

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

Server → client `city:positions` snapshots (~10Hz aggregate, ~100ms cadence)
are already produced by `city-presence.js#startPresenceBroadcast` and mirrored
into Godot `world:<id>` rooms via `realtimeEmit` → `_godotGatewayEmitter`.
`snapshot_buffer.gd` (RENDER_DELAY_MS=120) consumes them — no second
interpolation clock, no dedicated Godot-only aggregate stream.

### Per-client rate limiting

Two layers, matching the socket.io path:

1. **Generic token bucket** (Phase 1) — `rateLimitPerSec`/`rateLimitBurst`
   (default 20/s sustained, burst 30), keyed by `userId` once authenticated,
   gates every inbound frame in `handleMessage` (auth/room/scene/unknown).
2. **`player:move`-specific ~30Hz gate** (audit v4 proposal #2) —
   `lib/godot-move-rate.js` (`GODOT_MOVE_MIN_INTERVAL_MS = 33`), applied inside
   `_onGodotClientMessage` **before** `applyPlayerMove`. Silent drop on excess,
   same as the browser path's `_moveRateState`. Unit-tested in
   `tests/godot-move-rate.test.js`.

## Files

| File | Role |
|---|---|
| `server/lib/godot-gateway.js` | The gateway module (DI, `noServer` WS, auth, rooms, scene passthrough, heartbeat, envelope). Exports `mountGodotGateway` + `createGatewayEmitter`. |
| `server/tests/godot-gateway.test.js` | Standalone contract tests (bare http server + stub deps + `ws` client). |
| `server/lib/godot-move-rate.js` | `player:move` ~30Hz (33ms) cadence gate for the Godot path. |
| `server/tests/godot-move-rate.test.js` | Unit tests for the move-rate gate (injectable clock). |
| `world-lens-godot/project.godot` | Godot 4.4 project config (forward+ renderer, `boot.tscn` main scene). |
| `world-lens-godot/scenes/boot.tscn` | Minimal text-format boot scene → `world/boot.gd`. |
| `world-lens-godot/scenes/concordia-hub.tscn` | Hub level: Ring of Doors + eight embassy placeholders + Unburned Court; instances three-pillars. No combat colliders on hub ground. |
| `world-lens-godot/scenes/concordia-three-pillars.tscn` | Three Pillars tableau (LORE_BIBLE §1). Also under `server/godot/scenes/`. |
| `server/lib/scene-export.js` | `exportScene` adds hub tableau nodes + `scenePath` for `concordia-hub`. |
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

1. **Declare `ws` in `server/package.json` dependencies.** — **DONE.** Pinned as
   `"ws": "^8.21.2"` in `server/package.json` dependencies (matches the installed
   transitive). Gateway import is now an honest direct dependency.
2. **Mount in `server.js`** — **DONE.** Mounted after the TDZ-safe point (`server`
   itself created, `app` ~27554, `LENS_ACTIONS` ~36537 both long since declared),
   right after `tryInitWebSockets(server)`. Gated on `if (server)` — a
   `CONCORD_NO_LISTEN=true` / test-mode boot with no bound `http.Server` stays
   unmounted (honest: no listener, no gateway, never fabricated).
3. **Mirror `realtimeEmit` into Godot rooms** — **DONE**, via
   `createGatewayEmitter(godotGatewayHandle)` assigned to `_godotGatewayEmitter`
   at the mount site.
4. **Per-client rate limiting** — **DONE** (generic token bucket + move-specific
   ~30Hz gate). Generic bucket gates all inbound frames; `lib/godot-move-rate.js`
   (`GODOT_MOVE_MIN_INTERVAL_MS = 33`) gates `player:move` inside
   `_onGodotClientMessage` before `applyPlayerMove`, matching the socket.io
   path's `_moveRateState`. Covered by `tests/godot-move-rate.test.js`.
5. **API-key auth path wiring** — **DONE.** `_godotVerifyApiKeyPair` (defined in
   `server.js` just above the mount block) is injected as `verifyApiKeyPair`;
   see the API-key auth section above.
6. **Inbound dispatch wiring** — **DONE for `player:move`/`player:mode`/
   `combat:attack`/`combat:dodge`.** `_onGodotClientMessage` is injected as
   `onClientMessage` and routes combat through the same `cityPresence.applyAttack`
   / combat-limits primitives the socket.io path uses.
7. **Cookie auth is intentionally NOT wired** — the Godot client is a native
   process, not a browser; it authenticates with a bearer token or API key.
   Unchanged, by design.
8. **Client-side `_seq` gap detection + reconnect resync — DONE (R6).**
   `net/gateway_client.gd` tracks the highest `_seq` seen per-connection and
   emits `sequence_anomaly` on a genuine out-of-order/duplicate frame — but
   this is diagnostic-only, never the resync trigger, because `_seq` is a
   single counter shared across every client/room/event type
   (`godot-gateway.js`'s `send()` increments it once per socket write, not
   once per logical event), so it is real but genuinely non-contiguous per
   connection and cannot answer "how many events did I miss." The actual
   resync trigger is the reconnect itself: `world/boot.gd`'s
   `_on_authenticated` now replays every room the client had joined (not
   just the one hardcoded world room) and resets ConKay's one-shot presence
   state on every successful auth, including a reconnect — no new server
   protocol needed, since `scene:request` is already a full, idempotent
   snapshot and `city:positions`/`world:aerial-traffic` already self-heal on
   their own ~100ms/~15s broadcast cadence.
9. **Remote player rendering — DONE (R6).** `avatar/avatar_manager.gd`
   existed fully built and tested with **no live caller anywhere in this
   tree** until this unit (confirmed by grep; `aerial_traffic_controller.gd`
   itself documented the gap). Now mounted in `boot.gd` and fed from
   `city:positions` (filtered to the client's own world — the server
   broadcasts this globally across every active city/world, so an
   unfiltered ingest would render players from a different world). NOT fed
   from `city:npcs`: that broadcast was deliberately retired server-side
   (`city-presence.js` — the emit never had a listener on any transport,
   ever) — re-adding a client-side subscriber for an event the server no
   longer sends would be dead code, not a fix.
10. **First shippable milestone: read-only spectator viewer — DONE (R6).**
    `session/session_manager.gd` gained a fourth `Mode.SPECTATE` (WORLD<->
    SPECTATE is local-only, exactly like WORLD<->DESIGN_EDIT — there is no
    server-side "spectator session" concept on this gateway to ack/nack;
    the separate, pre-existing socket.io `server/lib/spectator.js` is an
    unrelated spectator-of-a-match concept). `spectator_mode`
    (`CONCORD_GODOT_SPECTATOR=true`) requests it the moment auth succeeds:
    a free-fly camera with no character body, driven by already-real,
    already-broadcast state — static geometry (`scene:request`), other
    players moving (item 9 above), and ambient air traffic (already wired).
    `session/camera_rig.gd`'s FREE_FLY/ORBIT mouse-look was also wired for
    real in this unit (`Input.MOUSE_MODE_CAPTURED` + `_unhandled_input`,
    plus scroll-wheel zoom via the already-existing but previously-uncalled
    `zoom_orbit()`) — it had been an honestly-stubbed `Vector2.ZERO` return
    before. Genuinely unverified, same as everything else in this project's
    camera/rendering surface: headless draws nothing and generates no real
    mouse events, so whether this feels right is a VISUAL_QA.md item, not
    something asserted here.

## Honest caveats

- `_rid` is reserved but never populated on this path.
- The Godot project has never been opened in a real editor or renderer — validation
  is parse-and-lint-only. See `world-lens-godot/VISUAL_QA.md`.
- Godot combat dispatch reuses `applyAttack` / combat-limits / glyph-spell-cap
  but does **not** reproduce every socket.io presentation layer (per-action
  attack cooldown state machine, stealth-backstab perception gate, refusal-field
  / Mass-Raid friendly-fire, companion-assist XP). Those are flagged in
  `_dispatchGodotCombatAttack`'s header rather than silently omitted.
- The two shared-core functions (`applyPlayerMove`/`applyPlayerMode` in
  `server.js`) re-validate `userId`/`data` internally even though the socket.io
  wrapper already validated them before calling — intentional defense-in-depth
  so the functions are also safe to call directly from the gateway path, which
  has no equivalent pre-check.
- `ws` is pinned in `server/package.json` (`"ws": "^8.21.2"`) — no longer
  transitive-only.

## One-command bare-metal boot (`scripts/launch-godot-client.sh`)

**Distinct from `concord-shell/` below** — that's a Tauri *desktop* package
for an end-user's own machine. This is the plain bare-metal **server** path
(`startup.sh` / `ecosystem.config.cjs`, the same one `pm2 start
ecosystem.config.cjs --env runpod` already boots backend + frontend with):
running `pm2 start ecosystem.config.cjs` now also starts a
`concord-godot-client` app that decides, at runtime, whether to launch a
connected Godot instance — so a single command gets Concord AND (where it
makes sense) a live Godot client, with no second manual step.

**`CONCORD_LAUNCH_GODOT`** (default `auto`):
- `auto` — launches only if a display is present (`$DISPLAY` or
  `$WAYLAND_DISPLAY` set). A headless GPU compute box with no monitor
  attached (the real A40 production target — see CLAUDE.md's GPU/CPU
  pinning audit) correctly does nothing here, rather than failing loudly.
- `1` / `true` / `on` — force-launches with `--headless` even with no
  display. Draws nothing (`RasterizerDummy` — docs/GODOT_RUNTIME.md §6),
  but proves the engine/project/gateway/auth pipeline is genuinely live
  end-to-end. A connectivity smoke test, not a rendering solution.
- `0` / `false` / `off` — never launches.

When the script decides not to launch, it idles via `sleep infinity` rather
than exiting — pm2 sees a stable "up" process instead of treating a correct
no-op as a crash-loop.

**Godot binary resolution** (honors an existing install per
docs/GODOT_RUNTIME.md §5.2 point 3): `$GODOT_BIN` if set and executable →
`godot` on `PATH` only if its `--version` matches the project's pinned
major.minor (version skew silently opens a project built for a different
engine version) → `.godot-runtime/bin/godot` (fetched by
`scripts/fetch-godot.mjs`, now wired into both `setup.sh` — first-time — and
`startup.sh` — a cheap `--check`/self-heal on every boot).

**Auth** — `net/gateway_client.gd` gained a second credential path
alongside the original bearer `auth_token`: `api_key`, sent as
`{"apiKey": ...}` (server/lib/godot-gateway.js#tryAuth already accepted this
shape; nothing on the client ever sent it). `world/boot.gd` now reads
`CONCORD_GATEWAY_URL` / `CONCORD_GODOT_API_KEY` / `CONCORD_GODOT_AUTH_TOKEN`
/ `CONCORD_WORLD_ID` from the environment at `_ready()` and overrides the
`@export` defaults when set — the only way to configure a non-interactive
launch before this, since those were editor-inspector-only fields. **This
script deliberately does not auto-provision a credential** — minting an
API key is an authz-relevant decision left to the operator (create one in
the app, then set `CONCORD_GODOT_API_KEY` in `.env`). Without one, the
client still launches (proving the engine/project are ready) but logs an
honest warning instead of a fabricated "connected".

Both `resolve_runtime_config` (boot.gd) and `build_auth_payload`
(gateway_client.gd) are pure static functions, unit-tested without a scene
tree or live socket — `world-lens-godot/tests/test_boot_runtime_config.gd`
(10 checks) and `test_gateway_client_auth.gd` (6 checks), registered in
`tests/run_all.gd`.

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

# Real engine execution (requires node scripts/fetch-godot.mjs first — see
# docs/GODOT_RUNTIME.md): full pure-logic test suite, incl. the two new
# one-command-boot suites above.
GD=$PWD/.godot-runtime/bin/godot
$GD --headless --path world-lens-godot --import
$GD --headless --path world-lens-godot --script res://tests/run_all.gd

# Exercise the one-command boot decision logic directly (no Godot binary
# needed for these three — pure bash branch checks):
CONCORD_LAUNCH_GODOT=0 bash scripts/launch-godot-client.sh            # idles immediately
env -u DISPLAY -u WAYLAND_DISPLAY bash scripts/launch-godot-client.sh  # auto + no display -> idles
CONCORD_LAUNCH_GODOT=1 bash scripts/launch-godot-client.sh             # forces --headless launch

# Desktop shell process-lifecycle tests (real, no display/GUI/Godot binary
# required — see the "Desktop packaging" section below):
cd concord-shell && cargo test -p concord-shell-supervisor -p concord-shell-health-probe -p concord-shell-core
```

## Desktop packaging (`concord-shell/`) — R8/CL4, Program B Phase 6

**Status: scaffolded and partially verified.** `concord-shell/` is a Tauri
project that launches and supervises BOTH `concord-frontend` (via its
existing `npm run dev`/`npm start` scripts — no reimplemented web server)
and a user-supplied Godot binary (pointed at `world-lens-godot/project.godot`)
as one packaged desktop app.

Honesty split (full ledger in `concord-shell/README.md`):

- **Genuinely compiled and tested in this repo's sandboxed authoring
  environment** (no display, no GTK/WebKit libs, no Godot binary): the
  bounded-restart/backoff process-lifecycle state machine
  (`concord-shell-supervisor`, 13 tests), a dependency-free TCP/HTTP health
  prober (`concord-shell-health-probe`, 8 tests against real local sockets),
  and — notably — the REAL process-orchestration glue
  (`concord-shell-core`, 6 tests) that actually spawns/kills/`try_wait`s
  child processes and reacts to crashes, run against real throwaway `sh`
  processes standing in for the frontend/Godot binaries. That crate was
  deliberately kept free of any `tauri` dependency specifically so it could
  be proven for real here, rather than only reviewed by eye.
- **Scaffolded, NOT built or run here**: the actual Tauri binary
  (`concord-shell/src-tauri`, package `concord-shell`) — `cargo check`
  reproducibly fails in this container at `gdk-sys`'s build script
  (`pkg-config` can't find `gdk-3.0`, i.e. no GTK3 dev libraries installed),
  which is expected and requires the Tauri prerequisites
  (https://v2.tauri.app/start/prerequisites/) on a real machine. The
  hand-authored `tauri.conf.json` is unvalidated by the actual Tauri CLI
  (not installed here; `cargo install tauri-cli` was attempted and did not
  finish in the available time budget) — treat its exact schema as a
  best-effort draft until `cargo tauri dev` is run for real.
- **Cross-runtime reconnect composition**: `world-lens-godot/net/gateway_client.gd`'s
  existing connection-level WebSocket backoff (built in an earlier unit,
  unchanged here) and the shell's OS-process-level supervisor answer
  different questions and don't duplicate each other — see
  `concord-shell/README.md`'s "Cross-runtime error recovery (G30)" section
  for the exact composition argument.

All real-machine verification (does a window open, does the Godot binary
actually launch and render, does killing it visibly trigger a shell-level
restart) is queued in `world-lens-godot/VISUAL_QA.md`'s new "Desktop shell"
section — nothing about the actual running app is asserted here.
