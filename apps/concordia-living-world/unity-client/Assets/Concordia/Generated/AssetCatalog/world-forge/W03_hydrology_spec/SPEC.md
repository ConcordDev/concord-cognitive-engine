# W03 — World Forge G2 world-scale hydrology

**Slice:** `W03_hydrology_spec`  
**Phase:** G2. Text and JSON only.  
**Machine file:** `SPEC.json` (`concordia-world-forge-hydrology/1.0`).  
**Consumes:** `concordia-world-forge-continental/1.0`, and through it `concordia-world-forge-field/1.0` and `concordia-world-forge-canon-graph/1.0`.  
**Batch:** `WF2_hydrology`.

This stage writes `drainage` and `water`. It reads G1 elevation, the slope derived from it, the sea mask (elevation ≤ 0), and `coasts[]`. It also reads W00 `water_dependency` and the W01 exemplar drainage and water rows for Hub, Fantasy, and Tunya. It does not write temperature, rainfall, humidity, biome, soil, resources, or fertility. Rainfall does not exist yet. Climate is the next stage and may later scale how much a channel carries. It may not move a channel.

Flower Law is a horizontal Hub disk of 42 m. It is not a watershed and not a crater. `world_id` Fantasy stays Fantasy. The display name is the Sundering. There is no second fantasy continent and no ninth Link.

## What this stage is

G1 left land and a sea mask. G2 names where that land is allowed to hold water, and the path a named channel takes across the 2 km veil-datum grid.

The field is analytic. Flow direction, accumulation, and watershed labels are a contract a binder can compute from G1. They are not a raster in this catalog. A cell becomes wet in the world-scale water mask only when a row in `channels[]`, `sheets[]`, `deltas[]`, or `wetlands[]` claims it. A high accumulation with no claim stays dry. That is how the Frontier can show a cottonwood where water was, and how the Crucible can have a sheet that should fall and does not, without a generated river country.

Dwarf Fortress draws rivers from drainage after rain. Concord’s pipeline places channels first, from elevation plus the canon water list. The closed list is the river network. Accumulation chooses the path inside that list. It does not add a member to the list.

## Two solvers, one bridge

| Solver | Question | Neighbourhood | This slice |
| --- | --- | --- | --- |
| World-scale D8 on `continental_veil_datum` | Which named body, which pour, which watershed id, at 2 km. | 8 neighbours. Orthogonal step 2000 m, diagonal 2000√2 m. | Design target. `flowDirectionAt`, `accumulationAt`, `watershedAt`, `channelAt`. Not shipped. Not stored. |
| `terrain-water.js` `solveFlowStep` | How a finite water column moves on the walk patch. | 4 orthogonal neighbours. `CELL_SIZE` 10 m (`CONCORD_TERRAIN_CELL_M`). `FLOW_RATE` 0.5. Dry below `MIN_WATER` 0.01 m. | Unchanged. Volume conserved. `tickWaterFlow` and `water-flow-cycle.js` stay the only tick. |

`solveFlowStep` pools in low ground on the play patch. It does not know watersheds, coasts, or the Sundering shelf. The D8 field does not tick, does not write `world_water_cells`, and does not add a source term. A perpetual spring inside `tickWaterFlow` would mint volume and break the conservation the tests already pin. This spec does not add one.

The walk patch’s west-to-east depression is `renderedElevationAt` (seed `0xc0ffee`, clamp [0, 80] m, 2000 m window). It is Poughkeepsie play geometry. It is not `crime_working_river`, not `sunder_short_run`, and not the Hub civic drain. A binder labels that depression `play_patch_legacy` and does not rename it to a canon `body_id`.

Sea is an infinite sink for D8 and a mask for coasts. Sea volume is not copied into `world_water_cells`. The column grid is for finite surface water on land.

## Grid inherited from G1

- Frame: `continental_veil_datum`. Horizontal: `megaworld_km`. Sea level 0 m. Sea mask: elevation ≤ 0.
- Cell: 2 km. Origin of cell `(0,0)` is the southwest corner (−520, −580) km. `gx = floor((x_km + 520) / 2)`, `gz = floor((z_km + 580) / 2)`.
- Bbox, design-intent: x −520 to 520 km, z −580 to 520 km. 520 × 550 = 286000 cells if allocated. **Do not write that raster.**
- Direction encoding, design-intent, from a cell toward a neighbour: `0` E (+gx), `1` SE, `2` S, `3` SW, `4` W, `5` NW, `6` N, `7` NE. +x is east toward Cyber. +z is north toward the Sundering.
- Extra codes, not neighbours: `sink_sea`, `sink_internal`, `flat`, `pit_unrealized`, `unstamped`.

