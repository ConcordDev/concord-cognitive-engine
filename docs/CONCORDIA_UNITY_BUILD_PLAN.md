# Concordia — AAA Living-World north star + build plan

**Status:** living. Read before any Concordia / Unity work.
**Date:** 2026-08-25
**Durable copy:** `docs/CONCORDIA_UNITY_BUILD_PLAN.md` (sync this file there on execute)

**Unity client lives in this repo:** `apps/concordia-living-world/unity-client/`. Open `concord.code-workspace` so Unity Concordia sits next to Godot, frontend, server, and mobile. Do not copy the project out of the tree. `Library/` is gitignored and regenerates in Unity Hub.

Owner spec (this session): Concordia is **not a bigger Skyrim**. It is a **systemic civilization** that keeps living when the player looks away. Unity is the **full standalone AAA client**. Asset Store is authorized as the evo/procedural corpus. Server sim + DTUs stay the moat.

---

## 0. Core principle

Concordia is not a game world that waits for the player.

It continues to exist, remember, adapt, grow, fight, trade, love, build, destroy, migrate and evolve whether anyone is watching.

The player is one causal force inside it.

**Golden rule — every major system answers A/B/C:**

| | Question | Fail |
|---|---|---|
| **A** | Does it exist independently? | NPCs freeze until you arrive |
| **B** | Can the player interfere? | Simulation is a screensaver |
| **C** | Does the world remember? | Faction leader respawns tomorrow |

Kill a faction leader → succession → rival takeover → allies react → trade routes change → schedules change → quests change → territory/prices/rumors/dialogue change.

That is the standard. Not a feature list.

**Differentiator (do not dilute):** DTU substrate. Anything created, discovered, crafted, learned, published, traded or transformed can become persistent world knowledge **and** an economic object (royalty lineage). No other reference game has this. Keep it load-bearing.

---

## 1. Product mix (philosophies, not clones)

| Source | What we take | What we reject |
|---|---|---|
| Skyrim | Exploration, factions, handcrafted places, env storytelling, freedom | Wade-and-click combat; empty wilderness |
| GTA / Saints Row | Living city, traffic, crime-with-witnesses, vehicles, persistent consequences, social sandbox | Instant wanted stars; combat-only multiplayer |
| Starfield | Scale, proc wilderness, backgrounds/skills, ships, settlements | Door-load every interior; planet as empty statistic |
| The Sims | Needs, personality, autonomous choice, careers/homes, emergent personal stories | Needs as UI meters only |
| AC Origins | Population LOD: virtual → bulk → real while **agendas persist** | Thousands of fully-simulated bodies |
| Red Dead | Immersion, env story, wildlife |
| Cyberpunk | Dense city identity, systemic reactions |
| No Man’s Sky | Proc discovery at universe scale |
| Ubisoft systemic | **Systems collide** (fire+weather+animals+goals+physics) unscripted |

**Handcrafted islands in a systemic ocean.** Major cities/characters/dungeons authored. Wilderness, minor NPCs, resources, side events, faction ops procedural.

---

## 2. Honest audit — the systems exist more than the AAA experience

The repo is further along than a greenfield AAA pitch. Do **not** rebuild.

### Already real (wire / surface / connect)

