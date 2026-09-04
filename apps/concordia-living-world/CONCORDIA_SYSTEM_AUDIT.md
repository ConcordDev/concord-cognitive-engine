# CONCORDIA_SYSTEM_AUDIT

**Date:** 2026-09-01  
**Method:** file read + Unity Editor play (fresh `AppearanceStore.Clear()`, creator → Court → Lamplighter interact).  
**Rule:** a file existing is not LIVE. LIVE requires a runtime path that fired, or a test that invokes it.

Three trees, one product name:

| Tree | Path | What it is |
|---|---|---|
| Browser kernel | `apps/concordia-living-world/src/game/` | Systemic RPG (combat physics, NpcBrain, persist slices, politics, quests) |
| Unity client | `apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/` | 32 C# behaviours. What a player in the Editor actually enters |
| Concord server | `server/` (`lib/unity-bridge.js`, `lib/godot-gateway.js`, combat routes) | Intended authority. Not connected this play (`ConcordClient.Connected=false`) |

Statuses: **LIVE** · **PARTIAL** · **WIRED-BUT-UNUSED** · **STALE** · **BROKEN** · **MISSING** · **UNKNOWN**

Confidence: **H** runtime this session · **M** code-path read, not this session · **L** inferred, do not trust

---

## Fresh-character runtime (2026-09-01)

| Beat | Result |
|---|---|
| Creator | Opens. Title THE UNBURNED COURT. Outfits named by world. **H** |
| Presentation | Magenta plaza. Soldier mesh T-pose. HUD bleeds through creator. **H** |
| Enter Court | HUD FLOWER-LAW, vitals, compass, control strip. **H** |
| Lamplighter | Interact returns authored refusal line. **H** |
| Objectives lamp/ring/scheme/arena/gate | Not in Unity HUD. Exist only in `src/game/content.ts` `OBJECTIVES`. **H** |
| Arena dummy | Exists, hp 80. SteelLive false at spawn, true on sand. Light TryAttack from 2.1m did not drop hp (miss). **H** |
| Concord socket | `wss://live.concordos.ai/unity-ws` — **not open**. **H** |
| World clock / schemes / persist slices | Not observed. **H** |

---

## Subsystems

### Worlds / refusals / Hub

| Field | |
|---|---|
| Status | **LIVE** (registry + laws + guests) |
| Files | Unity `Canon.cs`; browser `worlds.ts`, `content.ts`, `bible.ts`; JSON `Assets/Concordia/Resources/Concordia/Canon/` |
| Entrypoints | `Canon.Get`, `WorldBuilder.Build`, `ConcordiaGame.Travel` |
| Dependencies | `WorldBook`, `WorldKit`, `HubPlaza`, `RealmFill` |
| Runtime | Nine `WorldId`s, eight gates, Hub guests including Lamplighter. Travel swaps hold (second World root until `DestroyImmediate`). **H** |
| Tests | Browser/kernel tests exist under living-world scripts; Unity travel untested. Server `world-terrain-parity.test.js` hashes world ids |
| Unity | Presentation of Canon |
| Concord | World ids shared; Unity does not load server world slice |
| Authority | **Split illegally today** — Unity owns travel + local dummy HP |
| Missing | WorldLaw object (visual/audio/npc/econ effects), Hub objectives, persistent slice |
| Upgrade | Keep refusals. Move travel + steel + dummy HP onto Concord. |
| Confidence | **H** |

### Fighting styles

| Field | |
|---|---|
| Status | **PARTIAL** |
| Files | `Canon.cs` `StyleDef`; browser `abilities.ts`, `powers.ts` |
| Entrypoints | `ConcordiaPlayer.TryAttack` / `TrySpecial` reads `style.light/heavy/special` as **toast strings**; `massMul/speedMul/poiseMul` scale numbers |
| Runtime | Special in Tunya restores poise; Fantasy hostility; Hub flower-burst. No frame data, no parry. **H** |
| Authority | Should be Concord. Unity local today |
| Missing | Port `combat.ts` kinematics onto server; Unity presents |
| Confidence | **H** |

