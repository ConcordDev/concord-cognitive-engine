
# Concordia Gameplay Genome

**Phase:** 0 — repository-backed gameplay audit  
**Audit mode:** read-only inspection; no gameplay code, scene, prefab, package, or setting was changed.  
**Generated:** 2026-09-15  
**Primary scene:** `Assets/Scenes/ConcordiaHub.unity`  
**Build scenes:** `ProjectSettings/EditorBuildSettings.asset` contains only `Assets/Scenes/ConcordiaHub.unity`.  
**Observed editor baseline:** edit mode, active scene ConcordiaHub, serialized roots are only `Directional Light` and `ConcordiaGame`, no compile errors, and no returned warning/error console entries.

> This document records executable code and project contents, not intended capabilities. Statuses are LIVE, PARTIAL, DISCONNECTED, DECORATIVE, DUPLICATE, MISSING, or BROKEN. Not observed is not treated as success.

## 1. Repository map and evidence boundary

### Roots inspected

- `Assets/Concordia/` — canonical Concordia runtime, editor tooling, generated content, resources, models, shots, and audit docs.
- `Assets/Scripts/` — only a commented-out `ConcordClient.cs` and `ConcordClient.cs.stale`; no compiled Concordia definitions found here.
- `Scripts/` — root-level duplicate source tree; outside Unity's Assets compilation root.
- `Assets/Concordia/Scripts/ConcordiaDialogueService.cs` — project-owned offline dialogue authority; the former Convai SDK tree has been removed.
- `Assets/KinematicCharacterController/` — KCC source/examples/walkthroughs; Concordia uses Unity `CharacterController` instead.
- `Assets/StreamingAssets/HubKit/` — manifest and GLB runtime kit used by `HubKit` and glTFast.
- `Packages/`, `ProjectSettings/`, `Data/Plugins/`, `Editor/`, `Captures/`, `.Aura/` — package graph, settings, generated outputs, editor scripts, historical captures, and workflow material.

### Existing documentation checked

- `Assets/Concordia/PASS_LOG.md` says quest boards are authored readable text, not the server quest engine, and creatures remain Kenney stand-ins.
- `Assets/Concordia/KAY_WAKE.md` explicitly says Play was not captured and several claims were code-level/unverified in-editor.
- `Assets/Concordia/Generated/CX_MANIFEST.md` documents 142 CX plates, missing bestiary/VFX/architecture coverage, and the distinction between plates and skinned meshes.
- `Assets/Concordia/AURA_BIND_NOW.md` refers to `Assets/Concordia/PolyHaven/` and `Assets/Concordia/FreePacks/`; asset queries found no PolyHaven assets and no FreePacks folder. Its staging path is external to this Unity repository.
- No gameplay genome existed before this file.

### Packages and input

`Packages/manifest.json` declares Unity MCP, Aura, AI Assistant/Inference, Cinemachine 3.1.6, glTFast, URP, UGUI, and built-in modules. The lock file resolves `com.unity.inputsystem` 1.20.0 transitively, but no `InputActionAsset` was found. `ProjectSettings/InputManager.asset` contains legacy Horizontal, Vertical, Fire1/2/3, Jump, mouse, Submit/Cancel, and debug axes.

## 2. Runtime boot and scene authority

### LIVE — runtime boot

**Path:** `Assets/Concordia/Scripts/ConcordiaGame.cs`  
**Class:** `Concordia.ConcordiaGame`

`Start()` dynamically creates the camera, player, Unity `CharacterController`, `ConcordiaPlayer`, `ChaseCamera`, `ConcordiaHUD`, `Footsteps`, `CombatFeel`, `EvoResolver`, `ConcordClient`, and `WorldBuilder`. It awaits `HubKit.EnsureLoaded()`, builds the world, enters `WorldClock`, snaps grounding, installs `GameplayCoreBridge`, applies `HubLook`, and opens `CharacterCreator` when no appearance save exists. Dialogue is project-owned through `ConcordiaDialogueService` and does not require credentials.

The serialized scene is a thin bootstrap. Runtime code, not scene-authored object references, is the actual composition root. A dynamic build failure can therefore leave a valid-looking scene with no authored gameplay fallback.

### LIVE — editor/build tooling

- `Assets/Concordia/Editor/ConcordiaBoot.cs` — Play Hub orchestration, RAM shedding, export hooks.
- `Assets/Concordia/Editor/ConcordiaMenu.cs` — Hub scene/build-settings creation.
- `Assets/Concordia/Editor/CxBake.cs` — CX humanoid, weapon, and mount baking.
- `Assets/Concordia/Editor/ConcordiaWebExport.cs` — WebGL build for the single Hub scene.

