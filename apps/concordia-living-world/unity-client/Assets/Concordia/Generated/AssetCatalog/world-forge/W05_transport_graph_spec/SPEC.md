# W05 — Transportation geography and route cost

**Slice:** `W05_transport_graph_spec`  
**Phase:** G4a (mobility only). Territory, capitals, and faction borders wait.  
**Batch:** `WF4_roads`  
**Machine file:** `SPEC.json` (`concordia-world-forge-transport/1.0`).  
**Consumes:** `concordia-world-forge-biome-resource/1.0`, and through it hydrology, the continental spec, the field schema, and the canon graph.  
**Authority for edges:** `lookfeel/MAP_MASTER.json` `links[]`, already copied onto W00 `trade_graph`. This slice annotates those 31 edges. It does not resample them.

## What this stage is

Pipeline order places mobility after resources and before suitability. W01 did not give mobility a field channel. This stage does not add one, and it does not allocate the 2 km grid.

The product is a cost graph:

- Every atlas edge keeps the minutes `MAP_MASTER.json` already published.
- A gate and the Crown Road under it are parallel choices. Their minutes are not added.
- Natural crossings are a closed list taken from G2 passes and one realized river. A wet carry label does not create a ford.
- Human roads, bridges, and ports are the edges and nodes already named. Least-cost search does not grow a new spoke, a new port city, or a ninth door.
- Four clocks stay separate: plaque minutes, atlas kilometres, Present metres, Hub canon metres.

`world_id` Fantasy stays the Sundering. Flower Law stays a 42 m horizontal disk. Sere stays off `Canon.Gates`. The Crucible–Grid seam stays unfinished. The place-name forbidden by W00 `no_vinewood` is not a route id.

## Clocks

| Clock | Where it lives | What a binder may do with it |
| --- | --- | --- |
| Plaque | Eight `kind: gate` edges, 2 minutes each | Offer the Link as its own mode. Do not convert 2 minutes into 400 km. |
| Atlas | `travel_minutes` on roads, walkers, seas, and weak edges | Copy the integer. Do not retime it from a slope multiplier or from a second speed class. |
| Present | `present_metres_per_km` 0.55, ring 220 m. `WorldGeography` waypoints are this clock. | Keep the chord. Do not feed those metres into the 5 km/h formula. |
| Hub canon metres | Court 16, Ring of Doors 34, Flower Law 42, wall 56, Pinewood (62, −28), arena steel disk radius 8 m at (0, 18) | Price a local step in metres. Do not emit a kilometre edge across the plaza. |

Steel on a Hub plaque is a flower. Steel on the far side of a gate is that country’s own law. The Dawn plaque is inside the 42 m disk. The Dawn continent is not.

## Atlas edges, copied

Thirty-one edges. Identifiers are the W00 `trade_graph` ids. Minutes match `MAP_MASTER.json` `travel_minutes_walk_est`. Speeds are the walk model: road 5 km/h, walker 3.5, coastal sea 15, river barge 20, open Exodus 12, waystone scramble 3. A Link is not a speed.

