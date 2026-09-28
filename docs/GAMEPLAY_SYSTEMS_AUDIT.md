# Concordia Gameplay Systems Audit — Rule 1 Pass

**Date:** 2026-09-16 · **Trigger:** AURA GAMEPLAY SYSTEMS MASTER DIRECTIVE, Non-Negotiable Rule 1 (audit before building).

**Method:** named-file evidence + gateway verb enumeration + test-name reading. Raw grep counts are reported only where labelled, and are a *weak* signal — this repo's own doctrine (`CLAUDE.md` §"Runtime-truth over source-guessing") records three separate incidents where literal scans produced false conclusions. Where a count is inflated by an unrelated domain, it is called out rather than laundered.

**Reproduce the layer inventory:**
```bash
find apps/concordia-living-world/unity-client/Assets -name "*.cs"  -exec cat {} \; | wc -l
find concord-frontend/lib/concordia  -name "*.ts"  -exec cat {} \; | wc -l
find concord-frontend/lib/world-lens -name "*.ts"  -exec cat {} \; | wc -l
find concord-frontend/components/world concord-frontend/components/concordia \
     concord-frontend/components/world-lens -name "*.tsx" -exec cat {} \; | wc -l
find world-lens-godot -name "*.gd" -exec cat {} \; | wc -l
grep -oE 'case "[a-z]+:[a-z_]+"' server/lib/godot-gateway.js | sed 's/case //' | sort -u
```

---

## 0. The central finding

**Concordia is not missing a gameplay simulation. It has one, it is server-authoritative, and the Unity client is already wired to it.** The directive's §1–§26 read as "build these systems." Against the *server*, most of them are already EXISTS. Against the *Unity client*, most are MISSING — but the architecture explicitly forbids solving that by building a second simulation in Unity.

The load-bearing evidence is a test name in `server/tests/unity-gateway.test.js`:

> `scene:request` on /unity-ws → `scene:data` (**presentation, not a second sim**)

That is the architectural contract. Unity is a presentation layer over the authoritative kernel. Directive Rule 1.12 ("do NOT create parallel versions of an existing subsystem without proving the existing one cannot satisfy the requirement") and this contract point the same direction.

### Layer inventory

| Layer | LOC | Role | State |
|---|---:|---|---|
| **Server** (`server/`) | ~10,632 macros | authoritative simulation | deep, tested |
| **Web client** (Three.js) | ~142,000 | full client gameplay layer | deep |
| **Unity client** | ~38,000 | presentation | world-dressing + combat prototype |
| **Godot client** | ~25,000 | spectator milestone | narrow |

Web breakdown: `lib/concordia` 15,362 · `lib/world-lens` 21,719 · world components 105,223.

Unity's combat total is **1,641 LOC** across six files — `CombatFeel.cs` (74), `CombatMotion.cs` (48), `Hostile.cs` (260), `TrainingDummy.cs` (202), `AgentMotor.cs` (184), `ConcordiaPlayer.cs` (873). That is a prototype, not an architecture.

### The gateway contract (27 verbs)

Unity shares the Godot gateway (`server.js`: *"Unity /unity-ws uses the same gateway; envelopes are `unity:<godot-evt>`"*):

```
agent:intent  agent:perceive  character:bind  character:create  character:load
character:unbind  combat:dodge  dialogue:request  dungeon:hit  dungeon:open
gift:give  inheritance:request  inspect:request  kingdom:request  lens:run
party:request  room:join  room:leave  run:start  scene:request  scheme:intervene
webrtc:answer  webrtc:ice  webrtc:join  webrtc:leave  webrtc:offer  world:snapshot
```

`lens:run` is the significant one — tests prove it *"forwards to runMacro with HTTP-shaped ctx"* and *"both production mounts inject `_runMacroFromGateway` (HTTP-identical dispatch)"*. **Unity can already reach all ~10,632 macros, auth-gated.** Proven honest-failure behaviour too: *"forwards an injected `{ok:false}` verbatim — never rewrites to success."*

