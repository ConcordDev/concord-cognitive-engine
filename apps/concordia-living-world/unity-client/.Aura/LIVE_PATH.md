# LIVE_PATH — what actually runs in LeanPlay

Captured 2026-10-24 from a real Play session in `Assets/Scenes/ConcordiaHub.unity`
(Unity 6000.5.9f1, `ConcordiaHost.LeanPlay = true`). Every fact below was read off the running
editor or the source; nothing here is inferred from the bible.

Reproduce the component list with `Concordia.Editor.ComponentDump.Dump()` (editor script), and the
stage marker with `Concordia.Editor.ComponentDump.BootPhases()`.

---

## 1. Boot order

`ConcordiaGame` spawns the world at runtime — there is **no `World` root object** in the scene. The
staged hub builder logs one line per phase (`[Concordia] staged hub phase=…`). Observed order:

```
guests   — 15 guests dressed one per frame: vesper, seraphine, jax, mama, zero, nyx, thorne,
           lyra, warden, asbir, archivist_maren, brackish, oldseam  (~1 s each)
guests_done
lore         ┐
city_ring    ├ same frame, back to back
forest       ┘
realmfill      (~5 s later)
crowd          (~30 s after realmfill)
realmfill_done (~25 s after crowd)
plaza          (last; the settled state)
```

Wall clock from first guest to `crowd` was ~68 s; `plaza` landed ~2 min in. `fps ≈ 3.6–4.1` and
`transforms ≈ 10.9k–11.2k` at `plaza` on this machine — that is the real baseline, not a target.

`Assets/Concordia/Generated/runtime-stage.txt` holds the **latest** stage string
(e.g. `… staged hub phase=realmfill_done`); it is overwritten, not appended, so use the console
`phase=` lines for the history.

## 2. What `ConcordiaGame` installs, and what it deliberately skips

Installed on the LeanPlay path (`Scripts/ConcordiaGame.cs`):

| Step | Call | Source |
|---|---|---|
| Kernel | `LocomotionKernel` + `CombatFeel` + `EvoResolver` live on the root | `ConcordiaGame.cs` |
| Character creator | offered only when `_needsCharacterCreator` | L301–304 |
| Gameplay core | `GameplayCoreBridge.Install(this, _player, chase, kernel)` — "locomotion-light" | L306–314 |
| Staged systems | `yield return _coreBridge.ExpandSystemsStaged()` (guests/plaza/crowd live here) | L317–318 |
| Quests | `OfferFoundingDay()` after any persistence restore (idempotent) | L326 |

Skipped on purpose, with the reason logged at runtime:

| Skipped | Log line | Line |
|---|---|---|
| Persistence restore | `LeanPlay: skip persistence Restore/ReceiveHere (post-Expand stability)` | L320–322 |
| Soul restore | `LeanPlay: skip RestoreAgentSoul (post-Expand stability)` (since B-09 the socket opens later, in `StagedConnect`) | L376–378 |

The persistence row is narrower than it looks: the full restore never runs in **any** mode. See §7.

Consequence for testing: **the client is offline by design in LeanPlay**, so `ConcordClient.Live`
has no gateway and `{ok:false, reason:'no_gateway'}` is the honest answer for server-backed reads.
Never treat that as a bug, and never start the server to make a check pass.

## 3. Live component map (56 types, 946 MonoBehaviours at `plaza`)

Counts from `ComponentDump.Dump()`; owner script is the assembly-relative file that declares the type.

