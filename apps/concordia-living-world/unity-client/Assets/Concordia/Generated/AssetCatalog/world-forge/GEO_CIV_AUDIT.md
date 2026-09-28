# Concordia World Forge — Geo → Civ → Physical World
# Three-way audit (research + stack definition + Concord codebase). Canon for queue.

## Bottom line
Concord already has a large civilization/simulation substrate. The major missing layer is the **physicalizer** that turns that substrate into continental geography and then turns civilizations into physical settlements, roads, farms, buildings, infrastructure, and landscapes.

## References (what others generate/simulate)
- **Dwarf Fortress:** elevation → rainfall → temperature → drainage → biomes → erosion → rivers/lakes → geology → wildlife → civilizations → sites → history. Rivers from drainage; history before play.
- **RimWorld:** landmasses, mountains, rivers, biomes, climate, roads, faction settlements/density — then local physicalization. Macro map ≠ full 3D everywhere; Concord needs BOTH.
- **Bannerlord:** settlements as economic entities; world map is simulation (parties, production, factions); quests from world state.
- **CK3:** political entities over geographic hierarchy (county→duchy→kingdom→empire).

Concordia target: Geography creates conditions for civilization; civilization modifies geography; resulting state physically renders into the world the player walks.

## Avoid
WorldGenerator (pretty random) ⊕ CivilizationGenerator (random kingdoms) ⊕ CityGenerator (random cities). Every stage must consume the previous stage’s data.

## Nine layers
| Layer | Name | Status |
| --- | --- | --- |
| 0 | World Canon (bible, 10 worlds, factions, kits) | EXISTING — need machine-readable geographic constraint graph |
| 1 | Continental Geography (landforms, climate, geology fields) | NEW — world-terrain.js is Hub/Poughkeepsie heightmap, fixed seed |
| 2 | Hydrology (watershed→river→ocean) | LOCAL exists (terrain-water.js); WORLD-SCALE NEW |
| 3 | Biome/ecology field | Substrate/PARTIAL; world-scale physicalizer NEW |
| 4 | Transportation geography (passes, roads, ports, cost graph) | NEW MAJOR |
| 5 | Settlement suitability scoring | NEW |
| 6 | Civilization / territory | Simulation SUBSTANTIALLY EXISTING; geo link MISSING |
| 7 | Cities/settlements physical layout | procgen-settlements = small NPC populate, NOT city physicalizer |
| 8 | Physical civilization (Forge applied to world) | MISSING BRIDGE |

## Pipeline (ordered)
Elevation → Hydrology → Climate → Biome → Resources → Mobility → Settlement suitability → Civilization → Population → Economy → Settlement growth → Infrastructure → Physicalization → Unity streaming

Then living loop: simulation → pop/economy change → settlement grows → construction → roads → physical world changes.

## Build phases (Aura/Cursor — NOT pretty cities first)
- **G0** World Field — canonical geographic data model
- **G1** Continental generator (mountains, valleys, plains, coasts, islands)
- **G2** Hydrology (watersheds, rivers, lakes, deltas, wetlands)
- **G3** Biomes/resources
- **G4** Civilization geography (territory, capitals, roads, borders from Concord factions)
- **G5** Settlement physicalizer (spatial hierarchy)
- **G6** World Forge → procedural arch / Forge assets / veg / NPCs / fauna / streaming

## Architecture name
**World Forge** — consumes CONCORD CANON → WORLD SPECIFICATION → geology field ⊕ civilization → settlement solver → road graph → infrastructure → physicalization.

Full research prose lives with the authoring agent; this file is the locked target for Grok queue slices and Aura orders.
