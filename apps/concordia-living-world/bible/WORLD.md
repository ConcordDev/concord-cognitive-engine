# WORLD

**Status:** LIVE (ids, refusals, travel) · PARTIAL (holds)  
**Authority:** Concord (state) / Unity (mesh)  
**Source:** `Canon.cs`, `WorldBuilder.cs`, `WorldKit.cs`, `src/game/worlds.ts`

## LIVE

Ten `WorldId`: Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, Sere (Court waystone — not a ninth Refusal gate).

Hub = Unburned Court. Eight gates with refusal + theNo + color + angle.

`SteelLive`: Hub false except arena; other worlds true.

Travel: `ConcordiaGame.Travel` rebuilds `World`. Must `DestroyImmediate` previous root.

Cities: `CityAtlas` + `CityTown` + `CityGate`. Each town now has a PBR plaza pad (brick/asphalt/moss/earth — Court stays unpaved), a street cross, ten Kenney slots, edge flora, and outskirts hostiles from authored fauna. Interiors open on the first four buildings of the first six cities only (Tunya hitch). Steel worlds get a Kenney hold with mouth / hall / vault rooms (`DungeonGate`). HUD: circular minimap + vitals rings (SR2 camera language) plus a world-life clock. Kenney GLBs are still Kenney — the plaza pad is the readable ground.

`WorldClock` / `WorldMemory` port `kernel.ts` + `persist.ts`: hour, day, weather, ecology, prices. Leaving a world writes a slice; returning advances the away hours so the kingdom did not freeze. LOD is REAL / BULK / VIRTUAL. `TickEvents` ports `events.ts` (authored title / refusal / fauna / city / lore beat only). City plazas now have sidewalk slabs. Ecology below 0.28 skips outskirts packs; below 0.4 halves them.

## TARGET

Each world is a civilization with WorldLaw (statement + sim/game/visual/audio/npc/econ/quest effects). Cross-world trade/migration still needs the kernel gateway.

## Gap

Kernel still `{ok:false, reason:'no gateway'}`. Cross-world economy is a persisted hour/ecology slice, not caravans through the gate.
