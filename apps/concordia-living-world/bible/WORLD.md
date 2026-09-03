# WORLD

**Status:** LIVE (ids, refusals, travel, kingdom identity) · PARTIAL (cross-world)  
**Authority:** Concord (state) / Unity (mesh)  
**Source:** `Canon.cs`, `WorldBuilder.cs`, `WorldKit.cs`, `src/game/worlds.ts`

## LIVE

Ten `WorldId`: Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, Sere (Court waystone — not a ninth Refusal gate).

Hub = Unburned Court. Eight gates with refusal + theNo + color + angle.

`SteelLive`: Hub false except arena; other worlds true.

Travel: `ConcordiaGame.Travel` rebuilds `World`. Must `DestroyImmediate` previous root.

Cities: `CityAtlas` + `CityTown` + `CityGate`. Each town now has a PBR plaza pad (brick/asphalt/moss/earth — Court stays unpaved), a street cross, ten Kenney slots, edge flora, and outskirts hostiles from authored fauna. Interiors open on the first four buildings of the first six cities only (Tunya hitch). Steel worlds get a Kenney hold with mouth / hall / vault rooms (`DungeonGate`). HUD: circular minimap + vitals rings (SR2 camera language) plus a world-life clock. Kenney GLBs are still Kenney — the plaza pad is the readable ground.

`WorldClock` / `WorldMemory` port `kernel.ts` + `persist.ts`: hour, day, weather, ecology, prices. Leaving a world writes a slice; returning advances the away hours so the kingdom did not freeze. LOD is REAL / BULK / VIRTUAL. `TickEvents` ports `events.ts` (authored title / refusal / fauna / city / lore beat only). City plazas now have sidewalk slabs. Ecology below 0.28 skips outskirts packs; below 0.4 halves them.

`KingdomBook` treats each `WorldId` as a kingdom: staple from the refusal, settlements from `CityAtlas`, factions/people/lore from `WorldBook`. Hub: the Court is the city. Sere: Court waystone, not a ninth Refusal gate. Audit dump: `/tmp/concordia-kingdom.txt` (WORLD → KINGDOM → REGION → SETTLEMENT → ACTIVITY → ACTOR).

`CrossRing` ports `cross.ts`: walking a gate moves staple stock, stamps an import, advances an authored CROSS_PLOT, and nudges a tagged traveler. Away hours keep producing and can ship to the Ring. A carried kit is noticed in the destination (heat + rumor). This is not a caravan mesh and not a weaponsmith tech tree.

## TARGET

Each world is a civilization with WorldLaw (statement + sim/game/visual/audio/npc/econ/quest effects). Visible caravans / gate guards / tariffs still need presentation.

## Gap

Kernel still `{ok:false, reason:'no gateway'}`. Cross-world economy is stock/need/import on the slice plus Ring shipments — not rendered caravans or faction-owned gates.
