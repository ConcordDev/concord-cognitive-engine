# W02 — World Forge G1 continental generator

**Slice:** `W02_continental_spec`  
**Phase:** G1. Text and JSON only.  
**Machine file:** `SPEC.json` (`concordia-world-forge-continental/1.0`).  
**Consumes:** `concordia-world-forge-field/1.0` and, through it, `concordia-world-forge-canon-graph/1.0`.  
**Batch:** `WF1_continental`.

This stage writes elevation, the slope derived from it, and the geology that rides with the landform. It does not write drainage, water, climate, biome, soil, resources, or fertility. Those channels stay on the W01 exemplars or stay null.

Flower Law is a horizontal Hub disk of 42 m. It is not an elevation and not a crater. `world_id` Fantasy stays Fantasy. The display name is the Sundering. There is no second fantasy continent and no ninth Link.

## What this stage is

G0 named the discs, the affinities, and the channel contract. G1 is the generator that fills **elevation** on `continental_veil_datum` so later stages have land to drain, not a pretty map of its own.

The generator is feature-first. A listed chain, pass, coast, march, or sector stamp sets the cell. Simplex noise does not raise a mountain, cut an island, or invent a kingdom. `hashSeed` may add micro-relief inside a cell’s band after the stamp. It cannot change the landform class.

The play patch in `server/lib/world-terrain.js` stays the ground the player walks. This slice does not retune it. Geographic questions stop treating that patch as the continent.

## Two readers, one walk mesh

| Reader | Question it answers | Seed | This slice |
| --- | --- | --- | --- |
| `terrainSpec` / `renderedElevationAt` / `sampleRenderedHeight` | Metres inside the 2000 m walk window, clamp [0, 80]. | Fixed `0xc0ffee` (`12648430`). Same grid for every `worldId`. | Unchanged. Authority label for a later binder: `play_patch_legacy`. |
| `continentalSpec` / `continentalElevationAt` (proposed; not shipped) | Metres on the veil datum, class, geology, derived slope, at a 2 km cell. | Macro shape from the features in `SPEC.json`. Micro-relief from `hashSeed(worldId:gx:gz)` only. | Design target. Does not call `generatePoughkeepsieHeightmap`. Does not return a megaworld `sampledGrid`. |

`continentalElevationAt` is the interface that replaces the Hub-only seed path **for geographic class**. `terrainSpec` remains the walk mesh until a physicalization slice says otherwise. Veil-datum metres are never added to `renderedElevationAt`.

The walk formula is a west-to-east river, a bluff, a central plateau near 40 m, eastern hills, and a Fall Kill depression. Those shapes are properties of `renderedElevationAt`. They are not Hub `terrain_affinity` tags, and they are not Masond’s cliffs. A binder that asks “what land is the Sundering” and reads `terrainSpec("Fantasy")` is still reading Poughkeepsie. That mismatch is why `continentalSpec` exists beside it. This slice does not “fix” the walk formula by rewriting it.

## Grid (design-intent, not materialized)

- Frame: `continental_veil_datum`. Horizontal: `megaworld_km`. Zero is the Inner Veil / Exodus water plane. Sea is elevation ≤ 0.
- Cell: 2 km, as W01 `frames.continental_veil_datum.later_cell_km`.
- Bbox, design-intent, covering disc radii plus Sere: x from −520 to 520 km, z from −580 to 520 km.
- Count if it were allocated: 520 × 550 = 286000 cells. **Do not write that raster** in this slice or in the catalog.
- Origin of cell `(0,0)` is the southwest corner (−520, −580). `gx = floor((x_km - min_x) / 2)`, same for z.

One continent: `concordia_megaworld`. Ten worlds are discs on that field. They are not ten heightmaps.

## Algorithm (elevation stage only)

Run in this order. Each step may only lower or raise a cell inside the band of a region it is allowed to touch.