### Combat (momentum / poise / stagger / parry / i-frame)

| Field | |
|---|---|
| Status | Browser **LIVE** in TS · Unity **MISSING** (hitscan) · Server **WIRED-BUT-UNUSED** from this client |
| Files | `src/game/combat.ts` (momentum, stagger graze→knockdown, PARRY_WINDOW_MS=180, IFRAME_DODGE_MS=350); Unity `ConcordiaPlayer.HitScan`, `TrainingDummy`, `CombatFeel`; `server/routes/combat.js`; `ConcordClient.SendAttack` |
| Runtime | Unity SphereCast → `dummy.Hit(dmg)`. No stagger ladder. Dodge is a velocity shove (`KeyCode.X`), not i-frames. Socket down. **H** |
| Tests | `combat.ts` consumed by browser; `godot-gateway.test.js` for gateway; Unity combat untested |
| Authority | **Must be Concord.** Today Unity invents damage |
| Upgrade | Client sends intent; server `applyAttack`; Unity plays feel from ack |
| Confidence | **H** |

### NPC identity / guests

| Field | |
|---|---|
| Status | **LIVE** (authored) |
| Files | `Canon.HubGuests`; `WorldBook.People`; `GuestNpc` |
| Runtime | Lamplighter line fired. Names/titles/positions in Canon. **H** |
| Missing | Relationship **state** (Elias↔Vesper etc. are prose, not edges) |
| Confidence | **H** |

### NPC brain / Radiant-style goals

| Field | |
|---|---|
| Status | Browser **PARTIAL** (`npc-life.ts` `NpcBrain` + hour schedule) · Unity **STALE/ABSENT** |
| Files | `src/game/npc-life.ts` (`need`, `trust`, `fear`, sleep/work/eat/scheme/hide/gather); Unity `NpcLife.cs` enum Wander/Stall/Sit/Sweep/Watch |
| Runtime | Unity sweepers oscillate 2.4m. No hunger, no hour, no faction heat. **H** |
| Tests | None pinning Unity jobs |
| Authority | Concord |
| Upgrade | Port `brainFor`/`autonomyTarget` as L1; 2B is L4+ |
| Confidence | **H** |

### Schemes / Hub tutorial objectives

| Field | |
|---|---|
| Status | Browser **LIVE** (`OBJECTIVES`, scheme toasts) · Unity **MISSING** |
| Files | `src/game/content.ts` 345–351; `store.ts` `done` |
| Runtime | No lamp/ring/scheme/arena/gate tracker in Unity. **H** |
| Confidence | **H** |

### Memory / affect / wants / 2B

| Field | |
|---|---|
| Status | **MISSING** in Concordia play loop |
| Files | Platform DTU/affect exist under `server/` — **not** wired to Concordia NPCs |
| Runtime | Not observed |
| Authority | Concord |
| Confidence | **H** (absence) |

### Factions / politics

| Field | |
|---|---|
| Status | Browser **PARTIAL** (`politics.ts`, `bible.ts` FACTIONS) · Unity **PARTIAL** (JSON camps + lore stones, no sim) |
| Files | `RealmFill.Factions`; `WorldBook.Factions`; `src/game/politics.ts` |
| Runtime | Stones spawn with motto/goal text. No heat, no tick. **M** |
| Authority | Concord |
| Confidence | **M** |

### Economy / crafting

| Field | |
|---|---|
| Status | Unity **MISSING**. Platform ledger **LIVE** elsewhere, not this client |
| Files | `persist.ts` `prices`; Concord `economy_ledger` |
| Runtime | No prices, wages, inventory in Unity |
| Confidence | **H** |

### Ecology / creatures / evo

| Field | |
|---|---|
| Status | **PARTIAL** |
| Files | `Canon.fauna`; `EvoSpawner`; `Hostile`; browser `creatures.ts`, `evo.ts`, `wild.ts` |
| Runtime | Dummy + Hostile on steel worlds. No births/deaths/migration persistence |
| Confidence | **M** |