| Id | Kind | Minutes | Distance the minutes already price | Pathfinder |
| --- | --- | --- | --- | --- |
| `gate_hub_cyber` | gate | 2 | none | yes, plaque mode |
| `road_hub_cyber` | road | 4800 | 400 km at 5 km/h | yes, parallel to the gate |
| `gate_hub_ruins` | gate | 2 | none | yes, plaque mode |
| `road_hub_ruins` | road | 4800 | 400 km at 5 km/h | yes |
| `gate_hub_fantasy` | gate | 2 | none | yes. Far side is the Sundering. |
| `road_hub_fantasy` | road | 4800 | 400 km at 5 km/h | yes |
| `gate_hub_tunya` | gate | 2 | none | yes |
| `road_hub_tunya` | road | 4800 | 400 km at 5 km/h | yes |
| `gate_hub_frontier` | gate | 2 | none | yes |
| `road_hub_frontier` | road | 4800 | 400 km at 5 km/h | yes |
| `gate_hub_crime` | gate | 2 | none | yes |
| `road_hub_crime` | road | 4800 | 400 km at 5 km/h | yes |
| `gate_hub_superhero` | gate | 2 | none | yes |
| `road_hub_superhero` | road | 4800 | 400 km at 5 km/h | yes |
| `gate_hub_crucible` | gate | 2 | none | yes |
| `road_hub_crucible` | road | 4800 | 400 km at 5 km/h | yes |
| `march_cyber_ruins` | road | 1033 | 86.1 km open at 5 km/h | yes |
| `march_ruins_fantasy` | road | 1033 | 86.1 km | yes |
| `march_fantasy_tunya` | road | 1033 | 86.1 km | yes |
| `walk_tunya_frontier` | walker | 1476 | 86.1 km at 3.5 km/h | yes |
| `walk_frontier_crime` | walker | 1476 | 86.1 km at 3.5 km/h | yes |
| `march_crime_superhero` | road | 1033 | 86.1 km | yes. The barge is a second edge. |
| `march_superhero_crucible` | road | 1033 | 86.1 km | yes |
| `march_crucible_cyber` | road | 1033 | 86.1 km | **no.** Retained so the atlas row is not deleted. |
| `sea_tunya_fantasy` | sea | 344 | 86.1 km at 15 km/h, Inner Veil | yes |
| `sea_crime_superhero` | sea | 258 | 86.1 km at 20 km/h barge | yes |
| `sea_crime_sere` | sea | 96 | 24.0 km gap | yes. Not a Link. |
| `sea_superhero_sere` | sea | 219 | about 54.8 km | yes. Dawn does not govern Sere. |
| `sea_frontier_sere` | sea | 1645 | about 329.0 km at 12 km/h | yes |
| `waystone_crime_sere` | weak | 480 | scramble, 3 km/h | yes. Not a Link. |
| `seam_crucible_cyber` | weak | 1476 | same march, walker rate | **yes.** This is the land cost of that pair. `finished: false`. |

Eight Crown Roads are center-to-center design intent. Metro occupies the first 40 km of each, which is 480 of the 4800 minutes. Approaches run to about 80 km, another 480 minutes, still inside the same edge. This slice does not split a Crown Road into three edges. `egress_hub_crown` has no channel. The roads leave `hub_approaches`. They do not cross `hub_plaza`.

`march_crucible_cyber` and `seam_crucible_cyber` are both in the atlas. A closed paved choice at 1033 minutes would finish the Eighth Refusal’s seam. The pathfinder therefore walks `seam_crucible_cyber` (1476 minutes, unfinished). The 1033 row stays in the file as the copied march template. People still walk the seam. W03 `pass_crucible_road_end` still has no stream, and mobility still may not finish it.

### Strait clock, stated so a later pass does not “correct” it

`sea_crime_sere` is 96 minutes across the 24.0 km gap. That division is 15 km/h. W03’s crossing row labels the same water `open_exodus` at 12 km/h, which would be 120 minutes. G4a keeps **96**. The Exodus class tag rides beside the edge. It does not replace the published minute count. The long ocean leg `sea_frontier_sere` is the edge that already carries 12 km/h (329 km, 1645 minutes).

`waystone_crime_sere` is 480 minutes at 3 km/h, the same 24.0 km of near ground. The stone is `env_sere_waystone` on the canon. It has no arch. `MegaworldMap.HasLinkGate` is false for Sere. Flower Law does not travel with the traveler.

`sea_superhero_sere` at 219 minutes over about 54.8 km is the coastal 15 km/h arithmetic. W00 stored no `speed_kmh` on that row. G4a does not write a new minute count.

Neighbor chord of centers is 306.15 km and is the long way around the hearts. March cost uses the 86.1 km gap between disc edges, which is the figure the minutes already use.

## Natural routes

Natural ground is read from slope class, `water.kind`, and the G2 crossing list. It is not a second road network.

Slope classes stay the W01 breaks, derived in G1, never authored here: `near_level` < 0.04, `gentle` < 0.12, `moderate` < 0.25, `steep` < 0.50, `cliff` ≥ 0.50.

Closed natural list:

| Id | Where | What it is | What it is not |
| --- | --- | --- | --- |
| `pass_sunder_salt` | `sunder_salt_toll` | Dry track. Walker 3.5 km/h. Water kind on `sunder_salt_track` is `none`. | A river, a toll invented as currency, a new Crown Road. |
| `pass_frontier_drift` | `frontier_hitch`, `frontier_drift` | Hand-built bridge **site**. `spans_river: false`. | A river the Walker Paths follow. Those paths remain `walk_tunya_frontier` and `walk_frontier_crime`. Cottonwood marks former water. It does not become a ford. |
| `pass_crucible_road_end` | `crucible_lattice` | A road that ends. `mobility_may_finish: false`. Sheet `realizes` stays false, so there is no water penalty and no stream. | A finished highway into the Grid. A ninth district. |
| `cross_tunya_masond` | `tunya_masond` only | Foot crossing of the one realized river (`kind: river`, count 1). Time multiplier 1.8 on the walker rate is design-intent. Polyline is null. | A bridge, a second river, a city, a crossing minted because G3 said `wet`. |