| Spec pillar | Where it already lives |
|---|---|
| Heartbeat scheduler | `registerHeartbeat` / `tickAllRegistered` (~168 unique; governor 15s). **This is the World Kernel clock.** |
| NPC schedules | `npc-routines.js`, `npc-routine-cycle`, `npc_schedules` / `npc_routine_state` |
| Faction strategy | `faction-strategy.js`, stance/moves, relations PK, cycle @200 |
| Schemes / CK3 hooks / secrets / inheritance | `hooks.js`, `secrets`, `npc_schemes`, `npc-legacy`, realms/decrees |
| Seasons / festivals | `seasons.js`, `festival-trigger-cycle` |
| Combat physics | `combat.ts` + `combat-impact.js` + `impact-feel.js` (momentum×poise, not dice). Godot `combat:attack` is server-validated |
| Pain / body regions | `pain_signals` head/torso/arms/legs/systemic |
| Ecology / env combat | embodied signals, elementalEnvBoost/Feedback, structural stress, fire/moisture propagation |
| Creatures / evo | fauna, `evo-asset/*`, living-world `evo.ts` |
| Economy / scarcity | `npc-economy`, regional scarcity, marketplace, royalty cascade |
| Crime | `world-crime`, lockpick, bounties — **not** yet witness→investigation→warrant |
| Quests | authored chains + lattice-born from drift; quest bible exists |
| Relationships (thin) | opinions, nemesis, courtship, spouse-reactivity, grudges/desires |
| Memory (thin) | dreams, forward-sim, NPC knowledge, kernel memories in living-world |
| Traversal | walk/sprint/jump/glide/swim/climb/dash/slide/flight (Three.js + server) |
| Vehicles / mounts | world vehicles, mount substrate |
| Housing / land / factory | player houses, land claims, factory belts |
| DTU craft / royalties | `craft-resolve`, citation cascade, evo provenance |
| Renderer | ConcordiaScene + Rapier; Godot client; Unity 6 URP kitchen |
| Online (thin) | parties, presence, mail, `/godot-ws`+`/unity-ws`, spatial voice path |
| World shards | `world-shard-protocol` — parent vs per-world writes |

### Gaps (experience, not missing folders)

| P0 experience | What’s missing |
|---|---|
| Combat **feel** | Mixamo mocap, upper-body mask, limb consequences visible, archetypes, env tools, weapon identity |
| World **density** | Interiors, landmarks every 30–90s, architecture/sky identity, props, wildlife on screen |
| NPC **depth** | Sims-grade needs; 12-axis relationships; first-class memory categories; LOD virtual/bulk/real; inspectable decisions |
| **Consequence graph** | No single event-sourced bus. Pieces write separately. Kill-leader cascade is not one pipeline |
| Online | Not GTA Online. Replication, proximity voice finished, shared persistent sessions |
| Quest density | Authored foundation + systemic generation from sim, not “kill 3 wolves” |
| Assets | Thousands of store/evo meshes; register into evo-asset |
| Audio | Reactive beds, not cosmetic weather |

**Diagnosis matches the owner audit:** marquee systems were sometimes dark; combat impact had to become real; world identities need architecture/assets; quests uneven; social thin.

---

## 3. The stack (do not invent a second one)

```
UNITY / GODOT / THREE.JS     presentation + input + animation
        │
GAMEPLAY LAYER               combat feel, quests, craft UI, traversal, vehicles
        │
WORLD SIMULATION KERNEL      heartbeats as scheduler
  NPC · Faction · Economy · Ecology · Weather · Crime · Politics
        │
CONSEQUENCE GRAPH            actor, action, target, evidence, witnesses, effects
        │
MEMORY / RELATIONSHIPS       first-class, decaying, inheritable
        │
DTUs + ROYALTY GRAPH         creation economy (the moat)
```

**LLM placement:** dialogue, rumor, quest interpretation, reflection — **never** footsteps, combat frames, traffic. Pipeline: rules → utility → BT/state → sim → memory → LLM.

**NPC decision pipeline (universal):**
perception → world state → needs → goals → memory → relationships → risk → actions → utility → action → world mutation → memory.

**Simulation LOD (AC Origins):**

| LOD | Where | Rate | What |
|---|---|---|---|
| L0 Full | Player vicinity | every frame | bodies, combat, dialogue |
| L1 Active | nearby region | 1–5 Hz | schedules, traffic, shops |
| L2 Background | far | 5–30 s | faction moves, economy ticks |
| L3 Abstract | rest of world | statistical | “2830 farmers, food 71%” materializes on approach |

Agendas persist across LOD. A bulk merchant still has a destination and a debt.

---

## 4. NPC — “everyone has a life” (single most important upgrade)

**Tiers**

| Tier | Count | Sim |
|---|---|---|
| 0 Background | thousands | dest, occupation, faction, activity, basic needs/reactions |
| 1 Persistent | hundreds | schedules, inventory, memories, economic acts, goals |
| 2 Important | dozens–hundreds | personality, secrets, schemes, family, property, quests |
| 3 Hero | authored majors | betray/marry/inherit/rule/die/remember player/initiate events |

**Needs (Sims, weighted by personality):** hunger thirst sleep safety social wealth status belonging purpose comfort entertainment romance curiosity power freedom.

Schedules are **graphs**, not animation loops. War / spouse death / fire / festival / player raid **rewrites** the graph.

