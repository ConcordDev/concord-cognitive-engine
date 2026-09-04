# QUESTS

**Status:** PARTIAL (accept / track / complete for Unity-doable types)  
**Authority:** Concord  
**Source:** `WorldBook.Quests`; `QuestLog` in `HubObjectives.cs`; `RealmFill.Quests`; `src/game/quests.ts`; `content.ts` OBJECTIVES

## LIVE

JSON quests become `LoreStone` + `QuestBoard`. E on a board or a `giver_npc_id` NPC **accepts** (max 3). Progress stamps only when the walk happens:

| type | Unity completes when |
|---|---|
| `talk_to` / `interact` | E on a `GuestNpc` whose id or name matches `target` |
| `reach_location` | player stands in a `QuestBeacon` whose tokens match `target` (city, hold, hub glade/arena/east gate, giver plaza) |
| `defeat` | a `TrainingDummy` / hostile HP hits 0 |
| `gather` | E on a `Gatherable` (hold chest) |
| `deliver` | gathered **and** talked |

Types this client cannot run (`cook`, `consume`, `macro`, `tame`, `stealth_traverse`, events, minigames, …) stay **open** with an honest HUD reason. Never auto-complete. HUD appends `ecology thin` when `WorldClock.Ecology < 0.4` so a hunt/gather quest reads the living world.

Hub P0 checklist (`HubObjectives`) is separate: lamp / ring / arena / ruins / return.

## TARGET

Stateful consequence graphs. Generate situations from world state (merchant gone → kidnapped/defected/debt…), not fetch templates.

## Gap

No kernel provenance. Blocked objective types still need their surfaces. No reward mint.