`channel_carry` classes `wet`, `moderate`, `saturated`, `seasonal_low`, and `arid_trace` do not add crossings. In particular:

- `ruins_rib_channel` stays `kind: none`. Seasonal fraction 0.15 does not open a barge.
- `frontier_former_water` stays `kind: none`.
- `crime_gutters` do not join the working river as a polyline.
- `sunder_short_run` and `sunder_shelf_fall` are not fords. The fall’s mist stays at the fall.
- `tunya_nil_basin` is canopy. Veto `no_clearcut` means no timber road. Foot time on saturated ground uses design-intent multiplier 1.6. Wheeled traffic is blocked.
- `tunya_aekon_glacier` is ice. Design-intent foot speed is 3 km/h. No barge. No ice spell.
- `crucible_sheet` does not become a lake by being labeled seasonal.
- `hub_civic_drain` is not a river, and the salt road must not enter the plaza.

Sea-mask cells are impassable on foot except at a coast id that an existing edge already names. A cliff cell is impassable unless the closed list names a pass on that region. House Voss remains a stair fragment, not a flying castle and not a road.

## Human routes, bridges, ports

Human infrastructure in this slice is identification, not construction.

**Crown Roads.** Eight, ids `road_hub_*`, speed 5 km/h, node `edge_crown_roads` on `hub_approaches`. The Link plaques are `gate_hub_*` on `hub_doors`, radius 34 m, inside Flower Law. Pinewood is `node_pinewood` at canon metres (62, −28), outside the disk, and is not a ninth spoke. `CourtGroundDress` objects named `CrownRoad_` are Hub dress on the local clock. They are not these 400 km edges.

**Ring marches.** Six road marches and two Walker Paths, as the table. Cairns on the walker pair. The walker pair is not a dome.

**Seam.** `seam_crucible_cyber` is the human-walked unfinished edge. `node_foundry_edge` already carries `edge_crucible_cyber_seam`.

**Bridges that exist as records:**

- `pass_frontier_drift` is a site. It does not span `frontier_former_water`.
- Cyber sky-bridges are W02 built relief (`skybridge` on stacks). They connect floors inside `cyber_stacks`. They are not ground elevation and not atlas kilometres.
- Ark Exodus is lore of leaving. It is not a span and not a spoke. Tunya is the other end of that old umbilical, and this graph draws no gate between them.

**Ports that already have nodes.** None of them add a city.

| Record | Node already on the graph | Water already named | Rule |
| --- | --- | --- | --- |
| Fluxom lock | `node_fluxom` | `tunya_fluxom_lock`, edge `sea_tunya_fantasy` | The lock is the harbor. Fluxom Gate at (62, 18) m stays on the local claim plane. |
| Iron Coast wharf | `node_wharf` | `crime_working_river`, barge edge `sea_crime_superhero`, strait `sea_crime_sere`, scramble `waystone_crime_sere` | The working river is not the 24 km strait. No gate to Sere. |
| Grid wharf march | `edge_cyber_crime` | `cyber_wharf_meet` on `coast_cyber_wharf_march` | Harbor is the march. `adds_port_city` stays false. The node is not a chord to Crime. No pastoral river. |
| Sere marks | `node_sere_pier`, `node_sere_waystone`, `node_sere_delta` | Exodus edges already listed | `stamp_cells: false`. `node_sere_delta` is not a city. No ninth Refusal. |
| Dawn coast | `node_kane` is the heart, not a new harbor | `sea_superhero_sere`, coast gap about 54.8 km | No harbor city added on the permanent-dawn shore. |

`node_fold_road`, `node_bronx_arterials`, and `node_drift_gap` stay nodes. Dawn arterials are Present-metre streets inside the disc. They do not gain a kilometre length in this file. `edge_cyber_crime` is not promoted to a `links[]` row; Cyber and Crime are not ring neighbors.

