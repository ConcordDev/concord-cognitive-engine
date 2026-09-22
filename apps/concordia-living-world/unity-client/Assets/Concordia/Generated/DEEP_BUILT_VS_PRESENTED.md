# Deep Built vs Presented — Concordia / Concord
**Date:** 2026-09-22 00:53   
**Evidence:** Mac live inventory `DEEP_BUILT_INVENTORY.md` (144 Unity Scripts, 440 server domains), Canon Resources, `NOVELTY_INVENTORY` §AD, prior `BUILT_VS_PRESENTED_*`, `FULL_SCALE_RPG_*`, `AURA_LIFE_PROOF` PASS A–F.

## Thesis (refined)
You are correct: Concordia/Concord already contain **far more than five surfaces**. The gap is not “missing RPG invention.” The gap is **presentation binding** — systems and content exist as code, JSON, domains, and GameplayCore modules, but a cold Hub player only feels a thin living slice (walk, guests, talk lines, hitscan, SoftEnter travel, skill slots, quest *text*).

## Scale of what exists (Mac live)
| Layer | Count / signal |
|---|---|
| Unity `Assets/Concordia/Scripts/*.cs` | **144** |
| GameplayCore C# | fabrication, gunsmithing, spellcrafting, vehicles, containers, locomotion, persistence, presentation directors, GoldenSlice, Combat contracts |
| ConKay bridge | ConKayContracts / Runtime / GameplayCoreAdapter / DiagnosticWorkbench |
| Animation verb stack | Verb catalog humanoid+creatures, live bindings, coverage, playback, validator |
| Canon quest JSON in Resources | **33** (Hub **8** incl. onboarding) |
| Engine `content/quests` JSON | **36** tracked path (+ sub-worlds; earlier pass ~108 with broader find) |
| Engine `content/world` JSON | **118** |
| Server `domains/` | **440** domain modules |
| Novelty inventory | Sections A–AH including full game-system engines (§AD: combat suite, skill mastery, detective, roguelite, extraction, factory, mounts-adjacent, …) |
| Browser living-world `src/game` | combat, npc-life, quests, persist, politics, life, creatures, realms, … |

## Classification matrix (deeper than top-5)

Legend: **P** = felt in Play today · **BNP** = built, not presented · **T** = thin/partial · **M** = missing / no client

### A. Already somewhat presented (keep; deepen)
| Surface | Bucket | Mac anchors |
|---|---|---|
| Hub walk / Court / guests / CX dress | **P** (LIFE_PROOF A–B) | HubLook, CxDress, NpcLife, ModularPerson |
| SoftEnter / ContinentStream / gates | **P** (caveats) | ContinentStream, WorldGate, MegaworldMap, SoftEnter refs |
| Hitscan combat vs dummy/hostile | **T→P** | Hostile, TrainingDummy, CombatFeel, HitResolver, ActionRunner |
| SkillLattice slots 1–3 | **T** | HubObjectives |
| Authored NPC talk lines | **T** | ConcordiaDialogueService, LoreNpcBinder |
| Quest boards / offer text | **T** | WorldBook Quests, ConcordiaGame QuestLog hooks |
| Appearance persist | **T** | AppearanceStore |