---

## 1. Subsystem matrix

Legend: **E** exists · **P** partial · **D** disconnected/decorative · **M** missing · **?** unverified

| § | Subsystem | Server | Web | Unity | Evidence |
|---|---|---|---|---|---|
| 1 | Combat foundation | **E** | **E** | **P** | srv: `combat-{engine,frame-data,hp-authority,impact,netcode,state,limits,polish,restraint}.js`, `party-combat.js`, `world-combat-styles.js` · web: `combat-{biomechanics,authority,input-buffer,motor-driver,camera,clips}.ts`, `damage-stack.ts`, `impact-resolver.ts` · unity: 1,641 LOC prototype |
| 2 | Defense (block/parry/dodge/counter) | **E** | **E** | **P** | gateway `combat:dodge`; test: *"dodge grants i-frames that zero the next hit"* |
| 3 | Weapon-specific movesets | **E** | **E** | **M** | web `weapon-archetypes.ts`, `move-resolver.ts`, `move-catalog/` · bow/archery thin everywhere (srv 4, web 2 files) |
| 4 | Data-driven animation | — | **E** | **M** | web `animation-state-machine.ts`, `animator-protocol.ts`, `gait-synthesis.ts`, `joint-motors.ts`, `fabrik-ik.ts`, `foot-ik.ts`, `hand-ik.ts`, `pose-broker.ts`, `secondary-physics.ts` · **Unity has zero** IK/ragdoll/state-machine files |
| 5 | Locomotion | **E** | **E** | **P** | srv `movements.js`, `movement/` · web `traversal-kinematics.ts`, `movement-styles.ts`, `character-physics.ts`, `move-budget.ts` · unity `AgentMotor`, `Grounding` |
| 6 | Super-speed | **P** | **P** | **M** | **thinnest item on the directive** — `movement-powers.js` only |
| 7 | Flight | **P** | **E** | **M** | web `flight-physics.ts`. ⚠️ the "92 server files" count is **inflated by the aviation/travel lens** — not player flight |
| 8–9 | Vehicles + physics | **E** | **?** | **M** | `vehicles.js`, `world-vehicles.js`, `vehicle-tuning.js`, `vehicle-tuning-engine.js` |
| 10 | Mounts/creatures | **E** | **E** | **M** | srv `companions-mount{,-evo}.js`, `mount-{care,combat-overlay,gear}.js` · web `mounts/{mount-state-machine,quadruped-gait,rider-ik}.ts` |
| 11 | Character creation | **E** | **E** | **E** | ✅ only section real in all three · unity `CharacterCreator`, `AppearanceStore`, `ModularPerson`, `CxDress`, `MixamoAvatar` · gateway `character:create` tested |
| 12 | Character build/progression | **E** | **P** | **M** | `skills.js`, `skill-{tree,evolution,fusion,forge,awakening,atrophy,domains}.js` |
| 13 | Magic | **E** | **P** | **M** | `glyph-spells.js`, `sovereign-spells.js`, `sonic-glyph.js` + refusal-field glyph algebra (pinned invariant) |
| 14 | Firearms | **E** | **P** | **M** | `server/lib/firearms.js` |
| 15 | Exploration | **E** | **P** | **P** | procgen regions, quest triggers, land claims |
| 16–17 | Construction + functional buildings | **E** | **P** | **P** | `construction.js`, `buildings.js`, `building-{interiors,purpose,salvage}.js`, `cobuild.js`, `build-{loop,bill}.js`, `world-buildings-repair.js` · unity `BuildingInterior.cs` |
| 18 | NPC homes + jobs | **E** | **P** | **D** | ~40 `npc-*.js` incl. `npc-ambition`, `npc-consequences`, `npc-building-affinity` · unity `NpcWander`/`NpcLife` are ambient only |
| 19 | Storefronts | **E** | **P** | **D** | srv `market{,s}.js`, `marketplace.js`, `black-market.js`, `service-market.js` · **unity `StoreDress.cs` is visual dressing only — a shopfront that does not trade** |
| 20 | Crime | **E** | **P** | **M** | `crime.js`, `crime-engine.js`, `world-crime.js` |
| 21 | City/infrastructure sim | **P** | **P** | **P** | `world-economy.js`, `npc-economy.js`, faction set · unity `RoadWorld.cs` |
| 22 | World modifiers | **E** | **P** | **P** | zone hazard + season cycles, weather |
| 23 | Equipment modifiers | **E** | **E** | **P** | web `armor-system.ts` · unity `CharacterGear.cs` |
| 24 | Agent characters | **E** | **P** | **E** | ✅ gateway `agent:intent` + `agent:perceive`; unity `AgentAvatar`/`AgentMotor`; `concordia-agent-body.test.js` |
| 25 | Physical consequence | **E** | **P** | **P** | `npc-consequences.js`; test: *"gift:give consumes a user-global stack even when world_id is another world"* |
| 26 | Persistence | **E** | n/a | n/a | SQLite + 448 migrations + world-shard write-ownership protocol |
| 27 | Controller profiles | — | **E** | **M** | web `control-schemes.ts`, `gamepad-combat-map.ts`, `keybindings.ts`, `input-mapping.ts` |
| 28 | Camera | — | **E** | **P** | web `combat-camera.ts` · unity `ChaseCamera.cs` |
| 29 | Feedback density | **P** | **E** | **P** | web `juice.ts`, `hit-pause.ts`, `knockback-feel.ts`, `screen-trauma.ts` · unity `CombatFeel.cs`, `Footsteps.cs` |
| 30 | QA regime | **E** | **P** | **P** | 37,622 server tests. Unity was at **zero** coverage (framework not even installed); as of 2026-09-16 `com.unity.test-framework` 1.7.0 is installed and `Concordia.Tests.EditMode` runs **20/20 green** against the new gameplay core. Still no coverage for the other ~60 Unity scripts |