**Memory categories** (first-class, decay by importance; majors permanent; inheritable): PLAYER_ACTION, COMBAT, CRIME, KINDNESS, BETRAYAL, PROMISE, GIFT, INSULT, ROMANCE, LOSS, DISCOVERY, RUMOR, POLITICAL/FACTION/WORLD_EVENT, NPC_INTERACTION.

**Relationships are 12-axis**, not one affinity: trust respect fear love hatred gratitude jealousy loyalty attraction debt dependency ideological_alignment.

Map onto existing: `npc-routines`, `npc-asymmetry` (grudge/desire/preoccupation), `hooks`, `secrets`, `character_opinions`, `player_marriages`, `npc_legacy`. **Extend, don’t replace.**

---

## 5. Combat — elevate what exists

Keep momentum×poise. Expand to:

- Attack record: startup/active/recovery, arc, mass, penetration, element, stamina
- `impact_force = mass × weapon_mass × velocity × strike_quality × angle` → damage, stagger, knockback, limb, bleed, weapon wear, env reaction. **No “18% stagger.”**
- Limb states already hinted by pain regions — make them **change verbs** (broken arm = slower swings; broken leg = no dodge)
- Data-driven weapons (we have GLBs: longsword, firearms, bow…). Guns: projectile, material, recoil — crime/cyber worlds
- Status + env collision (rain×elec, oil×fire) using embodied signals already there
- Archetypes + morale (fight/flee/surrender/call) — not one AI
- Environmental tools: doors, vehicles, fire, crowds

Unity/Mixamo presents. Server remains authority.

---

## 6. Worlds — gameplay ecosystems, not palettes

| World | Gameplay identity |
|---|---|
| Hub | social, politics, creator economy, flower-law, cross-world doors |
| Fantasy | melee/magic/guilds (Concordia’s vacation world — life-magic) |
| Crime | firearms, vehicles, police, gangs, businesses |
| Cyber | hacking, surveillance, corps, parkour |
| Superhero | vertical, powers, civilian density, refuse-the-win |
| Frontier | exploration, survival, road-as-door, vehicles |
| Tunya | agriculture, ecology, civilization, harvest-refusal |
| Sovereign Ruins | archaeology, unburial, climb, danger |
| Lattice Crucible | simulation, drift, experimentation, refuse-completion |

**Landmark density:** something interesting every 30–90s of travel. Not all of it a quest. “That was cool” counts.

**Cross-world:** Link is a door, not a load. Tech/DTU/asset/faction effects hop worlds. That is unusual; keep it.

---

## 7. Unity standalone (unchanged from prior lock, strengthened)

- Full Mac/Win/Linux player. Asset Store **go crazy** — register every pack into evo-asset.
- URP 17, Addressables streaming, additive scenes. Saints Row interiors (no Starfield door-load).
- Presentation of the kernel, not a second sim.
- Current kitchen: Unity 6.5.9 on this Mac; GLBs already copied to `Assets/Concordia/Models/`.

---

## 8. Tests the build must pass (not optional)

**Alive test:** spawn, do nothing 24 sim hours. Economy, NPC motion, faction decisions, weather, wildlife, rumors, quests, deaths/births happen. Player then enters a **changed** world.

**Chaos test:** 100 NPCs, 3 factions, 20 animals, 10 vehicles, weather, shortage, one crime, one player — believable outcomes, not a script.

**Player story test:** merchant ambush → tavern → daughter → overheard war → ambush → starving camp → food shipment instead of slaughter — and the debugger can say **why**.

**Inspectability:** “Why did Rael attack me?” → goal, fear, reputation, perceived facts, decision, confidence. Ship a sim dashboard; later the in-game Atlas.

---

## 9. Development order (do not do everything at once)

Owner phases A–G **with repo binding**. Each step: find existing module → close A/B/C → surface in Unity.

### Phase A — Living World (kernel unification) — FIRST SYSTEMS WORK