These are lifecycle/build tools, not gameplay authority.

### DUPLICATE — old source trees

`Scripts/ConcordiaGame.cs`, `Scripts/WorldBuilder.cs`, and `Scripts/ConcordiaShot.cs` are older root-level implementations and are not under `Assets`. `Assets/Scripts/ConcordClient.cs` is comments only. `Assets/Scripts/ConcordClient.cs.stale` contains the retired old protocol client. Canonical runtime is `Assets/Concordia/Scripts/`.

## 3. Gameplay loop trace

### Input to simulation — PARTIAL

`ConcordiaPlayer.Update()` handles movement, sprint, jump/climb, dodge, attack, special, interaction, kit cycling, menu, skill sheet, and talk submission. It reads `Keyboard.current` when the Input System is enabled and also uses legacy `Input.GetAxis`, `Input.GetKey`, and mouse helpers. `ChaseCamera` similarly mixes Input System mouse and legacy input. `CharacterCreator` creates immediate-mode UI and an EventSystem if needed.

There is no project-owned Input Action Map, action asset, rebinding surface, or control-scheme asset. Gamepad/action-map coverage is inconclusive.

### Movement and camera — LIVE

- `Assets/Concordia/Scripts/ConcordiaPlayer.cs` — `Update`, `WalkBearing`, `Stand`, `ReceiveLand`.
- `Assets/Concordia/Scripts/ChaseCamera.cs` — `Bind`, `DriveTransform`, `Look`, `Collide`.
- `Assets/Concordia/Scripts/Grounding.cs` — sphere/raycast floor snapping.
- `Assets/Concordia/Scripts/ContinentStream.cs` — receive hooks after movement.

The local movement path uses `CharacterController.Move`, acceleration, coyote time, jump/climb/dodge, grounding, and streamed-world receive. Server movement is reported but not authoritative movement.

### Interaction and traversal — LIVE locally; PARTIAL authority

`ConcordiaGame.Update()` probes runtime gates, cities, lore stones, guests, quest boards, holds, loot, cook stations, tombs, `UsePlace`, and `BuildingPlace`. `TryInteract()` routes to local travel, city/hold/building teleport, quest offer/progress, loot, cooking, lore, and dialogue.

`WorldGate.OnTriggerEnter()` calls `ConcordiaGame.Travel()`. Travel uses `ContinentStream.Teleport()` then requests scene, kingdom, room, party, snapshot, and skill data. Geometry and prompts are local; authoritative outcomes are used only where acknowledgements exist.

### Combat — PARTIAL

Local path: `ConcordiaPlayer.TryAttack/TrySpecial` apply Flower Law and world styles through `Core.ActionRunner` (`CombatMotion.StrikeWindows` = Delay/ComboOpen); `HitScan` fires on `JustBecameActive` and finds `TrainingDummy`; local targets call `TrainingDummy.Hit`. Incoming `Hostile` damage goes through `ConcordiaPlayer.TakeHit` → `Core.HitResolver` (i-frame / parry / block / hit). `GameplayCore.CombatDefenseEvaluator` is DISCONNECTED from that path — do not wire a third grammar. `CombatFeel`, `ModularPerson`, and `MixamoAvatar` present impact.

Kernel path: `TrainingDummy.KernelAuthored` distinguishes Arena/dungeon objects from road hostiles/fauna. Connected kernel-authored attacks call `ConcordClient.SendAttack` or `SendDungeonHit`. `combat:attack:ack` reaches `ConcordiaPlayer.ApplyKernelAttackAck`, and only an accepted acknowledgement calls `TrainingDummy.ApplyServerHit`. Other combat events include hit, impact, kill, telegraph, and dodge.

This is split authority, not one authoritative combat simulation. Road hostiles, local HP, Flower Law, and some special effects remain client-side. Offline paths explicitly surface `no_gateway` in several toasts.

### NPCs and creatures — PARTIAL

`NpcLife` provides local jobs, schedules, notices, work/inside behavior, and social interactions. `NpcWander` is a simpler local wander component. `GuestNpc` binds authored `GuestDef` data. `Hostile` composes with `TrainingDummy`, `FaunaLife`, and `ModularPerson`. `EvoSpawner`, `CreatureCompiler`, `EvoCatalog`, `EvoResolver`, and `WorldVisualDirector` present creatures locally or from kernel event cards.