| Live count | Type | Owner script |
|---|---|---|
| 89 | `CharacterVisualProfile` | `Scripts/CharacterVisualProfile.cs` |
| 89 | `ModularPerson` | `Scripts/ModularPerson.cs` |
| 89 | `PersonLabel` | `Scripts/PersonLabel.cs` |
| 89 | `StreamNpcPresence` | `Scripts/StreamNpcPresence.cs` |
| 84 | `NpcLife` | `Scripts/NpcLife.cs` |
| 81 | `GuestNpc` | `Scripts/GuestNpc.cs` |
| 74 | `LoreStone` | `Scripts/LoreStone.cs` |
| 41 | `QuestBoard` | `Scripts/QuestBoard.cs` |
| 36 | `BuildingPlace` | `Scripts/BuildingPlace.cs` |
| 27 | `UniversalAdditionalLightData` | URP runtime |
| 21 | `QuestBeacon` | `Scripts/QuestBeacon.cs` |
| 20 | `NpcWander` | `Scripts/NpcWander.cs` |
| 20 | `TrainingDummy` | `Scripts/TrainingDummy.cs` |
| 18 | `WorldVisualProfileMarker` | `Scripts/WorldVisualProfileMarker.cs` |
| 15 | `CreatureGenome` | `Scripts/CreatureGenome.cs` |
| 15 | `CreatureVisualProfile` | `Scripts/CreatureVisualProfile.cs` |
| 15 | `FaunaLife` | `Scripts/FaunaLife.cs` |
| 13 | `NpcLoreIdentity` | `Scripts/NpcLoreIdentity.cs` |
| 12 | `Hostile` | `Scripts/Hostile.cs` |
| 10 | `UniversalAdditionalCameraData` | URP runtime |
| 9 | `GatePost` | `Scripts/GatePost.cs` |
| 9 | `WorldGate` | `Scripts/WorldGate.cs` |
| 8 | `FlockOrbit` | `Scripts/FlockOrbit.cs` |
| 8 | `PortalShimmer` | `Scripts/PortalShimmer.cs` |
| 7 | `SkillPylon` | `Scripts/SkillPylon.cs` |
| 5 | `Gatherable` | `Scripts/Gatherable.cs` |
| 5 | `UsePlace` | `Scripts/UsePlace.cs` |
| 4 | `CourtBannerSway` | `Scripts/CourtBannerSway.cs` |
| 4 | `StreamNavChunk` | `Scripts/StreamNavChunk.cs` |
| 3 | `OrganicBindMarker` | `Scripts/Organic/OrganicBindMarker.cs` |
| 1 each | `ChaseCamera` | `Scripts/ChaseCamera.cs` |
| 1 | `CinemachineBrain` / `CinemachineCamera` / `CinemachineHardLookAt` / `CinemachineOrbitalFollow` | Cinemachine |
| 1 | `CityGate` | `Scripts/CityGate.cs` |
| 1 | `CombatFeel` | `Scripts/CombatFeel.cs` |
| 1 | `ConcordClient` | `Scripts/ConcordClient.cs` |
| 1 | `ConcordiaGame` | `Scripts/ConcordiaGame.cs` |
| 1 | `ConcordiaHUD` | `Scripts/ConcordiaHUD.cs` |
| 1 | `ConcordiaPlayer` | `Scripts/ConcordiaPlayer.cs` |
| 1 | `ContinentStream` | `Scripts/ContinentStream.cs` |
| 1 | `CourtHeroRimFollow` | `Scripts/CourtHeroRimFollow.cs` |
| 1 | `EvoResolver` | `Scripts/EvoResolver.cs` |
| 1 | `Footsteps` | `Scripts/Footsteps.cs` |
| 1 | `LivingBody` | `Scripts/LivingBody.cs` |
| 1 | `LocomotionKernel` | `Scripts/LocomotionKernel.cs` |
| 1 | `RemotePlayers` | `Scripts/RemotePlayers.cs` |
| 1 | `Volume` | URP core |
| 1 | `WorldBreath` | `Scripts/WorldBreath.cs` |
| 1 | `WorldBuilder` | `Scripts/WorldBuilder.cs` |
| 1 | `WorldHeroMarker` | `Scripts/WorldHeroMarker.cs` |
| 1 | `WorldHostClient` | `Scripts/WorldHostClient.cs` |
| 1 | `WorldStreamManager` | `Scripts/WorldStreamManager.cs` |
| 1 each | `DefaultDeferAgent`, `TimeBudgetPerFrameDeferAgent` | glTFast |

Scene roots observed at `plaza`: `ConcordiaGame`, `Player`, `ConcordClient`, `RemotePlayers`,
`WorldHostClient`, `WorldBuilder` (4 children), `Megaworld/*` (`CourtGround`, `CourtWalkableHorizon`,
`HubWilderness`, `Chunk_Hub`, `ContinentGround`, `FarGeography_*`), `CourtLookRig/*`,
`ChaseCam/OrbitVCam`, `GlobalVolume`, `EnvProbe`, `WorldBreath`, `Nameplate`.