`WorldGeography.BuildBordersAndRoutes` already builds nine Present-space polylines, kind `international-road`, plus local `regional-road` chords of width 3.2 between settlements. Folder names are `WorldBook.Folder`: `cyber`, `sovereign-ruins`, `fantasy`, `tunya`, `concord-link-frontier`, `crime`, `superhero`, `lattice-crucible`, `sere`. The nine ids are:

- `route/cyber/sovereign-ruins` → `march_cyber_ruins`
- `route/sovereign-ruins/fantasy` → `march_ruins_fantasy`
- `route/fantasy/tunya` → `march_fantasy_tunya` and, as a second mode, `sea_tunya_fantasy`
- `route/tunya/concord-link-frontier` → `walk_tunya_frontier`
- `route/concord-link-frontier/crime` → `walk_frontier_crime`
- `route/crime/superhero` → `march_crime_superhero` and, as a second mode, `sea_crime_superhero`
- `route/superhero/lattice-crucible` → `march_superhero_crucible`
- `route/lattice-crucible/cyber` → atlas pair kept; pathfinder cost is `seam_crucible_cyber`
- `route/crime/sere` → `sea_crime_sere` and `waystone_crime_sere`. Not a gate.

Hub is absent from that ring loop, so Crown Roads have no `route/concordia-hub/...` row. Local settlement chords stay on the Present clock. G4a does not reprice them, and it does not edit `WorldGeography.cs`. Border tariff stays `CrossRing.RingTariff` (0.05, or 0.12 where the existing code already marks a dispute). This cost graph is time. It does not write money.

## Cost model

Published minutes are the weight. For an atlas edge:

```
weight_minutes = travel_minutes
slope_mult = 1
surface_mult = 1
```

A binder that multiplies 4800 by a slope factor has left the atlas.

For ground that is not an atlas edge, and only after a cell grid exists (it does not in this slice):

```
effective_kmh = mode_kmh / (slope_mult * surface_mult)
weight_minutes = distance_km / effective_kmh * 60
```

`mode_kmh` is the walk-model number for that surface. Design-intent multipliers, marked so they are not mistaken for surveyed engineering:

| Slope class | `slope_mult` | Wheeled |
| --- | --- | --- |
| `near_level` | 1.00 | allowed on a human road surface |
| `gentle` | 1.15 | allowed on a human road surface |
| `moderate` | 1.45 | allowed on a human road surface |
| `steep` | 2.40 | blocked |
| `cliff` | impassable | blocked, unless the closed pass list names that region |

| Surface | `mode_kmh` | `surface_mult` |
| --- | --- | --- |
| Crown or ring road already in the atlas | 5 | 1, and the formula is not reapplied |
| Walker path or dry salt track | 3.5 | 1 |
| Masond foot crossing | 3.5 | 1.8 |
| Saturated canopy (`tunya_nil`) | 3.5 | 1.6, and no timber road |
| Ice (`tunya_aekon`) | 3 | 1, foot only |
| Seasonal dry (`kind: none` with a wet fraction) | 3.5 | 1, no barge |
| Sea mask | none on foot | use the sea edge or stay blocked |
| Hub plaza and Ring of Doors | local metres, not this formula | Flower Law unchanged |

Impassable results store `weight_minutes: null` and `blocked: true`. They are not given a large sentinel number.

Mode choice on a pair that has two edges (gate and road, road and barge, boat and waystone) is a min over legal modes. The Crucible–Grid pair is the exception: the paved march is illegal for the pathfinder, so the minimum is the seam, not 1033.

Gates do not accumulate with the road beneath them. A traveler who takes the plaque pays 2. A traveler who walks pays 4800. A traveler does not pay 4802.

## Concord integration