1. **Sea mask.** Paint named sea gaps and the Exodus basin outside the Canon Ring on the southwest-to-south arc. Elevation in open water is below 0 (design-intent −20 to −1, not a bathymetry survey). Do not flood a `kind: road` or `kind: walker` march. Fantasy–Tunya keeps both a land march (`march_fantasy_tunya`, open 86.1 km) and a shoal (`sea_tunya_fantasy`). The shoal is the southwest coast. The Crown Road gap stays land.
2. **Sector stamp.** Inside a disc radius, a region with a W00 `placement` receives a wedge. Where W01 has an exemplar metre band, that band is the cell’s min and max. Where it does not, `ground_bands` in `SPEC.json` is the design-intent range, marked as such. Regions in `stamps_skipped` get no cells.
3. **Chains.** Stamp only `chains[]`. A ridge is a polyline with a width and a crest band. Profile across the width is a cosine from crest to the sector floor. A chain stops at the sector edge. It does not enter the Hub. It does not cross into Cyber as geology. The Crucible fault stops at the weak seam.
4. **Passes.** Carve only `passes[]`. A through-saddle drops the crest to the pass band along a centerline two cells wide (4 km), design-intent, and the centerline slope stays below `cliff` (rise/run 0.50). `kind: road_ends` carves nothing: the crest continues and the road dies. `kind: stair_not_saddle` keeps treads locally near level and the lip steep, and does not cut a highway through the shelf.
5. **Land marches.** On the open gap of a road or walker edge (86.1 km), interpolate the two rim elevations. Slope class on the corridor is `gentle` or calmer. No new chain in the gap. East of the Sundering the march toward Ruins stays low: moss against ash, not a range.
6. **Coasts.** A coast cell is land orthogonal to a sea cell. It must carry a `coast_id` from `coasts[]`, or `inner_veil_outline`, or `exodus_basin_outline`. A coast is a polyline for G2, not a harbor city.
7. **Islands.** Flood-fill land that touches neither a disc nor a land march. `islands` is empty. Any such component is clamped back to sea. A shoal is awash coast, not an island. Ark Exodus is lore, not a landmass.
8. **Slope.** For each land cell, rise/run is the maximum absolute neighbour difference divided by 2000 m. Class breaks are the W01 table: `near_level` < 0.04, `gentle` < 0.12, `moderate` < 0.25, `steep` < 0.50, `cliff` ≥ 0.50. Slope is never authored apart from elevation.
9. **Geology.** Look up the landform class. Rock rides with the stamp. This is not a new pipeline stage.
10. **Built relief.** `stack_vertical`, `skybridge`, `skyline`, `roof_pad`, `overpass_as_tall_ordinary`, and the Warden wall are buildings. Their height is not added to the ground. The wall’s ground stays `near_level`. A stack is not an orogeny.
11. **Affinity check.** The cell’s elevation class must be one of that region’s W00 `terrain_affinity` tags. A miss is an error, not a new tag.

Micro-relief, after the stamp: `hashSeed(worldId + ":" + gx + ":" + gz)` with amplitude `min(2 m, 0.02 × band width)`. The result is clamped to the band. FNV-1a is the function already exported as `hashSeed` in `world-terrain.js`. It still does not drive `renderedElevationAt`.

## Chains

| Id | Where | Crest (m, veil) | Rule |
| --- | --- | --- | --- |
| `chain_sunder_alpine` | Fantasy, north rim, region `sunder_alpine` | 700–1100 (W01) | One rim. Stops before the Ruins march. Titan pillar is a landmark with **no** metre height. |
| `chain_sunder_fold` | Fantasy, mid disc, `sunder_fold` | 300–520 (W01) | A lip, not a second range. House Voss is a stair fragment. |
| `chain_tunya_masond` | `tunya_masond` | 400–900 (W01) | Escarpment. Landings are locally near level. The face may be `cliff`. |
| `chain_tunya_aekon` | `tunya_aekon` | 900–1600 (W01) | Glacier over ark rib. No ice spell. |
| `chain_crucible_fault` | `crucible_lattice` | 200–700, **design-intent, not in W01** | Folded basalt. Ends at `seam_crucible_cyber`. Does not become a Grid stack. |
| `chain_sere_highland` | `sere_highland` | none | Role only. `anchor_km: null`. No cells. |

No chain on the Hub, the Frontier, the Grid, Permanent Dawn, Sovereign Ruins, or the Iron Coast. Frontier constraint `frontier_no_mesa_no_dome` still rejects a mesa and a dome. Hub constraint `no_hub_mountain` still rejects a metro mountain.