`ConcordClient` handles creature birth, ecology, migration, funeral, wedding, stress-break, and related events. No complete server-owned NPC replication loop, deterministic NPC authority, or reconciliation for every locally spawned citizen was found.

### Worlds, geography, and streaming — LIVE locally; PARTIAL authority

- `Canon.cs` defines worlds, gates, laws, fauna, styles, combat rules, spawn, and arena constants.
- `WorldBuilder.Build()` is boot-only and calls `ContinentStream.Boot`; comments explicitly forbid rebuilding on travel.
- `ContinentStream` owns one `Megaworld` plane, LOD/chunks, impostors, roads, wilderness, and `SoftEnter`.
- `MegaworldMap` maps world IDs to presented positions.
- `WorldGeography` supplies regions, settlements, places, borders, routes, `CountryAt`, route lookup, and persistence validation.
- `WorldField` supplies field blending and damage scaling. Its comments claim server constant parity, but no server source is present here, so lockstep is inconclusive.
- `WorldVisualDirector`, `WorldKit`, `HubPlaza`, `RealmFill`, `RoadWorld`, `BuildingInterior`, and `StoreDress` build local geometry/dressing.

World identity is locally derived from position and Canon. Server scene, snapshot, clock, weather, and kingdom responses overlay state when connected.

### Quests, skills, inventory, and social state — PARTIAL

`WorldBook` loads Canon JSON from `Assets/Concordia/Resources/Concordia/Canon/<world>/` for lore, people, creatures, factions, countries, and quests.

`QuestLog` accepts and completes only `talk_to`, `interact`, `reach_location`, `defeat`, `gather`, and `deliver`. Other objective types remain open with an explicit kernel/other-surface explanation. Quest state is static and `QuestLog.Reset()` runs at game start.

`KitBag` is local weapon/loot presentation and explicitly says the full item-instance economy lives in the kernel. It resets at boot; server gear is overlaid by `BindKernel` from snapshots. `SkillLattice` is empty until a mastery `lens:result`; local combat has fallback slots. `Bonds`, `GiftFeel`, `Plots`, and `HubObjectives` provide local affinity, gift, scheme, and small Hub checklist behavior.

Authored quest/catalog data exists, but a complete authoritative quest, inventory, skill progression, and objective persistence implementation does not.

## 4. Server-facing adapters and authority

### PARTIAL — WebSocket gateway

**Path:** `Assets/Concordia/Scripts/ConcordClient.cs`  
**WebGL:** `Assets/Plugins/WebGL/ConcordWs.jslib`

Editor/desktop first attempts `ws://127.0.0.1:5050/unity-ws`, then `wss://live.concordos.ai/unity-ws`. WebGL reads `CONCORD_UNITY_CONFIG` and URL parameters, uses browser WebSocket, and clears the kitchen URL. The handshake sends auth, scene request, kingdom request, room join, party request, world snapshot, and skill lens events. Reconnect runs every eight seconds and failures become `no_gateway`. Event and payload parsing is hand-written string scanning, not general JSON models.

The adapter is real and broad, but live reachability and protocol compatibility were not exercised in this audit.

### PARTIAL — HTTP evolution resolver

`Assets/Concordia/Scripts/EvoResolver.cs` calls `GET https://live.concordos.ai/api/evo-asset/resolve?source=&sourceId=` and returns a URL or null. It has no retry/auth/persistence path.

### LIVE locally — project-owned dialogue

`ConcordiaGame.SubmitTalk()` routes the existing player dialogue UI to `ConcordiaDialogueService.Reply()`. Responses use authored NPC lines, `Canon`, `WorldClock`, `QuestLog`, and local bond state. The former Convai runtime and SDK assets have been removed. `ConcordClient` remains an optional gateway for other server-backed systems, not a dialogue dependency.

### Authority matrix

| State or consequence | Current owner | Classification |
|---|---|---|
| Player transform | Unity client; `player:move` reported | PARTIAL authority |
| Local movement/camera | Unity client | LIVE |
| Road hostile AI/damage | Unity `Hostile` | PARTIAL / local-only |
| Arena/dungeon target HP | Kernel when connected; local fallback | PARTIAL |
| World clock/weather | Kernel overlay with local timeout fallback | PARTIAL |
| Kingdom/scene nodes | Kernel overlay; local WorldBuilder base | PARTIAL |
| Quest acceptance/progress | Unity `QuestLog` subset | PARTIAL / disconnected from full engine |
| Item instances | Kernel concept; Unity `KitBag` subset | PARTIAL |
| Social/gift/plot outcome | Kernel acknowledgement where sent; local pre-ack presentation | PARTIAL |
| Persistence | Appearance/world files; most gameplay statics reset | PARTIAL |

