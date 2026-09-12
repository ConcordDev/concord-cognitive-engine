# Concordia — Three.js → Unity wiring plan (2026-09-12)

**Premise (owner):** retire the Three.js *art/rendering* layer only. Every system
behind it that is solid and that Unity can present well gets kept and wired.
Nothing in the logic tier is being thrown away.

**Lane discipline while Cursor is mid-flight.** Cursor owns the Unity C# client
(`unity-client/Assets/Concordia/Scripts/**`) and the art-direction docs.
This plan's work is server-side transport (`server/server.js`,
`server/lib/godot-gateway.js`, `server/lib/unity-bridge.js`) plus this file.
The two lanes touch different trees; the only shared seam is the wire contract
below, which is additive on both sides.

---

## What's actually on the wire (measured, not estimated)

| Surface | Exists | Three.js consumed | Unity consumes today |
|---|---:|---:|---:|
| Realtime broadcast events | 117 | 33 | ~6 handlers |
| Gateway RPC verbs | 13 | — | 13 (complete) |
| REST `/api/` endpoints | 239 | 239 | 0 |

Unity has no HTTP client at all — zero `/api/` strings in the C# codebase.
Everything it does rides one authenticated WebSocket.

**REST surface by top-level segment** (the shape that drives the phasing):

| Segment | Count | Note |
|---|---:|---|
| `/api/lens/*` | 65 | universal macro entry — all covered by one verb (Phase 1) |
| `/api/worlds/*` + `/api/world/*` | 101 | core world spine (Phase 2) |
| long tail (parties 17, roguelite 10, crafting 10, combat-flow 8, companions 7, combat 7, auctions 7, coop 6, mahjong/horde/hidden-object/factory 5 each, …) | ~73 | per-mode triage (Phase 3) |

---

## Already done (this session)

**Realtime fan-out now reaches Unity.** `realtimeEmit` mirrored into
`_godotGatewayEmitter` only; the Unity mount created no emitter, so `/unity-ws`
received zero broadcasts and Unity's correctly-written handlers for
`secret:weaponised` / `npc:scheme-resolved` / `npc:conversation-bid` could never
fire. Added `_unityGatewayEmitter` + mirrors at all four fan-out tiers.
Pinned by `server/tests/invariants/gateway-realtime-mirror-parity.test.js`
(per-tier parity, bidirectionally verified). 40/40 existing gateway tests pass.

This unblocked the *transport*. Unity still needs client-side handlers for the
events it now actually receives — that's Phase 2's client half, Cursor's lane.

**Phase 1 shipped — `lens:run`.** One authenticated WebSocket verb covers the
entire `/api/lens/*` macro surface. `godot-gateway.js` forwards to injected
`deps.runMacro` with `{ actor, userId, reqMeta: { path:"/api/lens/run", method:"POST" } }`.
Both `/godot-ws` and `/unity-ws` mounts inject `_runMacroFromGateway`, which
rebuilds ctx through `makeCtx`, applies the HTTP H1 anon gate, and dispatches
through the same LENS_ACTIONS-then-runMacro lookup `POST /api/lens/run` uses.
The gateway does **not** reimplement Gate 2 or Gate 3 — those stay inside
`runMacro`. Missing dep → honest `lens_run_unavailable`. A thrown `forbidden`
stays `{ok:false}`. Pinned by `server/tests/unity-lens-run.test.js`.

**Phase 2 server shipped.** Combat/quest events that already used `realtimeEmit`
now reach `/unity-ws` via the Unity emitter. Clock/weather/npc-quest/crisis
were `REALTIME.io.emit` only (socket.io) — they now also call
`mirrorToGateways` (`globalThis._concordGatewayMirror`), a gateway-only hook
so socket.io is not double-fired. `world:snapshot` returns the live
`getWorldPhase` + `getWeather` engines. Pinned by
`tests/unity-world-spine.test.js` + the mirror-parity invariant.

**Phase 4 decision: consume `scene:data`.** Unity applies live `nodes`
(real `world_buildings` rows) as a `KernelLive` overlay dressed with local
packs. Empty nodes stay empty. The hub `portals` array in `enrichScene` is
Three.js-scale scaffold and must not stomp the authored Ring of Doors —
those gates stay Canon. `toUnityScene` / `getUnityAssetList` remain for the
Three.js path until that renderer is actually retired; they are no longer
the Unity client's world.

**Phase 3 buckets (judgment, engines kept either way):**
- Native 3D (wire): arena, coop/raids, extraction, horde, farming, factory,
  mounts, auctions, crafting, parties — reach the kernel via `lens:run` plus
  the play verbs already on the socket (party, dungeon, gift, dodge).
  `skills.mastery` now covers the T3.1 67-skill overlay (catalog + live
  `player_skill_levels`); Unity consumes it instead of kit arts.