### Counts

- **EXISTS server-side:** 21 of 30 sections
- **MISSING Unity-side:** 13 sections; **PARTIAL:** 11; **EXISTS:** only 2 (character creation, agent characters)
- **DECORATIVE:** 2 confirmed (`StoreDress.cs`, `NpcWander`/`NpcLife`)
- **Genuinely thin everywhere:** super-speed (§6), bow/archery (§3), player-flight server side (§7)

---

## 2. The decision this audit exists to force

The gap is **not** "the simulation is missing." It is: *Unity's presentation layer is greybox, and a 142k-LOC client already solved that exact layer against the same server.* Verified visually on 2026-09-16 — the Hub renders with no materials bound and a placeholder khaki hero, despite 13.5GB of PolyHaven/FreePacks now imported.

Three coherent branches. They are mutually exclusive and the choice changes every downstream estimate:

**A — Unity becomes primary.** Port the web client's *client-side feel* layer to C#: animation composition, input buffering, camera, traversal, IK/ragdoll. Large, but it is a **presentation port, not a simulation rebuild** — combat/vehicles/magic keep living server-side and arrive over `lens:run` + gateway verbs. Risk: the 105k LOC of world components is not all portable, and Unity currently has zero test coverage.

**B — Web stays primary; Unity is the 3D megaworld viewer.** Directive work lands in web + server, where §1–5 are already deep. Unity gets the dressing pass already queued in `AURA_BIND_NOW.md` (materials → HDRI → hero → scatter). Cheapest path to a visible result; does not advance Unity as a game client.

**C — Split by capability.** Unity owns the megaworld/spatial layer; web owns lens integration and systemic depth. Requires a hard, written boundary or it degenerates into two half-clients.

**Recommendation:** do not start §1–§30 anywhere until this is chosen. The single most expensive available mistake is writing a parallel combat system in C# that duplicates `combat-engine.js` and violates the presentation-not-a-second-sim contract.

---

## 3. Safe-to-do-now work (direction-independent)