### Quests / consequence graph

| Field | |
|---|---|
| Status | **PARTIAL** |
| Files | `WorldBook.Quests`; `RealmFill.Quests` → `LoreStone`; browser `quests.ts` |
| Runtime | Boards with title/text. No accept, no completion, no provenance graph |
| Confidence | **M** |

### Persistence / world continues

| Field | |
|---|---|
| Status | Browser **PARTIAL** (`persist.ts` localStorage slices) · Unity **MISSING** (appearance file only) |
| Files | `AppearanceStore.cs`; `src/game/persist.ts` |
| Runtime | `concordia_appearance.json`. No day/hour/ecology/dead/births |
| Confidence | **H** |

### Cross-world plots

| Field | |
|---|---|
| Status | Browser **PARTIAL** (`cross.ts`) · Unity **MISSING** |
| Confidence | **M** |

### Audio

| Field | |
|---|---|
| Status | Browser **PARTIAL** (`audio.ts` WebAudio bus) · Unity **WIRED-BUT-UNUSED / BROKEN** |
| Files | `WorldBuilder.DressAudio` paths `Assets/Audio/Background_Music_*.prefab` — those folders were **not** in the Unity Assets listing |
| Vrellan Six | **MISSING** (only `Kree`→`Vrellan` lore rename in migrations/docs) |
| Confidence | **H** |

### Animation

| Field | |
|---|---|
| Status | **BROKEN / PARTIAL** |
| Files | `Soldier.glb` Idle/Walk/Run; `SoldierAnimSetup.cs`; `MixamoAvatar.cs`; `ModularPerson` |
| Runtime | Player/NPCs T-pose. Controller path was `Models/living/Soldier.glb` (empty); now `Models/humans/Soldier.glb` — not verified walking this session |
| Confidence | **H** |

### Rendering / streaming / ECS

| Field | |
|---|---|
| Status | Rendering **PARTIAL** · Streaming/ECS **MISSING** |
| Runtime | Magenta (Standard/glTF on URP). Hub ~1143 children. Two `World` roots until DestroyImmediate. No DOTS, no world streaming |
| Confidence | **H** |

### Network / Unity–Concord contract

| Field | |
|---|---|
| Status | **WIRED-BUT-UNUSED** |
| Files | `ConcordClient.cs`; `server/lib/unity-bridge.js` (`/unity-ws` via `mountGodotGateway`); `server.js` ~70823 |
| Runtime | Connect failed / not open. Envelope `{evt,data}`; combat uses `combat:attack` |
| Tests | `server/tests/godot-gateway.test.js` |
| Authority | Intended Concord. Actual Unity local |
| Confidence | **H** |

### MCP

| Field | |
|---|---|
| Status | **LIVE** (CoplayDev stdio, ports 6400 play / 6401 edit) |
| Missing | Official Unity MCP relay unused. Play-mode domain reload drops session |
| Confidence | **H** |

---

## Authority violations (must close before 2B)

1. Unity `HitScan` writes dummy HP.  
2. Unity `Travel` is the world-state transition.  
3. Unity `AppearanceStore` is the only save.  
4. 2B must not declare dodge/parry/kill.

Claim path required by spec: CLAIMED → EXECUTED → OBSERVED → VERIFIED → COMPLETED.

---

## Recommended order (do not skip)

1. This audit (done).  
2. Living bible under `apps/concordia-living-world/bible/` (LIVE vs TARGET).  
3. **P0 Hub + Sovereign Ruins slice:** readable Court, Soldier walk, Lamplighter objective, arena hit that changes HP, one gate to Ruins and back, **one World root**, socket or honest `{ok:false, reason:no_gateway}`.  
4. Port `combat.ts` + `NpcBrain` L1 onto Concord.  
5. 2B as action chooser only.

Do not implement Move Forge, faction meta, or ecology evolution before a walker can live 15 minutes in the Hub without magenta and with a dummy that takes a hit.