Micro-relief from `hashSeed` is already inside the G1 elevation band. G2 does not add a second noise field. The same `hashSeed` breaks D8 ties only.

## Algorithm

Run in this order. No step rewrites elevation, slope, geology, or a coast polyline.

1. **Inherit.** Read the G1 cell class, elevation metres, derived slope, sea mask, and `coast_id` where G1 stamped one (`coast_sunder_veil_shoal`, `coast_tunya_fluxom`, `coast_crime_exodus`, `coast_crime_sere_strait`, `coast_dawn_sere`, `coast_frontier_sere`, plus outlines `inner_veil_outline` and `exodus_basin_outline`). Sere coasts and the Sere highland stay unstamped (`anchor_km: null`). Cells in `stamps_skipped` (`tunya_unplaced` and every Sere region) receive direction `unstamped` and are absent from traces.
2. **D8 direction.** For each stamped land cell, slope to a neighbour is `(z_self − z_neigh) / distance_m`. The neighbour with the greatest positive descent wins. A sea neighbour is eligible only when the land cell is an orthogonal coast (G1’s coast rule). Diagonal-only sea contact is not a pour. If the winning descent is below **0.05 m** over the step, the cell is `flat`. Ties at or above that descent break to the lowest `hashSeed(worldId + ":" + gx + ":" + gz + ":" + dir)`.
3. **Sinks.** A coast cell that steps to sea is `sink_sea` and records the `coast_id`. An authored internal sink (`infiltrate`, `civic_buried`, `dry_end`, `ice_hold`, `cracked_basin`, `canopy_hold`, `wadi_dry`) is `sink_internal` and only where a channel names that kind. A pit that is neither a sea pour nor an authored sink is `pit_unrealized`. G2 does not breach the pit, does not fill it, and does not raise G1 elevation to make an outlet. A pass is not a stream that must be cut. `pass_crucible_road_end` stays a road that ends. `pass_sunder_salt` stays a dry track. `pass_frontier_drift` stays a hand-built bridge site.
4. **Accumulation.** Each stamped land cell counts 1. A cell’s accumulation is 1 plus the sum of cells that drain to it. Units are cells, not millimetres. No rainfall weight. Sea cells accept accumulation and do not route it back onto land. `pit_unrealized` and `flat` cells that no named channel claims contribute nothing to a realized trace.
5. **Watershed label.** Label by pour. The pour is the first `sink_sea` or authored `sink_internal` on the downstream walk, capped at `max_downstream_steps` **400** (design-intent; the long axis of the bbox is 550 cells). A walk that hits `unstamped`, a forbidden region, or the cap stops as `trace_stopped` and does not jump. Alpine seep cells are watershed `sunder_alpine_seep` and are not added to `sunder_fold_run`.
6. **Realize channels.** For each `channels[]` row with `geometry: trace`, start at `mouth` and walk upstream along the unique highest-accumulation inflow that stays inside `allowed_regions`. Stop at `max_trace_cells`, at a region boundary, or at the headwater rule. The polyline is that walk. This slice stores the rule, not the vertices. A row with `geometry: none` or `inherits_coast` does not walk D8 across a disc.
7. **Lakes.** `lakes` is empty. A closed contour is not a lake. The Sundering shelf ends in a short run and infiltration. Nil’s dark water is a canopy basin. Asbir’s wadi stays dry. The forum spout is one spout in a cracked basin. Sere’s failed levee is a flood sheet, and its kilometres are still null, so it receives no cells.
8. **Deltas and wetlands.** The only delta id is `sere_delta` (reed and flood). No distributary fan is generated. Wetlands are the Sere reed, flood, and tide-stain roles, all with `stamp_cells: false`.
9. **Masks for the next stage.** `drainage` on a claimed cell carries `watershed_id`, accumulation class (the W01 vocabulary, not a new threshold), and `outlet`. `water` carries `kind`, `body_id`, a design-intent depth band, and `terminates`. Unclaimed land is `kind: none`, which is a filled value. A kind that appears in that region’s W00 `forbidden` list is an error.

## Realized water

Depth bands copied from W01 are design-intent, not soundings. Counts are canon counts.