## 4. Combat path (one grammar)

```
ConcordiaInput.Down(Heavy|Special|Light)          Scripts/Aura/ConcordiaInput.cs
  → ConcordiaPlayer.TryAttack / TrySpecial        Scripts/ConcordiaPlayer.cs
    → Core.AttackContext { Damage, PoiseDamage, ReachMeters, DistanceMeters, Impulse }   L801–808
      → Core.HitResolver.Resolve(attack, _body, _action)                                 L811
        → Core.HitResult { Outcome = Parried | Dodged | Blocked | Hit }
          → CombatFeel.Present(result, position)                                        L813
```

`_action` is the player's `Core.ActionRunner` (`Scripts/Core/ActionRunner.cs:70`); it carries guard
and dodge i-frame state (`_action.IsInvulnerable`, L810) and is passed as `null` when the player is
already invulnerable so a wrong-counter dodge keeps its i-frames.

**`GameplayCore/Combat/CombatContracts.cs:155` `CombatDefenseEvaluator` is DISCONNECTED.** It is
never wired: `HitResolver` is the only defence evaluator that runs. Do not connect it, and do not
add a third one — `GameplayCoreBridge.cs:479` and `CombatContracts.cs:154` both say so in comments.

`Hostile.cs:183` documents the same single grammar for incoming damage:
`ConcordiaPlayer.TakeHit → Core.HitResolver`.

## 5. Input path (B-06 / B-07)

- Asset: `Assets/Concordia/Resources/Concordia/ConcordiaControls.inputactions` — 21 actions,
  42 bindings, keyboard + gamepad. Loaded from `Resources` because that is the only path Unity can
  load at runtime.
- Wrapper: `Scripts/Aura/ConcordiaInput.cs` — one entry point for gameplay; raw key first (identical
  keyboard feel), action second (gamepad + logged press), PlayerPrefs remaps applied on load.
- Remaps: `concordia.input.overrides` (Input System override JSON), written by
  `StartRebind` → `SaveOverrides`, cleared by `ResetOverrides`.
- UI: `ConcordiaHUD` I-menu tabs — `KIT`, `SETTINGS` (B-05), `CONTROLS` (B-07, rows generated from
  `ConcordiaInput.Panel` + `BindingLine`).

## 6. Known-good baseline numbers

| Metric | Value at `plaza` |
|---|---|
| fps | 3.6–4.1 |
| transforms | ~10.9k–11.2k |
| live MonoBehaviours | 946 |
| hero | present, `heroMeshes=1`, `pos=(11.2, 0.1, -12.0)` |
| console | `errors=0`; the only warnings are pre-existing CS0618 obsolete-API warnings in `Editor/LookCapture.cs`, `Scripts/ContinentStream.cs`, `Scripts/GameplayCore/Persistence/ConcordiaPersistenceService.cs` |

## 7. Persistence (A-33 audit, 2026-10-25)

Read from source at `aura/gameplay` 38ae3a78d. `ConcordiaPersistenceTests` (EditMode): **8/8 pass**.

### 7.1 The file

`ConcordiaPersistenceService` (`Scripts/GameplayCore/Persistence/ConcordiaPersistenceService.cs`) owns one
versioned JSON envelope, `Application.persistentDataPath/concordia-unified-v1.json` (schema 1). In the web
build `persistentDataPath` is browser IndexedDB, so the save is per browser, not per account.

### 7.2 What `Restore(envelope)` (L176) would restore, in order

