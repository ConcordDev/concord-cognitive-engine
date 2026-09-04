# CREATURES

**Status:** PARTIAL  
**Authority:** Concord  
**Source:** `Canon.fauna`; `EvoSpawner.cs`; `Hostile.cs`; `DungeonHold`; `src/game/creatures.ts`, `evo.ts`

## LIVE

Per-world fauna lists (wraith, sealie, wolf, drone, griffin, basilisk, …). Unity spawns + `FaunaLife` + `Hostile` on steel worlds. Dummy in Hub arena. Each steel world also builds one Kenney **hold** (`DungeonHold`) as mouth → hall → vault with a gatherable chest and a pack per room. City outskirts spawn 1–2 more packs from `WorldBook.Critters` / `Canon.fauna` — no invented names. Geometry is dressing; the hold plaque does not invent an authored dungeon name.

## TARGET

Persistent populations, patrols, flying vs ground, evolution under selection. Authored dungeon names when the canon has them.

## Gap

Deaths persist as ids, not a full wild.ts graph. Hostile now perceives and strafes; it is still not a humanoid clip graph.
