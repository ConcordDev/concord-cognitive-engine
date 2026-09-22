# Built vs Presented — Concordia / Concord workspace audit

**Date:** 2026-09-22 ~00:46 EDT  
**Auditor:** Grok Bot executor subagent  
**Intended Mac:** `0366bc4e-b815-4ea5-9979-fc382d0cee76` (user `dutch`)  
**Intended paths:**  
- Engine: `/Users/dutch/concord vs code/concord-cognitive-engine`  
- Unity: `…/apps/concordia-living-world/unity-client`  
- Ops: `/Users/dutch/.zuko/` (`FULL_SCALE_RPG_RESEARCH_AND_CONCORD_AUDIT.md`, `FULL_SCALE_RPG_TLDR.md`)  
- Runtime: `/Users/dutch/concord`  

## Access / evidence caveat (read first)

This subagent’s Shell/Read **do not route `machineId`** — commands always execute on `grok-bot-vm-*` (`HOME=/home/box`). Mac paths `/Users/dutch/…` and Mac `~/.zuko` are **unreachable** from this agent (same class of blocker as prior `qa-2026-09-14-present-receive/00-blocker-no-mac-access.txt` and `CONCORDIA_SYSTEMS_AUDIT_2026-09-21.md`). ListMachines / CopyToBox / Unity MCP `:6400` are not in this subagent’s tool surface.

**Therefore live evidence is:**

| Source | Role |
|---|---|
| GitHub `ConcordDev/concord-cognitive-engine` `main` (raw + tree, 2026-09-22) | Authoritative tracked Concord + Unity + `content/` counts |
| In-repo `apps/concordia-living-world/CONCORDIA_SYSTEM_AUDIT.md` (2026-09-01 Play) | Last honest Editor Play LIFE-style pass |
| `docs/STACK_REALITY.md` (2026-09-05), `docs/STATE_OF_CONCORD.md`, `docs/NOVELTY_INVENTORY.md` | Concord engine honesty + “already invented” map |
| Box `/workspace/src-mirror` + `/workspace/PLAYER_LIFE.md` + Sep-21 systems/lore audits | Mac-ahead Unity deltas (ContinentStream/HubLook/RoadWorld/GossipEar…) not all on `main` yet |
| Mac `FULL_SCALE_RPG_*.md` | **NOT READ** (Mac-only). Treated as baseline *intent*, refreshed with live GitHub + Play evidence instead of copying |

**Mac write of this file to `/Users/dutch/.zuko/…` and Unity `Assets/Concordia/Generated/` could not be performed.** Box copies: `/home/box/.zuko/` and `/workspace/audit/`.

---

## Thesis answer (one paragraph)

**Most full-RPG *systems* already exist in Concord** (server domains/emergent/lib + `content/world` + `content/quests` + browser living-world kernel). **The Unity Hub client presents a thin but real vertical slice** (creator → Court walk → interact → gates → SoftEnter travel → local combat/dummy/road hostiles → SkillLattice slots → quest *boards/text*). **A cold player today feels travel, plaza look work-in-progress, talk lines, and hitscan combat — not quest completion graphs, faction standing, gossip heat, boss raids, mounts, companions, economy, or Concord-authoritative combat.** So the user’s claim is **directionally true for invention** and **false if “exist” means “feel it in Play”**: the gap is mostly **presentation/binding + Hub Play loop wiring**, plus a **real content thinness** on quests-per-world density, unique creature meshes, and named boss/raid encounters.

Bucket legend used below:  
1. **BUILT + PRESENTED** — code/data AND a cold player can feel it in Hub Play (cite Play proof or clear wiring).  
2. **BUILT, NOT PRESENTED** — real Concord/Unity systems or JSON, but stranger wouldn’t notice in Hub Play.  
3. **THIN / PARTIAL** — scaffolding or one vertical slice.  
4. **MISSING** — not in workspace in meaningful form.

---

## Content inventory (live counts from GitHub `main`, 2026-09-22)

### Worlds
10 world folders under `content/world/`: `concordia-hub`, `fantasy`, `tunya`, `crime`, `cyber`, `sovereign-ruins`, `concord-link-frontier`, `superhero`, `sere`, `lattice-crucible` (+ `_shared`). Unity `Canon` / `WorldId` also knows Hub + these (Crucible/Sere included in client).

