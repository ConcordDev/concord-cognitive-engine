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
| WS connect + soul restore | `LeanPlay: skip EnsureConnected/RestoreAgentSoul (post-Expand stability)` | L328–335 |

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