| Target | Today | What this spec names | Leave in place |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` | `renderedElevationAt`, seed `0xc0ffee`. `hashSeed` does not drive that grid. | Slope class for a future cell weight comes from the continental field once `continentalElevationAt` exists. | Do not pathfind on the Poughkeepsie heightmap. Do not retune the seed or the 80 m clamp. |
| `server/lib/terrain-water.js` | `solveFlowStep`, `setWater`, `tickWaterFlow`. G2 seed reader returns `play_window_unplaced`. | A crossing may name a `body_id` whose `kind` is already `river`, `barge_lane`, or a coast the atlas uses. | A carry label does not call `setWater`. No ford on the plaza. No Sundering lake. The strait is not `crime_working_river`. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs and a Living Society row. | Suitability, later, may read `touches_edge` on an existing `region_id`. | Do not spawn a town from a port node, from `node_sere_delta`, from `cross_tunya_masond`, or from a cheap minute count. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | Stance on authored factions. Domain `server/domains/faction-strategy.js`. Cycle `server/emergent/faction-strategy-cycle.js`. | A move may name an edge id in this graph. | Do not set `seam_crucible_cyber.finished` true. Do not mint a kingdom on a road. Hub territories stay empty. The Crucible gains no ninth district. |
| Unity `WorldGeography` | `Routes`, borders, local chords. `MegaworldMap.HasLinkGate` is false for Sere. `CrossRing.RingTariff` is 0.05. | Attach `atlas_edge_id` as a lookup when a binder arrives. | Do not move waypoints. Do not turn `route/crime/sere` into a gate. Do not delete `route/lattice-crucible/cyber`. Do not price Present metres as kilometres. |
| Unity `WorldGate` / `Canon.Gates` | Eight spokes. | Plaque mode stays those eight. | Do not add Sere. Do not flower the continent because the plaque flowers. |
| Procedural buildings and TreeLayer | Local meshes. | Physicalization, later, may place an existing kit on an edge that already exists. | No road mesh in G4a. No new bridge mesh. No vehicle batch. B26 stays as it is. |

## Outputs for the next stage

Suitability may read:

- `weight_minutes` and `pathfinder_use` on an edge
- `blocked` on a slope or sea mask
- `touches_edge` and `touches_pass` for a named region
- `adds_city: false` on every port record

A low minute count is not a settlement score. Nil keeps `suitability_cap: listening_grove`. The Fluxom lock, the Crime wharf, the Grid march, and `node_sere_delta` stay without a generated city. Fertility is not an input to this graph and is not rewritten.

Infrastructure, later, may build only on an edge or crossing id in this file. It may not Dijkstra a new Crown spoke. It may not span Ark Exodus. It may not pave `seam_crucible_cyber` into `march_crucible_cyber`.

Civilization, later, may attach an authored faction to an edge id. It may not draw a territory because a march is cheap.

## What not to build yet

- No cost raster, no NavMesh, no spline, no 286000-cell JSON, no road mesh, no bridge mesh.
- No edit to `world-terrain.js`, `terrain-water.js`, `procgen-settlements.js`, `faction-strategy.js`, `WorldGeography.cs`, `MegaworldMap.cs`, or `WorldGate.cs`.
- No new `MAP_MASTER` link. No retiming of 96 minutes to 120. No split of the 4800-minute Crown Roads.
- No ninth gate, no Sere arch, no Ark Exodus span, no Cyber–Crime chord, no paved seam.
- No port city, no town on a ford, no kingdom on a minute count.
- No cells for Sere, `tunya_unplaced`, `tunya_fallback`, the Last Dome mile, `ruins_envoy_claim`, or the Dawn crown-stair glue.
- No retune of Flower Law, of seed `0xc0ffee`, or of batches B21–B31.
- No meshes, no images, no `PROMPTS_INDEX` rows.

## Validation a later binder can run

1. `schema` is `concordia-world-forge-transport/1.0`. `consumes` names biome-resource, hydrology, continental, field, and canon-graph.
2. `writes_channels` is empty. Elevation, slope, drainage, water, climate, biome, soil, resource, and fertility are not written. `grid.materialized` is false.
3. `edges` has 31 rows. Each `id` is a W00 `trade_graph` id. Each `travel_minutes` equals that row. No row’s minutes were recomputed.
4. Eight gates are 2 minutes, `distance_km` null, and parallel to the eight Crown Roads. No weight sums a gate onto 4800.
5. `march_crucible_cyber.pathfinder_use` is false. `seam_crucible_cyber.pathfinder_use` is true and `finished` is false. `pass_crucible_road_end.mobility_may_finish` is false.
6. `sea_crime_sere.travel_minutes` is 96. `link_gate` is false. `waystone_crime_sere` is 480. Sere is absent from the gate list.
7. `named_crossings` is exactly the four ids in the natural table. No crossing cites a `channel_carry` class as its reason, except to forbid that reading.
8. Every port record has `adds_city` false. `edge_cyber_crime` has an empty edge list.
9. `WorldGeography` route ids in `present_route_lookup` match `WorldBook.Folder` order. Hub spokes are absent there.
10. Flower Law radius is 42 on a horizontal metre axis. `world_id` Fantasy is not renamed. The retired place-name forbidden by W00 is not a route id.