## 5. State, consequence, and persistence trace

### State and presentation — LIVE/PARTIAL

`WorldClock`, `WorldMemory`, `KingdomBook`, `CrossRing`, `WorldGeography`, `CityAtlas`, `QuestLog`, `KitBag`, `Bonds`, `Plots`, and `SkillLattice` hold static C# state. `ConcordiaHUD`, `WorldVisualDirector`, `HubLook`, `CxDress`, `ModularPerson`, `NpcLife`, `WorldGate`, `WorldBoss`, and `CombatFeel` present it.

### Consequences — PARTIAL

`ConcordClient.HandleFrame()` maps many server events into feed, HUD, NPC, boss, creature, weather, faction, economy, lineage, wedding/funeral, and world-boss presentation. `WorldClock.NoteKill` and `WorldMemory.MarkDead` can make local lineage/economy changes. Unity does not author or verify the underlying server transaction; most handlers are read/presentation adapters.

### Persistence — PARTIAL

- `AppearanceStore` writes `Application.persistentDataPath/concordia_appearance.json` and PlayerPrefs key `concordia.appearance.v1`.
- `WorldMemory.Write` writes `Application.persistentDataPath/concordia-living-v1.json` with world slices, dead IDs, births, ecology, prices, plots, travelers, caravans, tariffs, and border-crossing fields.
- `ConcordClient` stores an agent character ID in PlayerPrefs key `concordia-agent-character`.
- `QuestLog`, `HubObjectives`, `SkillLedger`, `SkillLattice`, `KitBag`, `Bonds`, and `Plots` reset at boot or are static; no complete save/load path was found for their runtime state.
- Server persistence is requested through WebSocket events but was not independently verified.

## 6. Content and presentation audit

### PARTIAL — Canon/resources

`Assets/Concordia/Resources/Concordia/Canon/` contains ten world folders and JSON for lore, factions, NPCs, creatures, Tunya countries, and quests. `WorldBook` loads these with `Resources.Load` and `JsonUtility`. The data is connected to local population and interaction.

### PARTIAL — CX/generated content

`Assets/Concordia/Generated/` contains the documented CX plates, HUD/civic plates, five baked prefabs, two humanoid FBX rigs, textures, and real-world prefabs. Executable connections found:

- `ModularPerson` loads CX humanoid prefabs and rig FBX paths.
- `CharacterGear` and `CxDress` use grip sockets and generated weapon prefabs/meshes.
- `CxDress` loads HUD and civic JPEGs in the Editor and presents them as billboards.
- `FreePacks` indexes Generated RealWorld, Prefabs, and Rig folders.

Most P0–P4 JPEGs are not mesh/material bindings and do not by themselves change the world. Unique bestiary, architecture, VFX, and isolated hair coverage remains as documented in `CX_MANIFEST.md`.

### PARTIAL — free/store assets and fallbacks

`FreePacks` prefers imported store stems, then indexed assets/HubKit, then Kenney or primitive fallback. `HubKit` loads `Assets/StreamingAssets/HubKit/MANIFEST.json` and GLBs through glTFast. Missing assets frequently fall back to primitives/Kenney. No `Assets/Concordia/PolyHaven` folder was found, so the AURA bind request is not repository-backed.

### DECORATIVE — Kinematic Character Controller

KCC source/examples are present, but Concordia instantiates Unity `CharacterController` directly. No Concordia gameplay reference to `KinematicCharacterMotor` was found.

### DECORATIVE/DISCONNECTED — historical captures

`Captures/` and `Assets/Concordia/Shots/` contain historical-looking screenshots. This audit did not run Play or validate capture timestamps/content, and `KAY_WAKE.md` warns that Play had not been captured. Treat them as historical evidence only.

## 7. Verification and test coverage

### PARTIAL — compile/build baseline

- `check_compile_errors` returned No compile errors.
- Editor is in edit mode and not playing.
- No warning/error console entries were returned by the queried console buffer.
- Build settings contain only the Hub scene.

### MISSING — Concordia gameplay test suite

No Concordia-owned EditMode/PlayMode test assembly or tests were found. The former Convai SDK test tree was removed; movement, authority, combat, quest, persistence, streaming, and consequence invariants remain untested.