### Authored NPCs / factions / creatures (`content/world/*/npcs*.json` etc.)
| World | NPCs (+extra) | Factions (+extra) | Creatures / bestiary |
|---|---:|---:|---:|
| concordia-hub | 16 | 5 | 3 |
| fantasy | 11+19=30 | 8 | 5 |
| tunya | 36 | 14 | bestiary 33 |
| crime | 10+20=30 | 7+1=8 | 5 |
| cyber | 10+23=33 | 7+1=8 | 5 + bestiary 6 |
| sovereign-ruins | 13+18=31 | 6+2=8 | 3 |
| concord-link-frontier | 10+20=30 | 6+2=8 | 3 |
| superhero | 12+18=30 | 7+1=8 | 5 |
| sere | 8+26=34 | 11 | bestiary 5 |
| lattice-crucible | 11+19=30 | 6+2=8 | 3 |
| **SUM** | **~300** | **~86** | **~76** |

Also: `content/world/npcs.json` (36), `content/world/factions.json` (8).  
Unity packages a subset under `Assets/Concordia/Resources/Concordia/Canon/<folder>/{npcs,factions,creatures,lore,quests/}` — **WorldBook loads these** (`People` ← `npcs`/`npcs-extra`; `Quests` ← `Resources.LoadAll` on `…/quests`).

### Quests (authored files)
| Bucket | Count (files) | Notes |
|---|---:|---|
| `content/quests/*.json` (top-level) | **15** | ~**60** quest/step id hits (onboarding 11, main-arc 7, faction-quests 8, …) |
| `content/quests/sub-worlds/*` | **21** (7 worlds × 3) | fantasy/crime/cyber/ruins/frontier/superhero/crucible chains |
| `content/world/tunya/quests/` | **4** | arks-of-memory, bloc-secret, nil-protection, vessine-origin |
| `content/world/sere/quests/` | **1** | main-arc (~14 id hits incl. objectives) |
| Unity Canon hub `quests/` | **8** mirrored into Resources | brackish-trust, first-adaptation, first-day-arc, founding-day-reading, impossible-print, nesha-old-seam, onboarding, sealed-record |
| Unity Canon fantasy `quests/` | **3** | lyra / maeris / seraphine |
| Unity Canon tunya `quests/` | **4** | same as world folder |
| **Approx chain files** | **~41** | Not “hundreds of radiant quests” |

`content/items.json` ≈ **11** items; `content/skills.json` ≈ **3** skill records (platform skills — SkillLattice is separate Unity/kernel catalog).

### Unity client scripts (`apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/` on `main`)
~**40** C# behaviours tracked, including: `ConcordiaGame`, `ConcordiaPlayer`, `ContinentStream`, `WorldBuilder`, `WorldBook`, `WorldGate`, `RealmFill`, `HubPlaza`, `HubLook`, `HubObjectives` (SkillLattice), `NpcLife`, `Hostile`, `TrainingDummy`, `CombatFeel`, `CreatureCompiler`, `Evo*`, `ConcordClient`, `AppearanceStore`, `ModularPerson`, `MegaworldMap`, …  

Box `/workspace/src-mirror` also carries Mac-ahead names (`RoadWorld`, `GossipEar`, `CxDress`, `WorldClock` embedded in WorldBook, `WorldBoss` in WorldGate, empty stubs for some). Treat Mac worktree as **≥ main** for presentation systems.

### Concord engine (already invented — do not rebuild)
From `docs/NOVELTY_INVENTORY.md` + `STATE_OF_CONCORD.md` / `STACK_REALITY.md`:
- NPC routines, economy, legacy/death, asymmetry, nemesis, mentorship  
- Faction strategy (L11), faction rep cache, party LFG + raid variant  
- Combat suite (`lib/combat/*` boss-phases, faction-war, telegraph-peril, …)  
- Quest engine + lattice-born / drift→quest / citation→quest / event cascades  
- Mounts domain (`domains/mounts.js`), village gossip feed (frontend), sovereign mass raid  
- Embodied layers, forward-sim, dreams, consequence cascade  
- ~**140** heartbeats, **267** lenses, **~2.8M** authored LOC — **PARTIAL organs dominate**; Concordia **server-authoritative combat/travel still TARGET** (`STACK_REALITY.md`)

Browser living-world kernel (`apps/concordia-living-world/src/game/`) holds combat.ts momentum/parry/i-frame, npc-life brain, persist slices, politics, quests — **not the Unity Play authority today**.

---

## Surface-by-surface classification