## Passes

| Id | Kind | Band | Rule |
| --- | --- | --- | --- |
| `pass_sunder_salt` | through-saddle on the south track, not on the alpine crest | 160–280 (W01 `sunder_salt_toll`) | Gentle. Not a high col. |
| `pass_sunder_fold_shelf` | `stair_not_saddle` | lip 300–520 | Treads near level. Do not grade a road through the shelf. |
| `pass_crucible_road_end` | `road_ends` | no saddle | Seam stays `weak`. Mobility later must not finish it. |
| `pass_frontier_drift` | `gap_cut` | local cut 8–15 m inside the flat band | Hand-built bridge site. Not an alpine pass. No mesa. |
| `pass_sere` | role | none | `sere_passes`. `anchor_km: null`. No cells. |
| `egress_hub_crown` | not a pass | approaches 15–40 | Eight Crown Roads leave on `road_and_verge`. Count is 8. They are not cols. |

## Coasts and the empty island list

Sea level is 0 m on the veil datum.

| Id | Sea | Gap | Rule |
| --- | --- | --- | --- |
| `coast_sunder_veil_shoal` | `inner_veil` | shares the Fantasy–Tunya pair with the land march | Shoal, near 0. `island: false`. |
| `coast_tunya_fluxom` | `inner_veil` | harbor band 0–15 (W01) | Lock into the Veil. Fluxom Gate (62, 18) m stays on the claim plane. |
| `coast_crime_exodus` | `exodus_ocean` | wharf 0–8, design-intent | Warehouse at the water. Not a new capital. |
| `coast_crime_sere_strait` | `exodus_ocean` | water gap **24.0** km (W00) | Open water. No bar, no island. |
| `coast_dawn_sere` | `exodus_ocean` | water gap **54.8** km | Coastal leg. The Dawn river lane is G2, not a G1 channel. |
| `coast_frontier_sere` | `exodus_ocean` | water gap **329.0** km | Long ocean. Islands forbidden along it. |
| `coast_sere_drowned` | `exodus_ocean` | no kilometres | South and west roles `low_drowned` and `polluted_shallows`. No cells. |
| `coast_cyber_wharf_march` | none as a surveyed port | — | Uncounted Wharf is a march toward the Grid, not a placed harbor. |

`islands` is an empty array. Accidental closed contours clamp to sea.

Ring land gaps stay **86.1** km of open ground on `march_cyber_ruins`, `march_ruins_fantasy`, `march_fantasy_tunya`, `walk_tunya_frontier`, `walk_frontier_crime`, `march_crime_superhero`, `march_superhero_crucible`, `march_crucible_cyber`. Sea edges that also quote 86.1 km (`sea_tunya_fantasy`, `sea_crime_superhero`) are the coastal alternative on that pair, not a second continent.

## What is not stamped

`tunya_unplaced` stays `channels: null`. `tunya_fallback` keeps a terrace class and `anchor_km: null` (no metre band). `frontier_last_dome_unplaced` stays unplaced; the “one mile past the gate” is not converted. `ruins_envoy_claim` is not lifted to kilometres. Every Sere region stays a role with `anchor_km: null`. G1 records the highland, the pass, and the drowned coast so a later slice can fill them only after kilometres exist. Inventing those kilometres here violates W00 `null_coords_stay_null`.

Hub court, doors, wall, and Pinewood stay on `hub_court_walk` (W01 bands 0–2 m of relief, Pinewood 1–4 m). Their continental cell class is the flat court or the salt verge. Absolute veil metres for the court **inherit the inner edge of the approaches band** (15–40 m). This slice does not pick a new surveyed offset, and it does not store 0 veil metres under the plaza (that would put the court in the sea).

## Concord integration