These advance any branch:

1. **Bind PolyHaven materials** (URP Lit from Diffuse + nor_gl + arm) — kills the greybox regardless of who is primary.
2. **Assign HDRIs per world** via `WorldVisualDirector`.
3. **Replace the placeholder hero** with the Quaternius humanoid — the 41-clip animation library was unblocked 2026-09-16 (glTFast 6.10.1 → 6.20.0 fixed a `SortAndNormalizeBoneWeightsJob` race).
4. **Close the two DECORATIVE items** — `StoreDress.cs` should route to the real market macros via `lens:run`; `NpcWander` should read real NPC schedules. Both are honesty violations under the zero-demo-content invariant.
5. **Establish Unity test coverage** — currently zero; §30 cannot be satisfied without it.

---

## 3b. Branch A executed — 2026-09-16

Owner chose **Branch A (Unity primary)**, explicitly authorising reimplementation in C# and
overriding the "presentation, not a second sim" constraint. Refinement adopted: **client-authoritative
feel, server-authoritative truth** — Unity resolves combat/locomotion locally at frame rate (you
cannot gate 60fps feel on a websocket round trip), while anything minting or moving persistent
value reconciles server-side, because the ledger invariants are real and a client-side sim that
mints items is a dupe exploit.

**Phase 1 — materials (done, verified).** Four stacked defects, each individually sufficient to
cause the greybox: `Pbr()` sought `_diff_2k` (0 files match; 790 are `_diffuse_2k`); `LoadPbrTex`
read a flat legacy root instead of `PolyHaven/Textures/<stem>/`; 774 normal maps imported as
`Default` instead of `NormalMap`; ARM maps imported as sRGB, gamma-corrupting linear PBR data. All
fixed, plus an `AssetPostprocessor` so future pulls are correct on import. ARM→URP channel repack
shipped (`Shaders/ArmRepack.shader`): one packed texture feeds both `_MetallicGlossMap` (.r/.a) and
`_OcclusionMap` (.g) since those channels don't overlap — verified 256/256 pixel samples, max delta
0.043.

**Ship-blocker closed.** `FreePacks.Load<T>` returned `null` outside the Editor, so the entire world
catalog was Editor-only. The consumption side (`HubKit.TryGet`) was real but the *production* side
never existed. Built `HubKitSync`, ran it: **758 assets exported, 0 skipped**, 793 indexed.

**HubKit made lazy.** It eagerly imported every manifest entry at boot while `ConcordiaGame` blocked
on `await HubKit.EnsureLoaded()` — survivable at 52 entries, fatal at 800 (~4.7GB): it stalled and
the whole init behind that await, including the material sweep, never ran. Now indexes the manifest
only and imports on first `TryGet`.

**Magenta eliminated** — 159 null material slots + 169 built-in `Standard` slots → **0**. Two
distinct causes: `PaintIfBlank` wrote nulls straight back, and the Standard→URP sweep was one-shot
at boot while content streams in later.

**Phase 2 — gameplay core (started).** `Scripts/Core/`: `ActorState` (body/stamina/poise, graded
stagger), `ActionRunner` (the §1 loop as an explicit phase machine with input buffering, i-frames,
parry windows, cancel-into-combo), `HitResolver` (one §2 defense grammar: i-frames → parry → block →
hit). Pure C#, no MonoBehaviour, integer-millisecond timing so frame windows can't float-drift.
**20/20 EditMode tests green.**

## 4. Known corrections made during this audit

- The "92 flight files" figure is **wrong as a player-flight signal** — dominated by the aviation lens.
- `combat:attack` does not appear in the gateway's `case` list but *is* proven reachable by test (*"combat:attack on /unity-ws reaches onClientMessage (kernel path)"*) — it resolves through the kernel path, not a literal case. A literal scan would have called it missing.
- An earlier pass of this audit returned all-zero server/web counts due to zsh not word-splitting unquoted `$VAR` in `find`. Numbers above are from the corrected run.