### 1. Persistence / save-load
| Bucket | **THIN / PARTIAL** (Unity) · **BUILT, NOT PRESENTED** (Concord/browser) |
|---|---|
| Evidence | Unity: `AppearanceStore` only (`concordia_appearance.json`) — SYSTEM_AUDIT 2026-09-01 **H**. Browser: `persist.ts` localStorage slices. Concord: world tables (`world_npcs`, `faction_strategy_state`, dreams, corpses, quests…) exist server-side. |
| Cold player feels | Outfit/appearance survives; **not** day/ecology/kills/quest progress across sessions. |
| Bring-to-life | Bind Concord persist slice → Unity HUD “yesterday still hangs” (PLAYER_LIFE law 2). |

### 2. World memory, event log, gossip, faction standing, witness heat
| Bucket | **BUILT, NOT PRESENTED** (Concord + partial Unity scaffolding) |
|---|---|
| Evidence | Concord: consequence-cascade, village gossip feed, faction-strategy, npc asymmetry/grudges, secrets→quest-gate. Unity: `WorldClock`/`WorldMemory` fields in WorldBook (`FactionHeat`, feed beats, event kinds per world); Mac-ahead `GossipEar`; PLAYER_LIFE: dummy HP ≠ rivalry; Sep-21 audit: kill→gossip counters stayed 0 (cascade bugs). SYSTEM_AUDIT: schemes/persist **not observed** in Play. |
| Cold player feels | Almost nothing lasting — maybe heat number if HUD shows it; no witness talk loop. |
| Bring-to-life | Wire kill/talk → GossipEar + feed + faction sash/HUD; fix cascade clobber on Hub SoftEnter. |

### 3. Quests (authored counts, QuestLog, givers, chains)
| Bucket | **THIN / PARTIAL** presented · **BUILT, NOT PRESENTED** for server quest engine + most chains |
|---|---|
| Evidence | ~41 authored chain files; Canon hub packages 8; WorldBook `Quests`/`OfferedBy`/`QuestLog` wired in `ConcordiaGame` (boards, NPC offer, NoteTalk/Location/Gather). SYSTEM_AUDIT / PASS_LOG: boards are **readable text**; accept/complete/provenance **not** proven. Server `quest-engine.js`, lattice quests, event cascades **unused by Unity**. |
| Cold player feels | Can read a board / hear a line with a quest offer toast — **not** a finished chain or order-independent radiant net. |
| Bring-to-life | One Hub onboarding chain end-to-end (accept → objective ticks → turn-in) using existing Canon JSON; then bind giver_npc_id → GuestNpc. |

### 4. Dialogue / NPC conversation
| Bucket | **THIN / PARTIAL** |
|---|---|
| Evidence | Authored lines + Lamplighter refusal (**LIVE** 2026-09-01). `ConcordiaGame.SubmitTalk` / AskTwoB needs gateway (`no_gateway` path). Concord oracle / quest-dialogue-composer / npc-dialogue L13 not Unity-presented. Convai settings asset exists in Resources — not proof of live AI talk. |
| Cold player feels | Short authored lines; typed talk fails closed without Concord socket. |

### 5. Factions / reputation
| Bucket | **BUILT, NOT PRESENTED** (data+server) · **THIN** in Unity |
|---|---|
| Evidence | ~86 world factions JSON + lore stones (`RealmFill`); `PersonKit.FactionOf`; ModularPerson FactionSash; migrations for faction rep cache. No standing UI / consequences in Play audit. |
| Cold player feels | Camp mottos on stones; not reputation. |

### 6. Character builds / skills / SkillLattice
| Bucket | **THIN / PARTIAL** (presented slots) · **BUILT, NOT PRESENTED** (Concord skill XP / combat suite) |
|---|---|
| Evidence | `HubObjectives.SkillLattice` — slots 1–3, group cycle, HudLine; `ConcordiaPlayer` keys Alpha1–3; pylons in WorldBuilder. `content/skills.json` only ~3. VfxPath → GabrielAguiar often unwired. |
| Cold player feels | Can swap skill slot / see HUD line; not a deep build tree. |