| Id | World | Kind | Where it may exist | Outlet | Cap |
| --- | --- | --- | --- | --- | --- |
| `hub_civic_drain` | Hub | `none` | Plaza, doors, wall. Buried civic. Brass mouth is a local sink, not a channel across the court. | `civic_buried` | No trace. |
| `hub_salt_road` | Hub | `none` | Pinewood salt line. | `dry_end` | Must not enter `hub_plaza`. |
| `hub_approach_ditches` | Hub | `none` | Approaches. | `dry_end` | No river capital. Crown Road egresses stay dry. |
| `cyber_alley_drain` | Cyber | `none` | Stacks, alleys. | `dry_end` | No pastoral polyline. |
| `cyber_trench` | Cyber | `reflection` | Under-stack trench. | `civic_buried` | Not a hell level. Finite pools if a play window is ever placed. |
| `cyber_wharf_meet` | Cyber | `harbor_meet` | `cyber_wharf_march` only. | The march, not a new port city. | Drainage meets harbor. No pastoral river. |
| `ruins_forum_spout` | Ruins | `spout` | One cluster on `ruins_forum`. | `cracked_basin` | Not a forum lake. `max_trace_cells` 1. |
| `ruins_rib_channel` | Ruins | `none` | Rib bed. | `dry_end` | Ephemeral. Dry until climate exists. No perennial river, no lava tube. |
| `sunder_shelf_fall` | Fantasy | `waterfall_shelf` | Fold lip, `chain_sunder_fold`. | Into `sunder_short_run`. | One shelf. Mist stays a local note. |
| `sunder_short_run` | Fantasy | `short_run` | Wildwood below the shelf. | `infiltrate` | Does not reach `coast_sunder_veil_shoal`. `max_trace_cells` 8. Depth 0.2–0.8 m. |
| `sunder_alpine_seep` | Fantasy | `none` | Alpine rim. | `mist_only` | Accumulation class `none`. |
| `sunder_salt_track` | Fantasy | `none` | Salt toll. | `dry_end` | Drier than the fold. Not a river capital. |
| `tunya_masond_river` | Tunya | `river` | `tunya_masond` only. Count 1. | `terrace_lip` | Stops at the region boundary. Does not become a second ocean. Depth 0.4–1.5 m. `max_trace_cells` 24. |
| `tunya_asbir_wadi` | Tunya | `none` | Asbir. | `wadi_dry` | Internal accumulation. No lake. |
| `tunya_sangree_runnel` | Tunya | `runnel` | Sangree terrace. | `dry_end` | Local. Depth 0.05–0.3 m. The forge is not a second ocean. |
| `tunya_aekon_glacier` | Tunya | `ice` | Aekon. | `ice_hold` | No liquid handoff. No ice spell. |
| `tunya_fluxom_lock` | Tunya | `harbor_canal` | Fluxom coast, `coast_tunya_fluxom`. | `inner_veil` | Lock, not the Masond mouth. Depth 2–6 m. Fluxom Gate (62, 18) m stays on the claim plane. |
| `tunya_nil_basin` | Tunya | `canopy_basin` | Nil. | `canopy_hold` | Basin, not a lake. Depth 0.1–0.6 m. No clearcut. |
| `tunya_fallback_runnel` | Tunya | `runnel` | Role only. | — | `body_id` null. `anchor_km` null. No cells. |
| `frontier_former_water` | Frontier | `none` | Hitch and drift. | `dry_end` | Cottonwood marks former water. Paths do not follow a river. No mesa, no dome. |
| `crime_working_river` | Crime | `river` | Sodium and wharf, one polyline, Strahler 1. | `coast_crime_exodus`, then the barge reach. | No tributary network. Gutters stay a separate dry class. |
| `crime_dawn_lane` | Crime → Superhero | `barge_lane` | Inherits `sea_crime_superhero` (Inner Veil, open 86.1 km, barge 20 km/h). | That sea edge. | Same body as the working river’s mouth reach. Not a second river. Not inside `dawn_kane`. |
| `crime_gutters` | Crime | `none` | Streets. | `dry_end` | Rain is climate, later. Not a flood apocalypse. |
| `dawn_street_drain` | Superhero | `none` | Kane and arterials. | `dry_end` | No sacred lake. |
| `crucible_sheet` | Crucible | `none` | Lattice. | `does_not_fall` | Contradictory sheet. `realizes: false`. No pretty river city. |
| `crucible_foundry_steam` | Crucible | `steam` | Foundry edge. | — | Industrial anomaly. Not a watershed and not the whole disc. |
| `sere_failed_levee` | Sere | `flood_sheet` | `sere_flooded` role. | — | Not a clean lake. No cells until kilometres exist. |
| `sere_failed_irrigation` | Sere | `none` | Breadlands role. | — | Not a fertile-heartland river. |