| # | Section | Target | Notes |
|---|---|---|---|
| 1 | world | `WorldClock` (world, hour, day, weather, ecology, prices, faction heat), `WorldMemory` slices + CSVs, `WorldEventLog`, `FactionStandingBook` | |
| 2 | player | `ConcordiaPlayer` hp/stamina/poise/hostility, position, rotation, talk log; `KitBag` items, art, equipped, held weapon; `LivingBody` hunger/fatigue | hp is a **local** number; online, the server owns hp (`combat-hp-authority.js`) |
| 3 | quests | `QuestLog.Active` (with objective flags) and `QuestLog.Done` | wipes both first; quests not found in `WorldBook` are dropped |
| 4 | skills | `SkillLattice` group/active/counts, `SkillLedger.LastArt` | counts only, no per-skill progress |
| 5 | npcs | `NpcLife` position, home/work/post, job, activity, pinned; `GuestNpc.hailed`; `Bonds` | matched by actor id or object name; NPCs not spawned yet are skipped silently |
| 6 | worldSystems | `WorldSystemsHost.Active` buildings + storefront | |
| 7 | worldSimulation | `WorldSimulationHost.Active` | |
| 8 | economy | `GameplayCoreBridge.Live.Economy` inventories, gathering, recipes, consequences | |
| 9 | worldFabric | `WorldFabricRuntime.Active` | |
| 10–13 | fabrication, gunsmithing, spellcrafting, containers | through `GameplayCoreBridge.Live` | no-op when the bridge is absent |
| 14 | vehicles | `VehicleEntity` state, motion, autopilot, storage, equipment, relationships, seats | |
| 15 | consequences | `RecordedEvents` (non-combat), world feed | |

Each step returns quietly when its target does not exist yet, so call order against boot matters.

### 7.3 What actually runs today

**Nothing calls `Restore` or `LoadAndRestore`, in LeanPlay or in Full Play / player builds.** The service
landed in `07a8154db` (2026-09-22) with the call already left out. `ConcordiaGame.Start` loads the
envelope (L51), and the Full-mode branch at L137–140 is an empty block that reads "stash for then"; there
is no "then". The LeanPlay branch (L366–368) only logs the skip.

What does round-trip, through separate hooks:

| Section | Restored by | When |
|---|---|---|
| world memory (slices, CSVs, event log, faction standing) | `TryLoad` → `WorldMemory.ApplyPersistence` | `ConcordiaGame.Start`, L51 |
| active world | `ConcordiaGame.Start` reads `world.activeWorld` | L52–56 (LeanPlay then forces Hub) |
| worldFabric | `GameplayCoreBridge` L224 | first fabric bind |
| worldSystems | `GameplayCoreBridge` L511 | host creation |
| economy | `GameplayCoreBridge` L673 | first economy bind |
| worldSimulation | `WorldSimulationHost.Awake` → `TryRestoreWorldSimulation` | when `loadOnAwake` |

**Never restored:** player, quests, skills, npcs, fabrication, gunsmithing, spellcrafting, containers,
vehicles, consequences. (`GameplayCoreBridge.RestoreContainers` exists, but its only caller is
`Restore`.)

### 7.4 Why that matters: saves overwrite progress

Saves still run, and `Capture()` writes **every** section from live state:

- `GameplayCoreBridge.Save` from `OnDisable`. Player builds always; the editor skips it during Play stop.
- `ConcordiaGame.OnApplicationQuit`. Player builds only.
- `WorldBook.Leave` and `WorldBook.Dump`, plus `WorldSimulationHost.Save`.

So in a player build each session boots fresh and then saves that fresh state over the last one. Quests,
skills, kit and the rest are lost on the next quit, not merely left unrestored. World memory and the
systems listed in 7.3 survive because they were restored before the save.

### 7.5 Why LeanPlay skips it

The skip arrived with the service in `07a8154db` (2026-09-22), commented as part of the "post-Expand
melt": the work right after `ExpandSystemsStaged` stalled the editor. The same commit noted that the socket
connect and `RestoreAgentSoul` "both sat on the ~28–29s post-Expand melt"; no timing was recorded for
`Restore` itself. `Restore` is synchronous and touches `FindObjectsByType<NpcLife>` (84+ live),
every vehicle, and the WorldBook quest lookup in one frame. That is the cost A-34/A-35 must stage.

### 7.6 For A-34 / A-35

- Restore after boot idle, one section per frame, as the roadmap says. Suggested order: quests → skills →
  player kit → npcs last (they must be spawned). World and faction standing already come back via `TryLoad`.
- Online, skip `player.hp/stamina/poise` from the local file; the server owns hp.
- Until restore ships, the overwrite in 7.4 continues in the web build. A cheap guard is to skip capture of
  any section that was loaded but never restored this session, so the file keeps the last real value. That
  is a change to `ConcordiaPersistenceService` and belongs with A-34.
- Test gap: no EditMode test covers player, quest or skill round trips. The 8 tests cover world simulation,
  world memory and faction standing only.