No gateway reachability, PlayMode smoke test, scene build, WebGL handshake, or persistence round-trip was performed for Phase 0. Those behaviors remain inconclusive, not verified.

## 8. Major subsystem classification ledger

| Subsystem | Classification | Evidence |
|---|---|---|
| Runtime boot/composition | LIVE | `ConcordiaGame.Start`, `WorldBuilder.Build` |
| Serialized scene content | PARTIAL | Hub scene is bootstrap-only |
| Input | PARTIAL | `ConcordiaPlayer`, `ChaseCamera`, legacy Input Manager; no InputActionAsset |
| Player movement/camera | LIVE | `ConcordiaPlayer`, `ChaseCamera`, `Grounding` |
| Interaction/travel | LIVE locally / PARTIAL authority | `ConcordiaGame`, `WorldGate`, `ContinentStream` |
| Combat | PARTIAL | `ConcordiaPlayer`, `Hostile`, `TrainingDummy`, gateway ack path |
| NPC life/schedules | PARTIAL | `NpcLife`, `NpcWander`, `GuestNpc` |
| Creature/ecology presentation | PARTIAL | `CreatureCompiler`, `EvoSpawner`, event handlers |
| World/streaming/geography | LIVE locally / PARTIAL authority | `ContinentStream`, `WorldGeography`, `WorldField` |
| Canon/resource content | LIVE | Canon JSON and `WorldBook` |
| Quests/objectives | PARTIAL | `QuestLog` supported subset; blocked types remain open |
| Skills | PARTIAL | `SkillLattice` overlay plus local fallback slots |
| Inventory/economy | PARTIAL | `KitBag` presentation; kernel declared item owner |
| Social/gifts/plots | PARTIAL | `Bonds`, `GiftFeel`, `Plots`, gateway events |
| Dialogue | LIVE locally | `ConcordiaDialogueService`, `ConcordiaGame.SubmitTalk` |
| Server gateway | PARTIAL | `ConcordClient`, WebGL JS adapter; not runtime-verified |
| Consequence presentation | PARTIAL | `HandleFrame`, `WorldClock`, HUD/NPC presenters |
| Appearance persistence | LIVE | `AppearanceStore` JSON and PlayerPrefs |
| Living-world persistence | PARTIAL | `WorldMemory` JSON; many statics reset |
| CX art binding | PARTIAL | `CxDress`, `ModularPerson`, generated rigs/prefabs |
| PolyHaven/FreePacks requested bind | DISCONNECTED | referenced folders absent |
| KCC integration | DECORATIVE | package present; Concordia uses `CharacterController` |
| Root/Assets source authority | DUPLICATE | root `Scripts` vs canonical `Assets/Concordia/Scripts` |
| Concordia verification suite | MISSING | no Concordia-owned test assembly discovered |
| Runtime error containment | BROKEN risk | broad dynamic boot, optional gateway, no gameplay smoke test |

## 9. Highest-priority gaps before new gameplay implementation

1. Establish and test authority boundaries for movement, combat, NPC state, quests, inventory, and consequences.
2. Add a Concordia-owned verification harness: boot, input/movement, gate streaming, combat ack/refusal, blocked quest objective, appearance/world persistence, and no-gateway tests.
3. Unify input or explicitly document/test the dual legacy/Input System path. There is no project-owned InputActionAsset or rebinding contract.
4. Close quest and inventory persistence. `QuestLog` is a local subset and `KitBag` is explicitly not the full item economy.
5. Verify kitchen/live WebSocket reachability, handshake, reconnection, event schemas, WebGL bridge, and dialogue timeout behavior.
6. Resolve content/document drift by importing or retiring the referenced PolyHaven/FreePacks bind instructions.
7. Quarantine duplicate root `Scripts` authority so future edits cannot land in noncompiled/stale code.
8. Validate that consequences are durable, causally linked, and visible after reconnect/reload rather than only presented from events.

## 10. Phase 0 conclusion

The repository contains a substantial local Concordia presentation/runtime with dynamic Hub boot, streamed worlds, local movement/combat/NPC behavior, Canon data, WebSocket adapters, server-event presentation, and limited persistence. It does not yet present one fully verified gameplay authority: quests, inventory, NPC replication, movement, combat, consequences, and persistence cross local/client and server/kernel boundaries with documented fallbacks.

This genome is the baseline for the master gameplay directive. No new gameplay subsystem should be judged implemented until its input → authority → state → presentation → consequence → persistence → verification path is connected and tested against this ledger.
