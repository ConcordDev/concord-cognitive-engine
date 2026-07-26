# Godot Protocol Vocabulary (master-spec §8)

**Status: v0 — formalizes the vocabulary the master spec names; does not
build new transport.** `docs/GODOT_INTEGRATION.md` documents the envelope,
auth handshake, rooms, heartbeat, and the two message types the gateway
natively recognizes (`scene:request`/`scene:data`, `player:move`/
`player:mode`). This document is the sharper, per-message-type layer §8
asked for: the master spec names an explicit vocabulary —
`spawn_entity`/`despawn_entity`/`update_transform`/`play_effect`/
`cast_spell_visual`/`set_animation`/`apply_force`/`query_state`/`event`/
`load_district`/`design_command` — and each one is mapped below to either a
**real, already-firing Concord event/handler** (file:line cited) or marked
**PLANNED** with the concrete gap that would need closing. Nothing below is
invented protocol; every IMPLEMENTED row cites code that runs today.

Read this alongside `docs/GODOT_INTEGRATION.md` (transport/envelope/auth) —
this doc is about *what the payloads mean*, not how they're framed.

## How to read the status column

- **IMPLEMENTED** — the real Concord event/handler exists, fires in
  production code today, and — for server→client types — is mirrored into
  Godot's `world:*`/`user:*` rooms by the existing `realtimeEmit`/
  `emitToWorld` → `_godotGatewayEmitter` bridge (`server.js:8606-8825`,
  `server/lib/godot-gateway.js#createGatewayEmitter`). For client→server
  types, IMPLEMENTED means the gateway's `onClientMessage` dispatch
  (`server.js:_onGodotClientMessage`, ~line 65943) actually routes it through
  shared server-authoritative logic.
- **PARTIAL** — the real Concord event exists and fires, but takes a path
  that **bypasses** the Godot mirror today (a direct `io.to(...).emit(...)`
  call instead of `realtimeEmit`/`emitToWorld`), so a connected Godot client
  currently receives nothing on this channel even though the web client
  does. This is a real, nameable gap — the fix is routing the emit site
  through `emitToWorld`/`realtimeEmit` instead of `io.to()` directly, not
  building new protocol.
- **PLANNED** — no real Concord event/handler corresponds to this vocabulary
  item yet. The row names the nearest existing substrate (if any) a future
  unit would build on.

## Summary table

