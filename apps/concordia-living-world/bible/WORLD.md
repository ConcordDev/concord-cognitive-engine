# WORLD

**Status:** LIVE (ids, refusals, travel) · PARTIAL (holds)  
**Authority:** Concord (state) / Unity (mesh)  
**Source:** `Canon.cs`, `WorldBuilder.cs`, `WorldKit.cs`, `src/game/worlds.ts`

## LIVE

Ten `WorldId`: Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, Sere (Court waystone — not a ninth Refusal gate).

Hub = Unburned Court. Eight gates with refusal + theNo + color + angle.

`SteelLive`: Hub false except arena; other worlds true.

Travel: `ConcordiaGame.Travel` rebuilds `World`. Must `DestroyImmediate` previous root.

Cities: `CityAtlas` + `CityTown` + `CityGate`. Each town now has a PBR plaza pad (brick/asphalt/moss/earth — Court stays unpaved), a street cross, ten Kenney slots, edge flora, and outskirts hostiles from authored fauna. Interiors open on the first four buildings of the first six cities only (Tunya hitch). Steel worlds still get one Kenney hold (`DungeonGate`). HUD: circular minimap + vitals rings (SR2 camera language). Kenney GLBs are still Kenney — the plaza pad is the readable ground.

## TARGET

Each world is a civilization with WorldLaw (statement + sim/game/visual/audio/npc/econ/quest effects). World continues when the player is absent.

## Gap

No Concord world slice. Visual magenta. Hub is not yet the social membrane (no schemes, no hour).