### 7. Combat, weapons, boss raids / named encounters
| Bucket | Combat: **THIN / PARTIAL** presented · Boss raids: **BUILT, NOT PRESENTED** (server) / **THIN** (Unity delve/WorldBoss) |
|---|---|
| Evidence | Unity: HitScan → TrainingDummy / Hostile; CombatFeel; styles as toast multipliers (SYSTEM_AUDIT). Browser `combat.ts` has momentum/parry/i-frame — **not** in Unity. Server `lib/combat/*` boss-phases + `defeatBoss` lockouts + sovereign raid — **Unity does not call**. RoadWorld delve bosses / `WorldBoss.Present` = local presentation hooks. Spoils path historically broken (Sep-21). |
| Cold player feels | Can hit a dummy / road hostile; **not** a named raid or phase boss as product. |
| True gap | Named boss defs + raid schedules per world still thin vs desire; server has scaffolding, content sparse. |

### 8. NPC life simulation (schedules, travelers, patrols)
| Bucket | **BUILT, NOT PRESENTED** (Concord routines) · **THIN** Unity (`NpcLife` Wander/Stall/Sit/Sweep/Watch) |
|---|---|
| Evidence | `lib/npc-routines.js`, economy, scheme cycles. Unity sweepers oscillate (~2.4m) — SYSTEM_AUDIT **H**. ContinentStream `ReceiveTraveler` exists (traveler presentation). Schedules JSON in cyber/sere/tunya — not driving Unity jobs. |
| Cold player feels | Ambient wanderers; not hour-of-day life. |

### 9. Travel, mounts, vehicles, biome streaming (Hub↔Sundering)
| Bucket | Travel/streaming: **BUILT + PRESENTED** (with caveats) · Mounts/vehicles: **BUILT, NOT PRESENTED** / **MISSING** in Unity |
|---|---|
| Evidence | ContinentStream SoftEnter / MegaworldMap / gates — PLAYER_LIFE **LIVE** (law crossing, Present receive). Live-play shots on box show Hub/Sundering/Fantasy SoftEnter. Mounts: `domains/mounts.js` + novelty #191 — **no Unity mount locomotion**. Vehicles: frontend vehicle-renderer exists; Unity Hub Play **no**. |
| Cold player feels | Walk/gate between megaworlds; **not** rides. |

### 10. Companions / party
| Bucket | **BUILT, NOT PRESENTED** (LFG/party migrations) · **MISSING** in Unity Play |
|---|---|
| Evidence | `migrations/219_party_lfg.js`; no Companion component in Unity Scripts tree on `main`. |

### 11. Inventory, spoils, economy
| Bucket | **THIN / PARTIAL** (loot gather notes) · Economy **BUILT, NOT PRESENTED** (platform ledger) |
|---|---|
| Evidence | QuestLog.NoteGather; RoadWorld.DropSpoils (presentation fragile). SYSTEM_AUDIT: no prices/wages/inventory UI. `content/items.json` ~11. Concord economy LIVE elsewhere. |

### 12. Presentation / look (prefab density, Hub city, atlas)
| Bucket | **THIN / PARTIAL** → trending toward **BUILT + PRESENTED** for Hub plaza materials |
|---|---|
| Evidence | HubLook / FreePacks / Poly Haven kit on box; PASS_LOG cinematic grade; SYSTEM_AUDIT magenta/T-pose historically; Sep-21 lore inventory: CX prefabs referenced, Mac disk counts UNVERIFIED; SoldierLocomotion.controller **is** in Resources on `main`. Atlas PDF on box. Density still far below open-world content bar. |

### 13. Creature/NPC content vs worlds
| Bucket | Data **BUILT** (~300 NPCs, ~76 creature records) · Meshes **THIN** (Kenney/CreatureCompiler stand-ins) |
|---|---|
| Evidence | PASS_LOG / lore inventory: almost no native creature GLBs; Tunya bestiary 33 is data-rich vs mesh-poor. |

### 14. Concord cognitive APIs Unity does not call yet (high-signal)
| API / module | Status vs Unity |
|---|---|
| `/unity-ws` + `ConcordClient` combat:attack | **WIRED-BUT-UNUSED** when socket down (SYSTEM_AUDIT) |
| `server/emergent/quest-engine.js` + lattice quests | Not driving QuestLog completion |
| `lib/combat/*` boss-phases / world boss lockouts | Not presented |
| `lib/npc-routines.js` / faction-strategy | Not driving NpcLife |
| `domains/mounts.js` | No client |
| Party LFG / raid | No client |
| Gossip / consequence-cascade | Not bound to Unity feed |
| Oracle / quest-dialogue-composer | 2B path only if gateway up |
| Browser `combat.ts` kinematics | Not ported; Unity hitscan local |

---

## Cross-check vs prior honesty docs