The Crime–Sere strait (`coast_crime_sere_strait`, **24.0** km, Exodus) is open sea. It is not the working river and not a gate. Dawn’s longer Exodus leg is `coast_dawn_sere` (**54.8** km). Frontier–Sere is `coast_frontier_sere` (**329.0** km) and stays island-free. Land marches stay **86.1** km of ground. `sea_tunya_fantasy` is the shoal, not a river. `march_fantasy_tunya` stays land.

`lakes` is an empty array. Shoal, strait, lock, spout, canopy basin, and flood sheet do not set `lake: true`.

## Delta and wetlands

| Id | Kind | Stamp |
| --- | --- | --- |
| `sere_delta` | `reed_flood` | `stamp_cells: false`. The only delta. No generated distributaries. Trade node `node_sere_delta` already exists on the canon graph; this slice does not add a city. |
| `sere_drowned_tide` | `tide_stain` | Role on `sere_drowned` / pier and shallow. No clean lake. |
| `sere_flood_sheet` | `flood_sheet` | Same hold as `sere_failed_levee`. |

`chain_sere_highland` stays wind, not a lake, and still has no cells.

## Play-patch bridge

Proposed reader, not shipped: `channelSeedForPlayPatch(worldId, bodyId)` beside `setWater` in `server/lib/terrain-water.js`.

Until a later physicalization slice records the 2000 m window’s origin on `continental_veil_datum`, the function returns `{ ok: false, reason: "play_window_unplaced" }`. This slice does not guess that the Poughkeepsie patch is the Sundering fold, the Iron Coast wharf, or the Hub court.

When a placement record exists, a seed is allowed only if all of the following hold:

- The body is in `seed_when_placed` (short run, Sangree runnel, Nil basin, Masond river, Fluxom lock, forum spout, Crime river, Cyber trench).
- The window’s geographic class is inside that body’s `allowed_regions`.
- The seed is one finite column at the band’s **minimum** depth (design-intent), laid on cells the trace claims, resampled at 10 m.
- `solveFlowStep` then moves that volume. Nothing refills it on the heartbeat.
- Ice, steam, civic drains, dry wadis, ephemeral rib, Frontier former water, Crucible sheet, sea, and every Sere role return `{ ok: false, reason: "no_column" }` even after placement.
- Hub plaza, doors, wall, Pinewood, and approaches never call `setWater`.

Macros already on the wire stay the call path: `terrain.set_water` calls `setWater`, `terrain.water_depth` calls `waterDepthAt`, `terrain.flow_tick` calls `tickWaterFlow`. One call site each. The heartbeat remains `runWaterFlowCycle` in `server/emergent/water-flow-cycle.js`, which emits `concordia:water-updated` only when `cellsMoved > 0`.

## Concord integration