### B. Built in Unity client — not felt (bind these)
| Surface | Bucket | Anchors (cs_files hits) |
|---|---|---|
| Unified persistence envelope | **BNP** | ConcordiaPersistenceService, Persist~24 |
| WorldEventLog + typed events | **BNP** | WorldEventLog, WorldEvent~11 |
| FactionStandingBook + integration | **BNP** | FactionStanding* ~10 |
| NpcLife jobs beyond wander | **BNP/T** | NpcLife~22; schedules thin |
| RoadWorld spoils / delve / WorldBoss hooks | **BNP/T** | RoadWorld, Spoils~2, Delve~3, WorldBoss~4, Boss~6 |
| Vehicles ground movement | **BNP** | Vehicle* ~18 |
| Gunsmithing / Fabrication / Spellcrafting composers | **BNP** | Gunsmith~8, Fabrication~11, Spellcraft~7 |
| Presentation directors (ecology, human activity, surface fidelity) | **BNP** | GameplayCore/Presentation/* |
| GoldenSlice runtime | **BNP** | GoldenSliceRuntime |
| ConKay / ConcordLink runtime | **BNP** | ConKay/* |
| Animation verb coverage → Play binding | **T/BNP** | Animation/* (UAL1 extracted; full sequence unverified while bridge blocked) |
| ConcordClient `/unity-ws` | **BNP** (wired-when-up) | ConcordClient~10 |
| Mount string refs in client | **BNP/T** | Mount~10 (no proven ride loop) |
| Companion refs | **BNP/M** | Companion~2 |
| Economy string refs | **BNP** | Economy~13; Vendor~1 |
| Gossip | **BNP** | Gossip~3 (GossipEar may be named differently / thin) |
| BuildingInterior / StoreDress | **T** | interiors + shop dressing |
| EvoCatalog / EvoSpawner / CreatureCompiler | **T** | creature stand-ins not native cast |
| AgentAvatar / AgentMotor | **BNP** | agent embodiment hooks |

### C. Built in Concord server / novelty — Unity does not present
| Surface | Bucket | Evidence |
|---|---|---|
| Quest engine + lattice/drift/citation quests | **BNP** | emergent quest-engine; Unity QuestLog local |
| NPC routines / daily-life / schemes | **BNP** | lib + domains `daily-life`, `npc-*` |
| Consequence cascade / gossip feed | **BNP** | consequence-cascade.js |
| Faction strategy L11 / rep cache | **BNP** | faction domains |
| Combat suite (boss-phases, faction-war, telegraph, executions, flow-recorder) | **BNP** | lib/combat/* · novelty #267 |
| Skill mastery tiers | **BNP** | skill-mastery.js · #268 |
| Mounts domain | **BNP** | domains/mounts + novelty |
| Companion / party LFG / raid variants | **BNP** | domains companion, party migrations; Unity Raid cs_files=0 |
| Economy / auctions / black-market / craft-chains | **BNP** | many domains |
| Detective / hacking / mahjong / roguelite / extraction / factory / restaurant / brawl | **BNP** (engines exist) | novelty §AD #266–277 |
| Nemesis / bloodline / courtship / chronicle | **BNP** | domains; Unity Nemesis=0 |
| Concordia domain + conkay domain | **BNP** | server `concordia.js`, `conkay.js` |
| Cross-world schemes / effectiveness | **BNP** | cross-world-* domains |
| Politics / civic / council | **BNP** | browser politics.ts + domains |
| ~440 domains total | mostly **BNP** for Unity Play | inventory |

### D. Browser living-world kernel (parallel authority — not Unity Play)
combat.ts (momentum/parry/i-frame), npc-life.ts, quests.ts, persist.ts, politics.ts, life.ts, creatures.ts, realms.ts — **BUILT for web client**, **not** the Unity authority path today.

### E. True content / art gaps (after binding)
1. Quest **density** per world (33 Canon files ≠ living board density)  
2. Named **boss raid roster + schedules** (server suite ≠ authored encounters)  
3. Native **creature/mount meshes** (compiler stand-ins)  
4. **Companion cast** with roles  
5. Vendor/economy **item depth** (~11 items historically)  
6. Ten-world **city density** vs GTA×Palworld silhouette bar  
7. Animation coverage holes (magic/firearms/creatures/bosses/social) from prior audit  

## Bring-to-life waves (full stack — not only five)

### Wave L1 — Consequence theater (make the differentiator undeniable)
1. Hub onboarding quest accept→objective→turn-in (Canon `onboarding.json` + first-day-arc)  
2. Kill→lootable spoils→WorldEventLog→gossip line→Hub feed on return  
3. Faction standing delta visible (HUD + sash + one gate/price reaction)  
4. Witness heat on nearby NPCs  
5. Persistence round-trip of events/quests/standing (ConcordiaPersistenceService)

### Wave L2 — Civic life (Hub feels inhabited)
6. NpcLife hour schedules from authored routine JSON  
7. StoreDress + vendor buy/sell using items table  
8. BuildingInterior enter/exit with one functional interior  
9. Traveler Present receive + road gossip  
10. PresentationHumanActivity + ecology/weather directors on Hub  
11. Quest givers bound to Guest NPCs for all 8 Hub quests  

### Wave L3 — Power fantasy surfaces (wire inert GameplayCore)
12. Vehicle spawn + enter/exit + short drive (VehicleGroundMovement)  
13. One gunsmith bench → GunsmithingComposer → held weapon change  
14. One fabrication bench → crafted placeable  
15. One spellcraft glyph → SkillLattice slot  
16. GoldenSlice scripted beat using above  

### Wave L4 — Concord authority / depth
17. ConcordClient `/unity-ws` honest online **or** labeled offline  
18. Server quest-engine sync for one chain  
19. Boss-phases: one named WorldBoss delve with phases from lib/combat  
20. Mounts domain → rideable mount  
21. Companion follow + assist from companion domain  
22. Skill mastery tier VFX on one verb  

### Wave L5 — World density + raids (content after pipes)
23. Per-world quest density pass (use existing 33+ chains first, then author more)  
24. Named raid roster + schedules (sovereign raid / party LFG surfaces)  
25. Native creature/mount mesh pipeline from native-bible  
26. Detective/hacking/extraction as **optional** diegetic minigames (engines exist — only after L1–L4)

### Wave L6 — Long-tail novelty (do not start early)
Mahjong, theme-park, factory, restaurant, brawl profiles, etc. — real engines, wrong order for “Concordia feels alive.”

## Anti-priorities (research-aligned; refine after living-surface research completes)
- Do not invent parallel quest/faction systems  
- Do not ship more unread boards  
- Do not HUD-number faction without world reaction  
- Do not expand §AD minigames before L1–L3  
- Do not wipe Library or re-download deleted pines  

## Proof bar for “brought to life”
Cold-boot stranger: completes Hub onboarding, kills a named actor, sees spoils+gossip+standing, returns via SoftEnter to Hub memory that still knows, uses one bench or vehicle, and can point at a boss or mount without opening code. Report: `Generated/BRING_TO_LIFE_PROOF.txt`.

## Related files
- `~/.zuko/DEEP_BUILT_INVENTORY.md`  
- `~/.zuko/BUILT_VS_PRESENTED_AUDIT.md`  
- `~/.zuko/FULL_SCALE_RPG_RESEARCH_AND_CONCORD_AUDIT.md`  
- Pending: living-surface research + final synthesis master plan  