| Doc | Verdict vs this pass |
|---|---|
| `CONCORDIA_SYSTEM_AUDIT.md` (2026-09-01) | Still the best **Play** ground truth for authority violations (Unity owns HP/travel/save). Travel/look improved since; quests/bosses/gossip **not** promoted to PRESENTED. |
| `STACK_REALITY.md` (2026-09-05) | Still right: Concordia server-authority = TARGET; many PARTIAL organs. |
| `PASS_LOG.md` (2026-08-28) | Still right: boards = text; creature meshes = stand-ins. |
| `PLAYER_LIFE.md` (box) | SoftEnter/Present receive = LIVE; rivalry/gossip = gap — agrees. |
| Sep-21 box systems audit | Cascade kill→spoils→gossip breakage still the honesty bar until Mac Play re-proof. |
| Mac `FULL_SCALE_RPG_*` | Unread here; do not treat as verified LIFE_PROOF. |

---

## Top 10 highest-leverage “bring to life” (presentation / binding)

1. **Hub onboarding quest end-to-end** — use Canon `onboarding.json` / first-day-arc already in Resources; QuestLog accept → objective ticks → turn-in UI.  
2. **Concord socket or honest `no_gateway`** — stop silent local authority; surface connection; route combat ack when up.  
3. **Kill → spoils lootable + GossipEar + feed line** — systems exist; cascade bugs block feeling.  
4. **NpcLife hour schedule** — bind one world’s `schedules.json` / Concord routines to Stall/Sweep/Sleep poses.  
5. **Faction standing HUD + sash** — data + sash mesh path exist; show delta after crime/help.  
6. **WorldBoss named encounter at one gate** — `WorldBoss.Present` + Hostile already; author 1 named fight with phases toast.  
7. **SkillLattice VFX bind** — slots already selectable; fire one GabrielAguiar (or FreePack) path on strike.  
8. **Traveler receive presentation** — ContinentStream.ReceiveTraveler → visible GuestNpc on SoftEnter.  
9. **Quest giver pins** — `giver_npc_id` → spawn/highlight GuestNpc on board accept.  
10. **Appearance + vitals persistence slice** — beyond outfit: hour, last world, active quest ids.

---

## True content gaps (invent / author more — not just bind)

1. **Quest density** — ~41 chain files across 10 worlds is alpha-thin vs open-world bar; need many more per Present (especially Hub + Sundering/Fantasy).  
2. **Named boss raids** — server lockouts/phases exist; missing roster of world bosses + schedules + loot tables players can name.  
3. **Native creature / mount meshes** — bestiary counts without GLBs; mounts domain without rideable prefabs.  
4. **Companion cast** — no party members with kits/AI/banter content in Unity.  
5. **Economy items / vendors** — ~11 items; need vendor inventories, wages, craft outputs per biome.  
6. **Unique world verbs** — AAA gap: nine worlds still mostly palettes (need Ruins climb, Cyber parkour, etc.).  
7. **Audio beds / combat VFX libraries** — referenced packs often unwired or absent.  
8. **Prefab city density** — Hub improving; other Presents still sparse vs content bar.

---

## Bottom line for Ramaj’s claim

| Claim | Honest score |
|---|---|
| “Most full-RPG systems already exist in Concord” | **Mostly true** — novelty inventory + content/world + quest files + combat/NPC/faction/mount/raid modules. |
| “They just need to be brought to life in Unity” | **True for the next milestone** — binding/presentation is the highest EV. |
| “Also need more quests / density / boss raids” | **True in parallel** — authored quest/boss/mesh counts are still **alpha-thin**; binding empty shelves won’t feel like a full RPG. |

**Priority order:** bring-to-life **1–5** first (quest loop, socket honesty, kill cascade, NPC hour, faction HUD), **then** content waves (quests/bosses/creatures), without reinventing Concord modules that already exist.

---

## Paths

| Artifact | Location |
|---|---|
| This audit (box) | `/home/box/.zuko/BUILT_VS_PRESENTED_AUDIT.md` |
| TLDR (box) | `/home/box/.zuko/BUILT_VS_PRESENTED_TLDR.md` |
| Workspace copies | `/workspace/audit/BUILT_VS_PRESENTED_*.md` |
| Count JSON | `/workspace/audit/live-gh/counts/world_npc_faction_creature.json` |
| Mac targets (not written) | `/Users/dutch/.zuko/BUILT_VS_PRESENTED_*.md` · Unity `Assets/Concordia/Generated/` |