| Target | Today | Design target this spec names | Leave in place |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` | `terrainSpec` / `renderedElevationAt` / `generatePoughkeepsieHeightmap`, seed `0xc0ffee`. `hashSeed` is FNV-1a and is not applied to that grid. G1’s `continentalElevationAt` is still a design target, not code. | D8 reads `continentalElevationAt` once it exists. Tie-break uses the existing `hashSeed`. | Do not route D8 on `renderedElevationAt`. Do not feed veil metres into the walk formula. Do not switch the walk seed. |
| `server/lib/terrain-deformation.js` `baseElevation`, `CELL_SIZE` 10 m | Digs follow the walk patch. `baseElevation` delegates to `renderedElevationAt`. | Local columns still sit on that top. | Do not store the 2 km grid or a watershed id in the deformation table. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow`, `waterDepthAt`, `waterGridForWorld`, `loadWaterGrid` | 4-neighbour flow, volume conserved, dry neighbour ring so a ditch can fill. | Add the seed reader above. It returns unplaced until the window is sited. | Do not ship a second solver. Do not change `solveFlowStep` to D8. Do not pour the sea into `world_water_cells`. Do not seed the Hub plaza or a Sundering lake. |
| `server/domains/terrain.js` | `set_water`, `water_depth`, `flow_tick`, `dig`. | Same macros. A future seed enters through `set_water` or the reader, not a new domain. | Do not register `hydrology.generateRivers`. |
| `server/emergent/water-flow-cycle.js` `runWaterFlowCycle` | Ticks worlds that already have cells. | Unchanged. | Do not tick the continental graph on the 15 s governor. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs and a Living Society row. | Suitability, later, may prefer an existing `region_id` whose `water.kind` is `river`, `harbor_canal`, or `short_run`. | Do not spawn a town from accumulation, from `sere_delta`, or from a crest cell. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` (domain `server/domains/faction-strategy.js`, cycle `server/emergent/faction-strategy-cycle.js`) | Stance and moves on authored factions. | A move may name a `body_id`, `watershed_id`, `coast_id`, or `region_id` from this spec and from G1. | Do not mint a kingdom on a delta, a wharf, or a spout. Hub territories stay empty. The Crucible gains no ninth district. The seam stays unfinished. |
| Unity `WorldGeography` | Routes and borders. Hub territories empty. | Binder agrees the barge lane with `sea_crime_superhero` and the strait gaps with the atlas. | Do not promote claim circles or the 0.55 m/km present scale into veil metres. |

Procedural buildings and TreeLayer wait for physicalization. They are not G2 consumers. The Masond river is a condition for a later settlement score. It is not a city.

## Outputs for the next stage

G3 (climate, then biome and resources) reads `watershed_id`, accumulation class, `outlet`, `water.kind`, and the ephemeral flag. It may write a `carry_class` multiplier from rainfall onto a channel that already exists. It may wet `ruins_rib_channel` and `frontier_former_water` as a seasonal fraction. It may not lay a new polyline, cut the Hub plaza, lake the Sundering, finish `pass_crucible_road_end`, or turn steam into a continent.

Mobility (later) reads `crossings`:

- `crime_dawn_lane` is barge water at the W00 speed **20** km/h on `sea_crime_superhero`.
- Crown Road egress `egress_hub_crown` has no channel.
- `pass_crucible_road_end` has no stream.
- `pass_frontier_drift` is not a river the Walker Paths follow.
- The 24.0 km strait is `open_exodus` water, speed class 12 km/h, and `HasLinkGate` stays false for Sere.

## What not to build yet

- No watershed raster, no accumulation GeoTIFF, no 286000-cell JSON, no baked river mesh.
- No edit to `world-terrain.js`, `terrain-water.js`, `terrain-deformation.js`, settlement spawn, faction strategy, or the water heartbeat.
- No rainfall model, no biome tint, no soil moisture grid.
- No city on the Fluxom lock, the Crime wharf, or `sere_delta`.
- No cells for Sere, for `tunya_unplaced`, for `tunya_fallback`, or for the Last Dome mile.
- No retune of Flower Law, of seed `0xc0ffee`, of the 80 m clamp, of `CELL_SIZE`, or of batches B21–B31.
- No meshes, no images, no `PROMPTS_INDEX` rows.

## Validation a later binder can run

1. `schema` is `concordia-world-forge-hydrology/1.0` and `consumes` names the continental spec, the field schema, and the canon graph.
2. `writes_channels` is exactly `drainage` and `water`.
3. Every `allowed_regions` id exists on that `world_id` in the W00 graph. Every `coast_id` used as an outlet exists in the W02 `coasts[]` list, or is `inner_veil_outline` / `exodus_basin_outline`.
4. `lakes` is empty. No row sets `lake: true`. `sere_delta` is the only delta, with `stamp_cells: false`.
5. No channel has a Hub region and `kind` `river`, `lake`, or `waterfall`. `sunder_*` rows do not terminate in a lake. `tunya_masond_river.count` is 1 and its regions are only `tunya_masond`.
6. `ruins_forum_spout.max_trace_cells` is 1. `ruins_rib_channel.ephemeral` is true and `kind` is `none`. `crucible_sheet.realizes` is false.
7. `crime_dawn_lane` inherits `sea_crime_superhero` and does not list `dawn_kane`. The strait gap stays 24.0 km and is not a `body_id` for the working river.
8. Sere rows and `tunya_fallback_runnel` and `tunya_unplaced` have `stamp_cells: false`. Unplaced names do not gain coordinates.
9. `play_patch.seed` is 12648430 and `max_elevation_m` is 80. Flower Law radius is 42 on a horizontal axis. `channelSeedForPlayPatch` reasons include `play_window_unplaced`.
10. The retired place-name forbidden by W00 constraint `no_vinewood` is not a feature id. `world_id` Fantasy is not renamed. Sea is not a column in `world_water_cells`.