| Target | Today | Design target this spec names | Do not |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` | `terrainSpec(worldId)` ignores the id for the field. `generatePoughkeepsieHeightmap` and `renderedElevationAt` use seed `0xc0ffee`. `hashSeed` is FNV-1a and is not applied to that grid. `createSimplexNoise2D` / `octaveNoise2D` build the walk lumps. | Add `continentalSpec(worldId)` and `continentalElevationAt(xKm, zKm)` that read this feature set. Label `terrainSpec` `play_patch_legacy`. Geographic class comes from the new reader. | Do not replace the walk formula, do not feed veil metres into `renderedElevationAt`, do not switch the walk seed to `hashSeed(worldId)`, do not store Flower Law’s 42 as elevation. |
| `server/lib/terrain-deformation.js` `baseElevation`, `CELL_SIZE` 10 m | Digs follow the walk patch. | Digs stay there. | Do not store the 2 km continental grid in the deformation table. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow`, `waterDepthAt` | 4-neighbour flow on the 10 m play cell. | G2 may **read** the sea mask and coast ids. G1 does not call `setWater`. | Do not ship a second solver. Do not seed the Hub plaza. Do not seed a Sundering lake. A coast polyline is not a river. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs and a Living Society row. | A later suitability pass may choose an existing `region_id` using slope class. | Do not spawn a town from a crest cell or replace `spawnSettlementForRegion`. |
| `server/lib/embodied/faction-strategy.js` (domain `server/domains/faction-strategy.js`, cycle `server/emergent/faction-strategy-cycle.js`) | Stance and moves on authored factions. | A move may name a `chain_id`, `pass_id`, `coast_id`, or `region_id` from this spec. | Do not mint a kingdom from a ridge. Hub territories stay empty. The Crucible gains no ninth district. |
| Unity `WorldGeography` (`Assets/Concordia/Scripts/GeographyRuntime.cs`) | Routes and borders. Hub territories empty. | Binder agrees disc centers, the 86.1 km marches, and the sea gaps with the atlas. | Do not promote claim circles or the 0.55 m/km present scale into veil metres. |

Procedural buildings and TreeLayer wait for physicalization. They are not G1 consumers.

## Outputs for the next stage

G2 (hydrology) reads the elevation grid contract, derived slope, the sea mask (elevation ≤ 0), and `coasts[]`, plus W00 `water_dependency`. It places channels. It does not move a coast to make a river, does not turn the Sundering into a lake country, does not put a river through the Hub plaza, and does not treat a pass as a stream it must cut. Rainfall still does not exist at this stage; climate is G3’s predecessor and comes **after** hydrology in this pipeline.

Mobility (later) reads `passes[]` and must leave `pass_crucible_road_end` unfinished.

## What not to build yet

- No heightmap file, no 286000-cell JSON, no watershed raster, no biome raster.
- No edit to `world-terrain.js`, `terrain-water.js`, settlement spawn, or faction strategy.
- No city block-out, no procedural kingdom, no pretty capital on a coast.
- No retune of Flower Law, of seed `0xc0ffee`, of the 80 m clamp, or of batches B21–B31.
- No meshes, no images, no `PROMPTS_INDEX` rows.
- No cells for Sere, for `tunya_unplaced`, or for the Last Dome mile.

## Validation a later binder can run

1. `schema` is `concordia-world-forge-continental/1.0` and `consumes` names both the field schema and the canon graph.
2. Every `chains[]`, `passes[]`, and `coasts[]` region id exists on that `world_id` in the W00 graph.
3. No chain has `world_id` Hub. No feature id is a mesa or a dome.
4. `islands` is empty. Shoal and strait records set `island` false.
5. `chain_sere_highland`, `pass_sere`, and `coast_sere_drowned` have null anchors and `stamp_cells: false`. `tunya_unplaced` is in `stamps_skipped`.
6. Crest bands for Sundering and Tunya chains match the W01 exemplar metre ranges. The Crucible crest is marked `design_intent`.
7. Sea gaps are 24.0, 54.8, and 329.0 km. Land-march `open_km` is 86.1. Crown-road egress count is 8.
8. `play_patch.seed` is 12648430 and `max_elevation_m` is 80. Flower Law radius is 42 on a horizontal axis.
9. Written channels are only `elevation`, `slope`, `geology`. Every slope record says `derived_from: elevation`.
10. The retired place-name forbidden by W00 constraint `no_vinewood` is not a feature id. `world_id` Fantasy is not renamed.
