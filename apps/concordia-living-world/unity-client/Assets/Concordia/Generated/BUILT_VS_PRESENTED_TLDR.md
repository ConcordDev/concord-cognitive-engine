# Built vs Presented — TLDR (2026-09-22 EDT)

**Mac live disk was unreachable** from this subagent (`machineId` Shell/Read does not route; same blocker as prior QA). Evidence = GitHub `main` + in-repo Play audit (2026-09-01) + STACK_REALITY + box Unity mirror/PLAYER_LIFE. Mac `FULL_SCALE_RPG_*` not re-read.

## Thesis
Concord already has most RPG **systems** (quests, factions, NPC routines, combat suite, mounts, raids, gossip, persistence tables). Unity Hub Play shows a **real but thin slice** (walk Court, talk lines, gates/SoftEnter travel, hitscan combat, skill slots, quest *text*). Cold players do **not** yet feel quest completion, faction standing, gossip heat, boss raids, mounts, companions, or economy.

## Counts (GitHub main)
- ~**300** authored NPCs · ~**86** factions · ~**76** creatures/bestiary across 10 worlds  
- ~**41** quest chain files (~60+ step ids in top-level `content/quests` alone); Canon hub packages **8** quest JSON files into Unity Resources  
- Unity Concordia Scripts on main ~**40** C# files; Mac worktree likely ahead (RoadWorld/GossipEar/HubLook…)

## Buckets (short)
| Surface | Bucket |
|---|---|
| Travel Hub↔worlds / SoftEnter | BUILT + PRESENTED (caveats) |
| Creator / authored NPC lines / dummy+hostile combat | THIN / PARTIAL presented |
| Quest boards + QuestLog hooks | THIN presented · most chains BUILT NOT PRESENTED |
| Factions / gossip / witness / world memory | BUILT NOT PRESENTED |
| SkillLattice slots | THIN presented |
| Boss raids / mounts / companions / economy UI | BUILT in Concord (or MISSING in Unity) — not felt |
| Persistence | Appearance only in Unity = THIN |
| Creature meshes / city density | Data rich, art THIN |

## Top 5 bring-to-life
1. Hub onboarding quest accept→complete using Canon JSON  
2. Concord `/unity-ws` or honest no_gateway + combat ack  
3. Kill→lootable spoils→gossip/feed  
4. NpcLife hour schedule from existing JSON/routines  
5. Faction standing HUD + sash  

## Top 5 true content gaps
1. More quests per world (density)  
2. Named boss raid roster + schedules  
3. Native creature/mount meshes  
4. Companion cast  
5. Vendor/economy item depth  

Full audit: `/home/box/.zuko/BUILT_VS_PRESENTED_AUDIT.md` (Mac copy pending local-exec).

## Mac live spot-check (2026-09-22 ~00:47 EDT, parent)
- Unity Canon quest JSONs packaged: **33** (Hub **8**, including `onboarding.json`) — ahead of GitHub “8 hub only” note.
- Engine `content/quests` JSON files: **108**.
- World NPC packs in Resources: **10** `npcs.json`.
- Present on Mac client: `WorldEventLog.cs`, `FactionStandingBook.cs`, `ConcordiaPersistenceService.cs`, `NpcLife.cs`, vehicles/GameplayCore suite.
- `AURA_LIFE_PROOF.txt`: **PASS A–F** (Hub walk, guests, etc.) — presented slice is real, still thin vs Concord systems.
- Prior Mac `FULL_SCALE_RPG_TLDR.md` agrees: GameplayCore crafting/vehicles ~built but inert; kill→gossip differentiator real but narrow.