| Vocabulary item | Direction | Status | Maps to |
|---|---|---|---|
| `spawn_entity` | server→client | PLANNED | nearest real analog: `companion:deployed` (`server/routes/companions.js:70`) — narrow, one entity kind |
| `despawn_entity` | server→client | PLANNED | no real Concord event names an entity leaving a scene |
| `update_transform` | server→client | IMPLEMENTED | `city:positions` / `city:npcs` (`server/lib/city-presence.js:1077,1287`); also `world:aerial-traffic` (C16, `server/emergent/aerial-traffic-cycle.js`) |
| `play_effect` | server→client | PARTIAL | `combat:polish` (`server/lib/combat-polish.js:599`) — real, but bypasses the Godot mirror |
| `cast_spell_visual` | server→client | PLANNED | nearest real analog: `combat:hit`'s optional `element`/`skillId` fields (`server/lib/event-shapes.js`) — no dedicated cast event |
| `set_animation` | server→client | IMPLEMENTED (folded into `update_transform`) | `city:positions.users[].action`/`.mode`, `city:npcs.npcs[].currentAnimation` |
| `apply_force` | server→client | PARTIAL | `combat:impact`'s `impactMomentum`/knockback fields (`server/lib/combat/impact-feel.js`) — real, but bypasses the Godot mirror |
| `query_state` | client→server | PARTIAL | only `scene:request` exists; no general state-query verb |
| `event` (generic) | server→client | IMPLEMENTED (this IS the envelope) | every frame is already `{evt, data}` — see `docs/GODOT_INTEGRATION.md` |
| `load_district` | client→server / server→client | PARTIAL | district geometry exists and is exportable (`scenebridge.map`, `exportScene`'s `districts`/`plaza` fields) but there is no streaming *control* verb yet |
| `design_command` | client→server | PARTIAL (first slice landed 2026-07-23) | `_onGodotClientMessage`'s `"design_command"` case (`server/server.js`, case added ~line 66234) routes a curated 4-action allow-list — `game-create`/`entity-add`/`level-create`/`building-publish` — through the SAME `LENS_ACTIONS`/`MACROS` resolution `/api/lens/run` uses, into real `server/domains/gamedesign.js` handlers. The other ~36 macros in that file (`level-object-*`, `level-paint*`, `gdd-*`, `loop-*`, `narrative-*`, `asset-*`, `behavior-*`, `collab-*`, etc.) are still unreached — see §11 below for exactly what changed and what D18 still needs. |

---

## 1. `spawn_entity` — PLANNED

**Intent (spec):** tell a connected client a new entity (NPC, creature,
companion, procgen-region marker, ...) now exists in the world and should be
rendered.

**What's real today:** Concord has exactly one narrow "an entity now exists
for you" event: `companion:deployed` —

```json
{ "evt": "companion:deployed", "data": { "ownerId": "...", "companionId": "...", "worldId": "concordia-hub", "ts": "...", "_seq": 123, "_evt": "companion:deployed" } }
```

fired from `server/routes/companions.js:70` via plain `realtimeEmit(...)`
with no scope option (global broadcast, not room-scoped) — so it **is**
mirrored to every authenticated Godot client via the `broadcast()` path in
`_godotGatewayEmitter`, but it only covers companions, not NPCs/creatures/
fauna/procgen regions. `world:region-spawned` (`server/lib/procgen-regions.js:107`)
is a closer conceptual match ("a new thing appeared in the world") but its
emit site uses `globalThis.__CONCORD_REALTIME__.io.to(...)` directly, not
`realtimeEmit`/`emitToWorld` — see the `load_district`/PARTIAL pattern below;
it does **not** reach the Godot gateway today.

**Gap to close (future unit, not this one):** a single `spawn_entity`
envelope — `{ entityId, kind, worldId, transform, appearance? }` — would need
either (a) a new emit site wrapping the existing spawn call sites (fauna
spawner, NPC spawner, procgen regions, companion deploy) in a common
`emitToWorld("spawn_entity", {...})` call, or (b) the gateway declaring
`spawn_entity`/`despawn_entity` as *its own* mapping over the existing
per-domain events (companion:deployed → spawn_entity kind:"companion", etc.)
so Concord's domain-specific event names stay unchanged and Godot gets one
uniform vocabulary. Either is a real, scoped follow-on — not built here.

## 2. `despawn_entity` — PLANNED

No real Concord event names "this entity is gone" in a general sense. The
nearest partial analogs are domain-specific and don't fire a realtime event
at all today: `dismissCompanion` (`server/routes/companions.js`, the
`/dismiss` route) mutates state but does not `realtimeEmit`; `world_buildings`
transitioning to `state: "collapsed"` (Geo-Mod-light,
`server/lib/embodied/skill-environment.js#applyStructuralStress`) emits
`world:building-state` via a direct `io.to(...)` call (PARTIAL — see
`play_effect` for the pattern), which is the closest thing to "this object is
gone" for a building, not a general entity. No unit built a general
despawn broadcast; flagged honestly as fully PLANNED.

## 3. `update_transform` — IMPLEMENTED

This is the one vocabulary item with full, high-frequency, already-mirrored
coverage — it's the periodic position/pose broadcast the whole
interpolation netcode is built on.

**Player positions** — `city:positions`, `server/lib/city-presence.js:1077`
(`broadcastPositions`, ~100ms cadence, called from `startPresenceBroadcast`
at `:1108`):

```json
{
  "evt": "city:positions",
  "data": {
    "cityId": "concordia-central",
    "chunk": { "x": 3, "z": -1 },
    "users": [
      { "userId": "u1", "x": 12.4, "y": 0, "z": -8.1, "direction": 1.57, "action": "walk", "locomotion": "run", "avatar": {...}, "vehicleId": null, "vehicleType": null, "mode": "walk", "displayName": "u1" }
    ],
    "timestamp": "2026-07-23T...",
    "ts": "...", "_seq": 1, "_evt": "city:positions"
  }
}
```

**NPC positions** — `city:npcs`, `server/lib/city-presence.js:1287`
(per-chunk, same cadence family):

```json
{
  "evt": "city:npcs",
  "data": {
    "cityId": "concordia-central",
    "chunk": { "x": 3, "z": -1 },
    "npcs": [
      { "npcId": "n1", "x": 10, "y": 0, "z": 5, "direction": 0.2, "currentAnimation": "idle", "health": 100, "maxHealth": 100, "isHostile": false, "appearance": {...} }
    ]
  }
}
```

Both are fired via `realtimeEmit(event, payload)` with no scope options,
which hits the global `broadcast()` branch in `realtimeEmit`
(`server.js:8811-8816`) — **every authenticated Godot client receives every
chunk's positions**, not just the ones near it (no per-room scoping by
chunk/world today; this matches the existing web-client behavior, not a
Godot-specific gap). `snapshot_buffer.gd` (`world-lens-godot/net/`) is the
client-side consumer, sampling at `now − 120ms` to match the Three.js
client's render delay (`docs/GODOT_INTEGRATION.md`'s "Interpolation-first
netcode" decision).

**Client→server direction** (the other half of `update_transform`):
`player:move` is real, IMPLEMENTED end-to-end — `_onGodotClientMessage`
(`server.js`, ~line 65943, case `"player:move"`) calls the SAME
`applyPlayerMove(userId, data)` the socket.io path calls
(`server.js:8860`), which runs the real `cityPresence.updateUserPosition`
anti-cheat (reach/speed/teleport checks) and replies `player:move:ack` /
`player:move:nack` — covered end-to-end by
`server/tests/godot-gateway-integration.test.js`. Input shape:

```json
{ "evt": "player:move", "data": { "cityId": "concordia-central", "x": 12.4, "y": 0, "z": -8.1, "direction": 1.57, "rotation": 0, "action": "walk", "currentAnimation": "walk", "districtId": "concordia-hub:plaza" } }
```

**A third `update_transform` instance (C16, this revision): `world:aerial-traffic`.**
`server/emergent/aerial-traffic-cycle.js` (a real heartbeat, `registerHeartbeat`'d
at `frequency: 1` — every due governor tick, ~15s) advances a small in-memory
fleet of unowned ambient background air entities per active world (the
`crosswind-courier` flavor, grounded in the real Crosswind Couriers
faction/NPC already authored in `content/world/concordia-hub/{factions,
npcs}.json` — see `server/lib/aerial-traffic.js`'s header) flying real
closed-loop routes between the world's real landing pads
(`landingPadsForWorld`, falling back to district centroids —
`server/lib/districts.js` — for a world with no authored pads; a world with
neither gets an honest empty route and no traffic, never fabricated
geometry). Position is a pure, deterministic function of `(route, speedMps,
startedAtMs, now)` — see `positionAtTime()` — so the same inputs always
produce the same output. Broadcast, world-scoped, via the SAME Godot-mirror
pattern `combat:polish` and the `combat:impact` NPC-route emit already use
(`globalThis._concordEmitToWorld`, falling back to a bare `io.to()` when
the gateway hook isn't present):

```json
{
  "evt": "world:aerial-traffic",
  "data": {
    "worldId": "concordia-hub",
    "routeSource": "landing_pads",
    "entities": [
      { "id": "aerial:concordia-hub:0:1721...", "kind": "crosswind-courier", "x": 139.5, "y": 60, "z": -248.9, "heading": 1.219 }
    ]
  }
}
```

Shape pinned at `server/lib/event-shapes.js`'s `"world:aerial-traffic"`
entry. Client-side consumer: `world-lens-godot/world/
aerial_traffic_controller.gd` — reuses `snapshot_buffer.gd` UNCHANGED (the
same class `avatar_manager.gd` uses for `city:positions`/`city:npcs`), and
follows the SAME implicit-despawn convention those two events already
established: there is no dedicated `despawn_entity` message (see §2 below,
still PLANNED) — an id absent from a fresh snapshot for long enough is
treated as gone client-side, not signaled by the server. Wired end-to-end
in `world/boot.gd` (mounted, routed on `evt == "world:aerial-traffic"`).
Honest, queued-for-real-hardware caveat: the ~15s broadcast cadence is far
coarser than `SnapshotBuffer`'s `RENDER_DELAY_MS=120`/`MAX_HORIZON_MS=250`
were tuned for (~100ms city:positions cadence); see
`world-lens-godot/VISUAL_QA.md`'s "Ambient aerial traffic" entry for the
full honest accounting of what that means visually and has NOT been
verified.

## 4. `play_effect` — PARTIAL

The intent (a fire-and-forget VFX/audio/camera-shake cue keyed to a real
gameplay event) is already real Concord infrastructure — it's just not
wired to reach a Godot client yet.

`combat:polish` (`server/lib/combat-polish.js#emitCombatEvent`, emit call at
line 599) is the actual generic "something happened, play the effect for it"
channel the web client's animation/audio/camera bridges already consume:

```json
{ "evt": "combat:polish", "data": { "id": "...", "worldId": "concordia-hub", "actorKind": "player", "actorId": "u1", "eventKind": "rocked", "detail": { ... }, "ts": 1721... } }
```

`server/lib/event-shapes.js:173` pins its shape (`required: ["id","worldId",
"actorKind","actorId","eventKind"]`, free-form `detail`). **The gap:** the
emit site calls `io.to(`world:${worldId}`).emit("combat:polish", payload)`
directly (`combat-polish.js:599`) instead of `emitToWorld(worldId,
"combat:polish", payload)` — so it never passes through the
`_godotGatewayEmitter?.emitToRoom(...)` mirror `emitToWorld` provides
(`server.js:8730-8732`). A connected Godot client today receives **zero**
`combat:polish` frames, while a browser client receives every one. The fix
is a one-line change at the emit site (swap the direct `io.to()` call for
`emitToWorld`), not a new vocabulary item — `combat:polish`'s existing shape
already **is** `play_effect`.

## 5. `cast_spell_visual` — PLANNED

No dedicated "a spell was cast, render its visual" event exists. The closest
real substrate: `combat:hit`'s optional `element`/`skillId`/`skillKey`/`tier`/
`style` fields (`server/lib/event-shapes.js` — `combat:hit` shape) already
carry enough information for a client to *infer* an elemental effect on a
landed hit, and the server-side glyph-spell damage clamp
(`server/lib/combat/glyph-spell-cap.js`, wired into the `combat:attack`
handler per the 1E-1/2 Wave-1 unit) is the real authority on spell damage —
but neither path emits a dedicated pre-impact "cast" visual cue (windup,
projectile travel, impact VFX keyed by spell recipe). Building
`cast_spell_visual` would mean a new emit site at the glyph-spell cast path
(`server/lib/glyph-spells.js`/the `combat:attack` handler) carrying
`{ casterId, spellId, element, componentChain, targetPosition }` — not
built here.

## 6. `set_animation` — IMPLEMENTED (folded into `update_transform`)

Concord does not have a standalone `set_animation` event; animation state is
carried as fields *inside* the transform snapshots documented under
`update_transform`, above:

- `city:positions.users[].action` — a free-text action tag (`"walk"`,
  `"idle"`, ...) self-reported by the sender, and `.mode` (Godot Phase 3a
  additive field — `"walk"`/`"sprint"`/`"fly"`/`"mount:<species>"`/
  `"vehicle:<type>"`, `server/lib/city-presence.js`).
- `city:positions.users[].locomotion` — **R5 continuation, additive.**
  Server-authoritative `"idle"`/`"walk"`/`"run"` label, derived from the
  server's own per-packet speed (position delta / server wall-clock dt —
  never the sender's self-reported `.action`) via
  `classifyLocomotion()`/`getNearbyUsers()` in `server/lib/city-presence.js`.
  This closes a real gap the note below used to describe: `.action` alone
  was either hardcoded (`"walk"`, always, on the web client — the field
  documents a *label*, not a live signal) or, on the pre-this-unit Godot
  client, only ever idle/walk (no sprint input existed at all). `.locomotion`
  is ground truth regardless of what a sender's own `.action` claims;
  `world-lens-godot/avatar/animation_state_machine.gd`'s `select_state`
  prefers it (`locomotion_hint` input key) over its own inferred-from-
  interpolated-velocity classification when present, falling back to
  inference for NPC snapshots (`city:npcs`, no `.locomotion` field) or an
  older server. Hysteresis (a 1.5 m/s band around the run/walk boundary,
  matching the animation state machine's own `BLEND_BAND`) prevents the
  label from flapping on packet-to-packet speed jitter.
- `city:npcs.npcs[].currentAnimation` (`server/lib/city-presence.js`, the
  NPC broadcast builder).

This is an honest design choice already made by the existing snapshot
protocol, not a gap: baking animation state into the same periodic snapshot
that carries position means the client never has to reconcile two separate
event streams for one entity's pose. A future `design_command`/authoring
surface that wants to trigger a *one-shot* animation outside the periodic
snapshot (an emote, a cutscene beat) would still be new protocol — flagged
here so it isn't silently assumed covered.

## 7. `apply_force` — PARTIAL

Real, physically-grounded knockback/impulse data already exists —
`server/lib/combat/impact-feel.js` computes a `knockback` magnitude (+
`knockMs` duration) per poise severity (`flinch`/`rocked`/`knockdown`,
lines 33-36), fed from the server-authoritative impact-momentum calculation
(`server/lib/combat-impact.js`). It's broadcast on `combat:impact`:

```json
{ "evt": "combat:impact", "data": { "attackerId": "...", "targetId": "...", "severity": "rocked", "feel": {...}, "impactMomentum": 12.4, "vfx": {...}, "worldId": "concordia-hub" } }
```

(shape pinned at `server/lib/event-shapes.js:348`). **The gap is the same
class as `play_effect`:** the socket PvP path emits it via
`realtimeEmit("combat:impact", ...)` at `server.js:9883` (no scope options —
hits the global `broadcast()` branch, so this one actually **IS** mirrored
to Godot), but the separate NPC/world-route path at
`server/routes/worlds.js:2795` emits via `io.to(`world:${worldId}`).emit(...)`
directly — bypassing the mirror for that call site. So `apply_force` is
real and *partially* reaching Godot today (PvP hits do, NPC/world-route hits
don't) depending on which of the two `combat:impact` emit sites fired.
Closing the gap is the same one-line fix pattern as `play_effect`: route
`routes/worlds.js:2795`'s emit through `emitToWorld` instead of `io.to()`.

## 8. `query_state` — PARTIAL

The gateway supports exactly one query verb today: `scene:request {worldId}`
→ `scene:data <exportScene(db, worldId) result>` (`server/lib/godot-gateway.js`,
case `"scene:request"`, ~line 311). This is real, tested, and passes through
verbatim including honest `{ok:false, reason}` failures — never a fabricated
scene. There is no general `query_state {kind, id}` verb for anything else
(a district's current state, a building's health, a player's inventory) —
today, a Godot client would need domain-specific REST calls
(`POST /api/lens/run`, as `dtu_prop_interaction.gd` already does for DTU
props) rather than a gateway query frame. Building a general `query_state`
would mean adding cases to `handleMessage`'s switch
(`server/lib/godot-gateway.js`) that proxy into existing read macros
(`scenebridge.stats`, `scenebridge.map`, etc.) the same way `scene:request`
proxies into `exportScene` — a real, scoped, disjoint follow-on.

## 9. `event` (generic) — IMPLEMENTED

This is not a distinct message type to build — it **is** the envelope every
frame already uses. Every gateway frame in both directions is
`{ evt: "<string>", data: { ... } }` (`server/lib/godot-gateway.js#send`,
`docs/GODOT_INTEGRATION.md`'s "Envelope" section). Outbound frames carry
`ts`/`_seq`/`_evt` (mirroring `realtimeEmit`'s reserved fields per
`event-shapes.js`'s `RESERVED` set); `_rid` is reserved but not populated on
this path (no HTTP request to correlate a Godot frame against yet). Any of
the ~84 events in `EVENT_SHAPES` (`server/lib/event-shapes.js`) that reach
`realtimeEmit`/`emitToWorld` already flow through this generic envelope with
no additional protocol work — the vocabulary items above are about *specific,
named* payload shapes worth documenting individually, not about needing a
new "can I send an event" mechanism.

## 10. `load_district` (streaming control) — PARTIAL

District *data* is real and exportable — migration 374's `districts` table
(`server/lib/districts.js`) carries real boundary polygons, palettes, and
lighting tags per district, and both `exportScene`'s additive `districts`
array (`server/lib/scene-export.js`) and the new `scenebridge.map` macro
(`server/domains/scenebridge.js`, this unit) expose it. What does **not**
exist yet is a streaming *control* verb — a client saying "I'm entering
district X, start streaming its chunks" or the server proactively pushing
"you're near district Y's boundary, prefetch it." Today a Godot client can
only pull the whole scene via `scene:request` (all buildings for a world in
one shot) or the new directory via a `scenebridge.map` macro call over REST
— there is no partial/incremental "load just this district" request, and no
server-initiated streaming-hint push. This maps directly to Program B
Phase 2's "chunk streaming + LOD + MultiMesh in Godot" and F25 "District
streaming policy" — both still queued. Building `load_district` as a real
gateway verb would be:
`{ evt: "load_district", data: { worldId, districtId } }` (client→server) →
server replies with a **districted subset** of `exportScene`'s nodes (filter
`extras.district_id === districtId`, which already exists on every node per
the A3/A4 purposeful-building wiring) — a small, well-scoped follow-on, not
built here.

## 11. `design_command` (Game Design Lens authoring channel) — PARTIAL (first slice landed)

This is explicitly Phase 4 scope (D17-D21 in the master-spec backlog). A
**first slice** landed 2026-07-23 — the wiring question this section used to
call PLANNED is now real, but bounded: `game-design` (`server/domains/
gamedesign.js`) registers ~40 authoring macros over a real level/entity/
mechanic data model, and this slice reaches exactly **4** of them through a
curated allow-list, not the whole surface.

**What's wired:** `_onGodotClientMessage` (`server/server.js`, case
`"design_command"`, added ~line 66234) reads `{action, params}` off the
incoming frame, checks `action` against `DESIGN_COMMAND_ACTIONS` (a `Set` —
`game-create`, `entity-add`, `level-create`, `building-publish`), and on a
match calls the SAME two-step resolution `/api/lens/run` uses — prefer
`LENS_ACTIONS.get("game-design.<action>")`, fall back to `MACROS.get
("game-design")?.get(action)` via `runMacro` — through a new shared helper,
`_dispatchDesignCommand`. The result comes back to the client as a
`design_command:result` frame carrying the handler's RAW `{ok, result}` /
`{ok:false, error}` envelope (deliberately NOT `_unwrapLensEnvelope`'d — that
helper strips the top-level `ok` on success because the HTTP route relies on
its own outer `res.json({ok:true,...})` instead; there is no such outer
wrapper on the gateway path, so unwrapping would turn every real success
into a frame with no `ok` field). An action outside the allow-list, or a
malformed frame with no `action` string, gets an honest `unsupported_action`
/ `invalid_action` result — never forwarded to an arbitrary macro. A
handler-level rejection (e.g. `level-create` given an unknown `gameId`)
passes through verbatim as the real handler's own `{ok:false, error:"game
not found"}` — the gateway adds nothing on top.

Round-trip proof: `server/tests/godot-gateway-integration.test.js` sends
real `design_command` frames over a real `/godot-ws` connection against a
fully-booted server and asserts genuine, independently-queryable effects —
`game-create`/`level-create`/`entity-add` land real rows in
`STATE.gameDesignLens`'s Maps (read back via `__TEST__.STATE`, not just the
echoed response), and `building-publish` leaves a real `world_buildings` row
AND a real `dtus` row in SQLite (read back via `db.prepare(...).get(...)`,
the same tables `exportScene`/`scene:request` would see).

**Client side:** `world-lens-godot/design/design_command_client.gd` is a
minimal `Node` wrapping an existing `GatewayClient` — `send_command(action,
params)` builds and sends the envelope, and it listens for
`design_command:result` frames, re-emitting `command_result`/
`command_failed` signals (never treating a missing `ok:true` as success).
This is the protocol round-trip only — no visual placement UI.

**The remaining gap (D18 scope, not built here):** the other ~36
`level-object-*`/`level-paint*`/`gdd-*`/`loop-*`/`narrative-*`/`asset-*`/
`behavior-*`/`collab-*`/etc. macros in `gamedesign.js` are still unreached
from the gateway — extending `DESIGN_COMMAND_ACTIONS` to cover them is
mechanical (same allow-list + dispatch, more entries), not a new pattern.
What's genuinely still missing: an actual visual placement/authoring UI in
Godot (D18's real scope — clicking to place an entity/spawn/trigger in the
3D viewport and having it call `send_command` with real coordinates), a
live-preview subscription wiring a design-mode Godot client to the same
realtime events a running world uses (D19), and DTU-backed scene save/load
+ a design↔play toggle (D20/D21).

## 12. FEA/engineering visualization (R5/E23) — plain REST, not `design_command`

This is a new capability, not a vocabulary item from the master-spec §8 list
above — flagged here because it deliberately does NOT extend `design_command`,
and that choice is worth recording so a future unit doesn't "fix" it by
routing it through the gateway instead.

**What's real:** `server/domains/engineering.js` registers a new
`engineering.feaScene` macro (reachable the ordinary way, `POST
/api/lens/run` with `{domain:"engineering", name:"feaScene", input:{model}}`)
that runs the SAME real beam-frame solver `engineering.runFEA` already uses
(`server/lib/simulation/fea-solver.js#runFEA`) and assembles a single,
self-contained `concord-fea-scene/v1` JSON: the real input geometry (node
positions, member connectivity) merged by member id with the solver's real
per-member stress/utilization, plus boundary conditions (supports/loads) and
reactions/displacements/summary. `engineering.runFEA`'s own response
(unchanged) omits the input geometry — a caller that already holds the model
client-side (the web engineering lens page) merges it back in itself; a
stateless native client has no such held model, so `feaScene` exists to hand
back everything in one response. Contract-tested against a hand-derived
sigma=Mc/I ground truth at `server/tests/engineering-fea-scene.test.js`.

**Godot-side:** `world-lens-godot/engineering/fea_scene_builder.gd`
(`FeaSceneBuilder`, extends `Node3D`) fetches via a plain `HTTPRequest` POST
— the exact pattern `world/dtu_prop_renderer.gd` already established for the
`dtu_props` macro domain — and renders nodes as joint spheres, members as
beams, colored by a real green→yellow→red gradient driven by each member's
actual `utilization` ratio (never a fixed/decorative gradient). Pure
transform/color math is unit-tested at `tests/test_fea_scene_builder.gd`;
see `world-lens-godot/VISUAL_QA.md`'s new entry for what's genuinely
unverified without a real renderer (beam scale at real model dimensions, no
camera auto-framing, whether the color ramp reads correctly under default
lighting).

**Why this bypasses `design_command` rather than extending it:** §11 above
already went through this channel's actual server-side dispatch
(`_onGodotClientMessage`'s `"design_command"` case →
`_dispatchDesignCommand("game-design", action, params, ctx)`), and the
domain there is a HARDCODED LITERAL — `"game-design"` — not a field the
client supplies. `DESIGN_COMMAND_ACTIONS` is similarly scoped to that one
domain's macros only. Reaching `engineering.feaScene` through this channel
would mean changing `_dispatchDesignCommand`'s call site to accept a
`domain` argument off the incoming frame (and re-deciding whether that
should be a generic multi-domain allow-list or stay curated) — a real change
to a shared, actively-changing region of `server.js`, out of proportion for
a single-macro visualization feature. `request_scene()` on
`FeaSceneBuilder` is this feature's own minimal trigger instead: a caller
(a future engineering-lens-in-Godot surface, a test harness, or any other
Godot scene holding a real FEA model) calls it directly with `{nodes,
members, loads, supports}` — the same "plain macro REST call, no gateway
required" posture `dtu_prop_renderer.gd` already uses, needing neither the
WebSocket gateway to be mounted nor `design_command`'s allow-list touched.
If a future unit generalizes `design_command` to accept an explicit
`domain` field (useful for reasons beyond this one macro), `feaScene` would
become reachable through it "for free" — but that generalization is not
built here.

## 13. ConKay spatial presence (R5/E22) — reuses the existing `user:<id>` mirror, one new event

This is the master-spec's "CK-World" framing — the SAME ConKay identity
already real on the web (`concord-frontend/components/conkay/`) rendered
spatially in the Godot Hub, not a new agent. Two real, cross-device ConKay
facts drive it:

1. **A macro/brain call ConKay itself initiated is in flight ("busy").**
   No new event was needed — `macro:started`/`macro:completed` (already
   IMPLEMENTED per the summary table above) already fire to the caller's
   `user:<id>` room whenever `/api/lens/run` carries a ConKay correlation id
   (`x-conkay-run-id` / `body.__runId`), and that room was already mirrored
   to a connected Godot client via `realtimeEmit`'s `{ userId }` branch
   before this unit touched anything.
2. **The capability tier of ConKay's last completed verification**
   (Proven/Flagged/Reasoned/Unverified — the same four-value vocabulary
   `concord-frontend/components/common/CapabilityBadge.tsx` renders). This
   one had NO realtime event before this unit — `reason.verify`/
   `reason.evaluate_answer`'s verdict was only ever classified client-side,
   inside the browser tab that made the call. A new event, `conkay:verdict`,
   closes that gap:

```json
{ "evt": "conkay:verdict", "data": { "runId": "...", "domain": "reason", "action": "verify", "tier": "proven", "verdict": "grounded", "confidence": 0.82, "ts": "...", "_seq": 1, "_evt": "conkay:verdict" } }
```

Fired from the SAME `emitMacroLife` helper (`server.js`'s
`app.post("/api/lens/run")` handler) that already fires
`macro:started`/`macro:completed` — same `user:<id>` gate (only when a
correlation id AND a resolved non-anon user exist), same mirror path, no new
room grammar. The derivation (which macro pairs produce a verdict, how the
tier is computed) is a pure, separately-unit-tested module,
`server/lib/conkay-verdict-bridge.js`, which delegates the actual
proven/flagged/reasoned/unverified classification to a new canonical
server-side port of the frontend's own classifier,
`server/lib/capability-tier.js#capabilityTierFor` — kept byte-for-byte in
step with `CapabilityBadge.tsx`'s `capabilityTierFor` so the two never
drift. A `(domain, action)` pair outside the two known verdict macros, or a
macro result that isn't genuinely `ok:true`, derives `null` — server.js
emits nothing, never a guessed tier.

**Client side:** `world-lens-godot/conkay/conkay_presence.gd` (a `Node3D`
mounted in `world/boot.gd`) renders a small cyan lattice-node orb — the same
core+ring+3-satellite composition `ConKayWidget.tsx`'s SVG glyph already
uses, same colors — whose state is driven ENTIRELY by `macro:started`/
`macro:completed`/`conkay:verdict` frames via a pure state-derivation module
(`conkay/conkay_presence_state.gd`) with zero client-side timers. A separate
pure module, `conkay/conkay_pointing.gd`, provides the "point at buildings/
props" capability the master spec named — real look-at/yaw-pitch geometry
given ConKay's position and a target position, NOT navigation/pathfinding
(see that file's own "explicitly out of scope" note — lead/follow real
navigation is a clearly-scoped, unattempted follow-on, not a half-built
naive lerp).

**Deliberately excluded:** `ConKayWidgetState`'s other two values
("listening"/mic-active, "speaking"/TTS-active) and the overlay's `open`
boolean are real but physically local to whichever browser tab is doing the
capturing/playback — broadcasting them into a separate native process would
present one device's local I/O state as if it were the account's shared
truth. See `conkay_presence_state.gd`'s header for the full reasoning. No
event carries them today and this unit does not add one.

## What this doc does NOT claim

- Original A1 Central Plaza unit (2026-07-23): this doc did not claim any of
  the PARTIAL/PLANNED gaps were closed by that unit. Only the doc itself and
  the A1 macro/scene-export field (`server/domains/scenebridge.js`'s `map`
  macro, `server/lib/scene-export.js`'s `plaza` field) were built alongside
  it — everything else was a read of real, pre-existing code.
- **This revision (D17 first slice, same day):** `design_command` moved from
  PLANNED to PARTIAL — but only for the 4 curated actions in §11 above. It
  does NOT claim the other ~36 `gamedesign.js` macros are reachable, does
  NOT claim a visual authoring UI exists (D18), and does NOT claim
  live-preview or scene save/load (D19/D20) were touched. Every other
  PLANNED/PARTIAL row in the summary table is unchanged by this revision.
- **This revision (C16 — ambient aerial traffic):** adds a THIRD real
  `update_transform` instance (`world:aerial-traffic`) alongside the two
  that already existed — it does NOT change `spawn_entity`/`despawn_entity`
  from PLANNED; the new traffic follows the SAME implicit-despawn-via-
  absence convention `city:positions`/`city:npcs` already use rather than
  introducing a dedicated spawn/despawn wire message, so those two rows
  stay exactly as PLANNED as before. Does not touch `play_effect`,
  `cast_spell_visual`, `apply_force`, `query_state`, or `load_district`.
- The 3 PARTIAL rows (`play_effect`, `apply_force`'s NPC-path half,
  `load_district`) share one root cause worth naming once: several combat/
  world emit sites call `io.to(room).emit(...)` directly instead of going
  through `emitToWorld`/`realtimeEmit`, so they never reach
  `_godotGatewayEmitter`. This is a **pre-existing pattern predating the
  Godot work** (those call sites were written for the socket.io-only world
  before the gateway existed) — closing it is a small, mechanical, well-
  scoped follow-on (swap the direct `io.to()` call for the equivalent
  `emitToWorld`/`realtimeEmit` call at each named site), not a design
  question.
- **This revision (R5/E23 — FEA/engineering visualization, §12 above):** adds
  a new macro (`engineering.feaScene`) and a new Godot consumer
  (`fea_scene_builder.gd`) that deliberately do NOT touch `design_command` —
  `DESIGN_COMMAND_ACTIONS` is unchanged (still the same 4 curated
  `game-design` actions) and `_dispatchDesignCommand` still hardcodes the
  `"game-design"` domain. This revision does not claim any summary-table row
  above changed status; it documents a separate, REST-only capability that
  sits outside that vocabulary entirely.
- **This revision (R5/E22 — ConKay spatial presence, §13 above):** adds ONE
  new event, `conkay:verdict`, reusing the existing `macro:started`/
  `macro:completed` userId-scoped mirror path unchanged (no new room
  grammar, no new transport). Does not claim `spawn_entity`/`despawn_entity`
  moved off PLANNED — the Godot presence node is mounted directly in
  `boot.gd`, not spawned/despawned via any general entity-lifecycle event.
  Does not touch `design_command`, `play_effect`, `apply_force`,
  `query_state`, or `load_district`.

## Reproduction / verification

```bash
# Gateway contract tests (envelope, auth, rooms, scene:request, player:move/mode,
# and design_command dispatch — all 5 new design_command cases live in the
# integration file, alongside the pre-existing coverage):
cd server && node --test tests/godot-gateway.test.js tests/godot-gateway-integration.test.js

# Central Plaza macro/scene-export field this unit added:
cd server && node --test tests/central-plaza-map.test.js

# The design_command allow-list + shared dispatch helper this revision added:
grep -n "DESIGN_COMMAND_ACTIONS\|_dispatchDesignCommand" server/server.js

# GDScript client + its pure-logic test (parse/lint only — see VISUAL_QA.md):
gdlint world-lens-godot/design/design_command_client.gd
gdlint world-lens-godot/tests/test_design_command_client.gd

# Grep the two mirror call sites cited above (realtimeEmit/emitToWorld → Godot):
grep -n "_godotGatewayEmitter" server/server.js

# Grep the PARTIAL-status direct io.to() emit sites that bypass the mirror:
grep -n 'io.to(`world:' server/lib/combat-polish.js server/routes/worlds.js

# C16 — ambient aerial traffic: pure lib + heartbeat contract tests (25 cases):
cd server && node --test tests/aerial-traffic-cycle.test.js

# C16/C15 — GDScript parse + lint (requires: pip install gdtoolkit):
cd world-lens-godot && for f in $(find . -name '*.gd'); do gdparse "$f"; done && gdlint .

# The world:aerial-traffic heartbeat registration + shape contract:
grep -n "aerial-traffic-cycle" server/server.js
grep -n "world:aerial-traffic" server/lib/event-shapes.js

# R5/E23 — FEA/engineering visualization: the new macro's contract test
# (hand-derived sigma=Mc/I ground truth, same fixture family as
# tests/e2e/design-simulate-fea-loop.test.js):
cd server && node --test tests/engineering-fea-scene.test.js

# R5/E23 — GDScript scene builder + its pure-logic test (parse/lint only —
# see VISUAL_QA.md):
cd world-lens-godot && gdparse engineering/fea_scene_builder.gd && gdlint engineering/fea_scene_builder.gd
gdparse tests/test_fea_scene_builder.gd && gdlint tests/test_fea_scene_builder.gd

# Confirm design_command's domain is still hardcoded (the reason feaScene
# uses plain REST instead of extending this channel):
grep -n '_dispatchDesignCommand("game-design"' server/server.js

# R5/E22 — ConKay spatial presence: the pure server-side classifier + its
# unit test, the pure verdict-derivation bridge + its unit test, and the
# conkay:verdict event-shape/realtimeEmit contract test:
cd server && node --test tests/capability-tier.test.js tests/conkay-verdict-bridge.test.js tests/conkay-verdict-event-shape.test.js

# R5/E22 — GDScript presence node + pointing geometry + state derivation,
# and their pure-logic tests (parse/lint only — see VISUAL_QA.md):
cd world-lens-godot && for f in conkay/*.gd tests/test_conkay_presence_state.gd tests/test_conkay_pointing.gd; do gdparse "$f"; done
gdlint conkay/ tests/test_conkay_presence_state.gd tests/test_conkay_pointing.gd

# Confirm macro:started/macro:completed were ALREADY mirrored to Godot
# clients before this unit touched anything (no new code needed for the
# "busy" half of ConKay's spatial state):
grep -n '_godotGatewayEmitter?.emitToRoom(`user:' server/server.js
```