1. NPC needs (extend asymmetry + routines; don’t new table if a JSON column on `npc_routine_state` / personality profile works)
2. NPC memory (first-class table or DTU-backed; categories + decay + inheritance)
3. 12-axis relationships (widen opinions/nemesis; don’t throw CK3 hooks away)
4. Schedule **graphs** that rewrite on events
5. Faction strategy **already ticks** — wire succession + economy + rumors into it
6. Settlement supply/demand cascade (npc-economy + scarcity exist)
7. World events bus (EmergentEventFeed is UI; need **consequence graph** writer)
8. **World Consequence Graph** — the missing unifier. Event sourcing: actor/action/target/location/time/evidence/witnesses/immediate/long-term → reducers

**Alive test is the Phase A exit.**

### Phase B — AAA gameplay (Unity + server feel)

Melee/ranged/weapons/archetypes/bosses/traversal/vehicles/env combat. Port `combat.ts` feel; Mixamo mocap; limb verbs.

### Phase C — World presentation

Architecture, interiors, landmarks, wildlife on screen, weather that **changes sim**, seasons, audio, env storytelling. Asset Store + evo.

### Phase D — Quests

Authored stay. Add systemic/personal/faction/economic/emergency/discovery/**consequence** quests. Failure is real (world moves on). Dialogue eats memory+relationship+asymmetry.

### Phase E — Creation

Asset Studio, editors, marketplace, remix graph — already partly shipped; deepen quality gate + evo.

### Phase F — Online

Replication, parties, co-op, proximity voice (finish WebRTC), trade, persistent sessions, events, moderation.

### Phase G — Scale

LOD L0–L3, streaming, shards (protocol exists), proc expansion, background sim, massive pop.

### Unity slices (parallel to A–C, not instead)

| Slice | Exit |
|---|---|
| P0 | Hub playable: real GLBs, Mixamo, flower-law, gates, guests |
| P1 | `/unity-ws` = Godot combat/scene |
| P2 | Ruins unique verb (climb+unburial) |
| P3 | Evo resolver + register store packs |
| P4–P6 | Crime city, vehicles/Frontier, remaining unique verbs |
| P7 | Standalone `/download` |
| P8 | WebGL later |

**Now:** finish P0 presentation **and** start Phase A item 8 (consequence graph) + NPC LOD design so Unity has something true to show.

---

## 10. Design law

Every major system connects to **≥3 others**. Fire → combat, weather, NPC, buildings, economy, quests, wildlife, law. Death → family, faction, inheritance, quests, reputation, economy, memory, politics. A sword → combat, craft, economy, ownership, durability, history, DTU. A player building → geometry, economy, social, ownership, creator economy, DTU graph.

Quality bar: Functional · Systemic · Persistent · Legible · Emergent · Performant · Content-rich · **Honest** (implementation matches the claim).

---

## 11. Anti-patterns

- Greenfield “NPC AI rewrite” while `npc-routines` + faction-strategy sit idle
- LLM on every NPC tick
- One affinity number
- Instant wanted stars
- Quest designer “kill 3 wolves”
- Quest-failed-reload as the only failure
- Palette worlds
- Starfield door-loads
- Cloning Mixamo × N
- Second combat math in C#
- Feature list instead of A/B/C
- Building everything in Phase A–G in parallel

---

## 12. How to use this file

1. Golden rule A/B/C.
2. Lowest unfinished **Phase A** item **or** Unity **P0** if the Editor is empty.
3. Grep existing module before creating a table.
4. If it doesn’t collide with 3 other systems, it isn’t done.
5. Alive test before claiming “living world.”

---

## Key decisions

1. Spec is **systemic civilization**, not bigger Skyrim.
2. **Unify** existing heartbeats into a named World Kernel + Consequence Graph — don’t replace them.
3. NPC LOD virtual/bulk/real; Sims needs; 12-axis relationships.
4. Combat: keep momentum×poise; add limbs, weapons-as-data, archetypes, env.
5. Unity = full standalone + Asset Store corpus → evo-asset.
6. DTU/royalty remains the moat.
7. Phases A→G sequential; Unity P0–P7 in parallel for presentation.

## Open questions (do not block P0 / A8)

1. Consequence graph: new `world_consequences` event-source table, or wrap existing ledger + opinions + memories behind one API first?
2. NPC needs: new table vs JSON on routine/asymmetry rows?
3. Rename Unity project `~/Concordia` now or after P0 playable?

Recommend: (1) **one API now, table next**; (2) **JSON on existing rows until Alive test is red for scale**; (3) **rename after P0** so Hub stays watching the current Editor.