- In-world terminals later: hacking, trivia, mahjong, karaoke, code-puzzle —
  engines stay; no page port.
- Stay web: genuine dashboards.

---

## Phase 1 — the keystone: one `lens:run` gateway verb

**Covers 65 of 239 endpoints (27%) in a single change.**

`runMacro(domain, name, input, ctx)` (`server.js:13787`) is already the
universal entry point behind `POST /api/lens/run`, and is already injected as a
dependency into other subsystems. `mountGodotGateway` takes a `deps` object that
already receives `exportScene` / `exportKingdom` the same way — adding
`runMacro` alongside them is consistent with the existing pattern, not a new one.

One new verb forwarding to `runMacro` with the authenticated client's ctx gives
Unity the entire ~10,632-macro surface over the connection it already has, with
the auth it already passes, and no CORS or second-auth path to solve in WebGL.

Non-negotiables for this verb:
- Runs through the **same three permission gates** as the HTTP path
  (`authMiddleware` allowlist → `runMacro`'s `publicReadDomains` → Chicken2).
  A gateway verb must not become a way around the gates the REST route enforces.
- Honest failure envelope — a macro that can't run returns `{ok:false, reason}`,
  never a fabricated success.
- Rate-limited on the existing gateway limiter (20/s, burst 30), so a client
  can't use it to hammer macros faster than HTTP allows.

## Phase 2 — the world spine

**101 endpoints + the ~30 realtime events that carry visible state.**

This is what makes the world feel alive, and it's the tier Unity renders
natively better than a web canvas ever did: presence and positions, building
spawn/remove/state, combat feedback (hit/kill/stagger/impact/telegraph),
weather and world clock, NPC bark/alert/gather/travel, quest accepted/completed,
season transitions, crisis and world events.

Split:
- *Server side (this lane):* confirm each of those events actually reaches
  `/unity-ws` now, and add gateway verbs for the world reads that don't fit the
  macro passthrough.
- *Client side (Cursor's lane):* `HandleFrame` cases + the presentation for
  each. This is where "show it in a dope way" actually happens.

## Phase 3 — long-tail triage (~73 endpoints)

Judgment tier. Three buckets, and note that **none of them is "delete the
backend"** — the backend stays either way:

- **Native in 3D — wire and present.** Arena, coop raids, extraction, horde,
  roguelite, farming, factory, mounts, companions, auctions, crafting, parties.
  These were cramped in a web page and get *better* in Unity.
- **In-world surface, not a page.** Hacking, code-puzzle, trivia, hidden-object,
  mahjong, karaoke. Keep the (real, tested) engines; present them as in-world
  terminals/tables the player walks up to, rather than porting a 2D page. Defer
  until Phase 2 lands — they're self-contained and lose nothing by waiting.
- **Stays web-only for now.** Anything that is genuinely a dashboard rather than
  a world interaction. Reachable through the lens system on the site; no Unity
  surface needed.

## Phase 4 — resolve `scene:data`

The server computes a full enriched scene descriptor (`exportScene` →
`enrichScene`, with per-node asset URLs, portals, per-client hints) and sends it
on `scene:request`. Unity requests it on connect and **has no handler** — it's
dropped unread, because Unity builds its world locally from `FreePacks`/
`WorldBuilder` against its own imported asset library.

Two honest options; pick one and stop leaving it ambiguous:
1. **Consume it** for the parts Unity can't know locally (which buildings exist
   right now, portal placement, live world state) while keeping local assets for
   *how* they look.
2. **Delete the Unity branch of it** (`toUnityScene`, `getUnityAssetList`,
   `unityBuildSettings` — the last has zero callers repo-wide) and let Three.js
   keep it until Three.js goes.

Option 1 is probably right, because "which buildings exist" is genuinely server
truth. But silent scaffold is worse than either choice.

---

## What actually gets dropped

Only the Three.js **render layer**: `concordia-theme.ts` constants, cel-shade,
toon ramps, outline passes, the Three.js scene graph and its art rules
(`docs/ART_STYLE_GUIDE.md`, already marked retired). Every system it was
*displaying* — 43 `npc-*.js` modules / 12,040 lines, the quest engine, economy,
factions, schemes, secrets, the authored `content/world/**` for all 10 worlds —
is client-agnostic and stays exactly as is.

## Sequencing note

Phase 1 is independent of everything Cursor is doing and unblocks the widest
surface per unit of work — it should go first. Phase 2's server half can run in
parallel with Cursor's client work; its client half depends on Cursor's current
pass landing. Phases 3 and 4 are deliberately after, so they're decided with a
working spine in hand rather than in the abstract.
