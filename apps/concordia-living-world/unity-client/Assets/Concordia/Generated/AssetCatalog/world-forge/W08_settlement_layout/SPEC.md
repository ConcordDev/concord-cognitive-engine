# W08 — Settlement layout

**Slice:** `W08_settlement_layout`  
**Phase:** G5 (spatial hierarchy only). Headcount, prices, parcel counts, pavement, and meshes wait.  
**Batch:** `WF5_layouts`  
**Machine file:** `SPEC.json` (`concordia-world-forge-settlement-layout/1.0`).  
**Consumes:** `concordia-world-forge-territory/1.0`, and through it suitability, transport, hydrology, and the canon graph.

Pipeline order still runs Population, Economy, Growth, and Infrastructure before mesh physicalization. This stage does not skip them. It authors the **slots** those stages write into: a district use and an internal road on a region W06 already scored and W07 already bound.

It does not allocate the 2 km grid, does not write a W01 field channel, and does not found a settlement. `spawnSettlementForRegion` still sprinkles 3–5 NPCs. A district is not that sprinkle. `physicalize` stays false on every row. `population` and `parcel_count` stay null.

`world_id` Fantasy stays the Sundering. Flower Law stays a 42 m horizontal disk. Sere stays off `Canon.Gates`. The Crucible–Grid seam stays unfinished. The place-name forbidden by W00 is not a layout id. Pinewood Crossing is the only lettering of that Hub milepost.

## What this stage is

Territory already said which faction may sit on a pad, and which mine, farm, and port that sitting is allowed to be. Layout answers: **which uses that pad may contain, and which internal road may serve them.**

Uses are a closed set:

`residential`, `commercial`, `industrial`, `agricultural`, `government`, `defense`, `water`.

Road classes are a closed set:

`ring`, `spine`, `lane`, `wharf`, `terrace`, `built_relief`, `unfinished`.

A road cites a W05 id that already exists, or it cites nothing. It does not add an atlas edge, and it does not set `finished`.

The product is 28 layouts on stamped regions, 8 Sere role sketches with no coordinates, 1 folded Hub district, and 7 refused pads. That is the 44 W06 regions. Districts on layouts: 57. Role labels: 7. Roads: 20. Agricultural districts: 1 (`farm_masond_landings` only). Kingdoms minted: 0.

`WorldBook.DistrictsForCountry` already copies `controlled_districts` onto country cities. Strings in `not_layout_controlled_districts` stay claim-plane names. `sandrun_forge_quarter` is the exception that is bound: it is `dist_sangree_forge`, not a second town. The four Hub heart ids in `SettlementCompiler.IsHubHeartDistrict` map onto named districts below. They are not replaced.

## Inputs

| Piece | Reads | Does not |
| --- | --- | --- |
| Layout | W06 `tier`, `cannot_found`, `stamp_cells`, `parent_region_id` | Rescore. Promote a hamlet because a faction file has three district strings. |
| Use | W07 `site_id` and kind, W03 body id, W04 vetoes already applied in W06 | Invent a farm, a mine, or a harbor. Turn the civic drain into a river district. |
| Road | W05 edge, pass, port, and node ids, plus `finished` | Pave `seam_crucible_cyber`. Turn `edge_cyber_crime` into a chord. Turn a 2-minute plaque into 400 km. |
| Cap | Tier | Read `WorldGeography.PopulationFor` (clamp 30–900) as a census. Read a claim radius as a block count. |

Tier caps, design-intent: city 6, town 4, village 3, hamlet 1. Hub’s city layout uses 5. No layout exceeds its cap.

## Algorithm

Run in this order. No step writes elevation, water flow, a faction row, an NPC, or a mesh.

1. **Copy the region.** Tier and vetoes stay as W06 left them. W07 `kingdom` stays false. This slice does not reopen a refused capital.
2. **Refuse.** `cannot_found` with no fold emits nothing. The refused pads are `ruins_envoy_claim`, `tunya_fallback`, `tunya_unplaced`, `frontier_last_dome_unplaced`, `dawn_crown_stair_glue`, `sere_flooded`, `sere_delta`.
3. **Fold.** `hub_doors` is `dist_hub_doors` inside `layout_hub_court`. It is not a second city and not a second layout.
4. **Role sketch.** `stamp_cells: false` and `cannot_found: false` (the eight Sere pads that are not drowned or “no new beauty”) get labels only. `coordinates` null. `roads` empty. `port_sere_pier` is not among them.
5. **Uses.** Fill from the closed set until the cap. Agricultural only on a W07 farm. Water only for a body that is already a walkable river, lock, harbor march, or working river. A mine yard only on a W07 mine. Salvage, lattice works, and the Sere shift may be industrial without a new mine record.
6. **Roads.** At most the roads listed. A spine, wharf, terrace, or unfinished class cites one existing id. Class `unfinished` stays `paved: false`.
7. **Filter authored district strings.** If a `controlled_districts` entry is not a `unity_district_id` on a district in this file, it is not a layout.
8. **Stop.** Leave `population` and `parcel_count` null. Leave `physicalize` false.

## Layouts

### Hub — one city-state, eight MAP_MASTER names

Flower Law is 42 m. The door ring is 34 m. The wall is 56 m. Arena sand is (0, 18) radius 8: steel is live there, and the disk still covers it. Pinewood is (62, −28), lettered Pinewood Crossing, outside the law. Three Refusals is (−48, −58), a tavern, not a ninth gate.

| Layout | Region | Tier | Uses | Roads |
| --- | --- | --- | --- | --- |
| `layout_hub_court` | `hub_plaza` plus folded `hub_doors` | city | government court, government archive, commercial market, government link ring, defense arena | `ring` at 42 m and 34 m. Eight plaques attach. They stay 2 minutes. |
| `layout_hub_wall` | `hub_wall` | village | defense wall (`warden_ring_wall`) | `ring` at 56 m. Not a realm outline. |
| `layout_hub_pinewood` | `hub_pinewood` | village | commercial milepost | `lane` citing `node_pinewood`. Not a ninth spoke. |
| `layout_hub_approaches` | `hub_approaches` | village | commercial tavern | `spine` citing node `edge_crown_roads`. The eight Crown Roads already leave. This mouth adds no road id. Ordinal `road_verge` still forbids a city. |

No agricultural use, no industrial use, and no water district. The civic drain is not a river. Import food sits on the market. `WorldGeography.Territories(Hub)` stays empty. Faction on the court and the wall is `concordant_assembly`.

Unity map: `council_chamber` → inner court, `archive_quarter` → assembly and archive (one district), `market_district` → market awnings, `warden_ring_wall` → the wall layout.

### Grid

| Layout | Tier | Uses | Road |
| --- | --- | --- | --- |
| `layout_cyber_stacks` | city | government heart, residential stacks, commercial exchange, industrial cable salvage | `built_relief` citing note `cyber_skybridge`. Not an atlas edge. |
| `layout_cyber_under` | village | industrial service | none. Not hell. |
| `layout_cyber_wharf` | village | water harbor march, commercial march trade | `wharf` citing `port_cyber_wharf_march`. `edge_cyber_crime` stays a node, not a chord. `adds_city` stays false. |

Faction `zero_collective` on the stacks and the underlevel. Salvage is not mine `cyber_cable_salvage`. No farm. No pastoral river. Seat `cap_cyber_stacks`.

### Sovereign Ruins

| Layout | Tier | Uses | Road |
| --- | --- | --- | --- |
| `layout_ruins_forum` | town | government archive, commercial quiet trade, residential lodging | `lane` that touches `march_cyber_ruins` and `march_ruins_fantasy` and owns neither. |
| `layout_ruins_rib` | hamlet | residential shelter | none. Channel kind stays `none`. |
| `layout_ruins_unfinished` | hamlet | commercial empty-road stall | `lane`. No new march. |

Faction on the forum is `ruins_archivists`. Catalogue, not a conquest capital. `ruins_cold_iron` is not a mine district. One spout, no lake.

### Sundering (`Fantasy`)

| Layout | Tier | Uses | Road |
| --- | --- | --- | --- |
| `layout_sunder_wildwood` | village | government oak shrine, residential grove | none. Grove food is not a farm. No lake. |
| `layout_sunder_fold` | village | residential track, defense stair | `lane` citing `node_fold_road`. Not a Crown Road. |
| `layout_sunder_alpine` | hamlet | defense high hold | none. |
| `layout_sunder_salt` | village | commercial toll, residential homes | `spine` citing `pass_sunder_salt`. No new kilometres. |

Faction on the grove and the fold is `wildwood_circle`. House Voss is the stair fragment. `obsidian_palace`, `voss_estate`, `drake_aerie`, and the other Sundering `controlled_districts` stay in `not_layout`. The seven Sundering country discs stay on local metres.

### Tunya

| Layout | Tier | Uses | Road |
| --- | --- | --- | --- |
| `layout_tunya_masond` | town | government hold, agricultural landings, water river, residential homes | `terrace` citing `cross_tunya_masond`. Cliff face excluded. |
| `layout_tunya_sangree` | town | government forge, industrial ore face, commercial yard | `lane`. No new kilometres. |
| `layout_tunya_fluxom` | town | water lock, government hold, commercial trade | `wharf` citing `port_fluxom_lock`. |
| `layout_tunya_asbir` | village | industrial salt pan, residential shade | none. Wadi stays dry. |
| `layout_tunya_aekon` | hamlet | defense pocket | none. Ice is not water. |
| `layout_tunya_nil` | village | government listening grove | `lane` citing mode `saturated_canopy`. Foot only. `timber_road` false. |

`dist_masond_landings` is the only agricultural district. It cites `farm_masond_landings`. The river district cites `tunya_masond_river`, the one realized Tunya river.

`dist_sangree_forge` carries Unity id `sandrun_forge_quarter`. GoldenSlice remains the only crafting forge. `mine_sangree_ore` is one stack face, `quantity` null. `sandrun_arid_capital` and `sandrun_volcanic_coast` are not layouts. The countries.json forge pin stays local metres.

Fluxom Gate (62, 18) m is `tunya_local_metres` and is excluded from the lock wharf. The lock and `cap_tunya_fluxom` are the same hold. `adds_city` stays false.

Asbir cites `mine_asbir_salt` and is not a capital. Aekon has no seat and no mine. Nil has one district. `no_clearcut` holds. No housing subdivision.

`vrellan_capital_city` and the other unbound Tunya strings stay off the table.

### Frontier, Iron Coast, Dawn, Crucible

| Layout | Tier | Uses | Road |
| --- | --- | --- | --- |
| `layout_frontier_hitch` | village | commercial post, residential beds | `spine` citing `pass_frontier_drift`. |
| `layout_frontier_drift` | hamlet | commercial cottonwood marker | `lane` citing the same pass. `spans_river` false. |
| `layout_crime_sodium` | city | government block, commercial street, residential tenements | none inside the block. |
| `layout_crime_wharf` | town | water working river, commercial docks | `wharf` citing `port_crime_wharf`. |
| `layout_dawn_kane` | city | government fin, commercial street, residential towers, defense watch | none. |
| `layout_dawn_arterials` | village | commercial present streets | `lane` citing `node_bronx_arterials` in Present metres. |
| `layout_crucible_lattice` | village | industrial works, government unclosed seat | none. |
| `layout_crucible_foundry` | village | industrial scrap yard | `unfinished`. |

No Frontier capital. The cottonwood is not a town and not a bridge.

Iron Coast faction is `iron_rose_syndicate`. Wing Chun is culture, not a district. Tenements are not fields. Rain is not a flood district. The wharf’s water body is `crime_working_river`. `sea_crime_sere` and `waystone_crime_sere` are forbidden cites. The 24 km strait stays `border_crime_sere`. Not a second capital. Not a Link.

Dawn faction is `superhero_civic_super_taskforce`. Kane’s fin is the heart. No victory statue. `luminary_empire` is not the seat. Parks are not farms. The Dawn shore is not a port. Arterials are not a second city. `sea_crime_superhero` still excludes `dawn_kane` and `dawn_arterials`.

Crucible faction is `crucible_lattice_engineers`. `closed_capital` stays false. No ninth district. `central_crucible` and the other Crucible district strings stay in `not_layout`. The scrap yard cites `mine_crucible_scrap`, `quantity` null. `road_crucible_end` cites `seam_crucible_cyber` with `finished: false` and names `pass_crucible_road_end`. W06 put that pass id on `crucible_foundry`. W05 lists the same pass on `crucible_lattice`. This road cites both and edits neither. `march_crucible_cyber` stays off the pathfinder.

## Sere role sketches

`stamp_cells` is false. No polyline. No Link. `the_tally_house` on the old capital stays claim-plane. `port_sere_pier` stays `physicalize: false` and receives no wharf in this file.

| Sketch | Use | Holds |
| --- | --- | --- |
| `role_sere_old_capital` | government repair | Not a new court. |
| `role_sere_spire` | government stub | Hamlet. |
| `role_sere_furnace` | industrial shift | Not a mine. Not a capital. |
| `role_sere_breadlands` | none | `exhausted_not_breadbasket`. Forbidden retcon `fertile_heartland`. |
| `role_sere_drowned` | water stain | Not a harbor. |
| `role_sere_passes` | defense contested | Hamlet. |
| `role_sere_haven` | water platform | Resort forbidden. |
| `role_sere_highland` | defense high mark | Hamlet. |

`sere_flooded` and `sere_delta` have no sketch.

## Concord integration (extend, do not replace)

| Target | Today | What G5 names | Leave in place |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` `renderedElevationAt`, `generatePoughkeepsieHeightmap` | Hub/Poughkeepsie heightmap, seed `0xc0ffee`. | Layouts name regions and Hub canon metres. | Do not sample this heightmap for a street. Do not retune the seed. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow` | Local 4-neighbour flow. | Water districts cite body ids. | Do not call `setWater` from a district. Do not wet the plaza. The Masond river stays the one realized Tunya river. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs, Living Society `settlements` row, `MAX_NPCS_PER_REGION` 5, heartbeat `procgen-settlement-cycle` frequency 240. | A `layout_id` is not a spawn key. Districts are not NPC homes. | Do not raise the cap. Do not found a block from this table. `server/domains/procgen-settlements.js` stays the read surface. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | Stance machine, including `PROCLAIM_EXPANSION`. | A move target may be a `layout_id` or `district_id` already here. | Expansion does not add a district. No ninth Crucible district. No new faction. Hub territories stay empty. Domain file and `faction-strategy-cycle` follow the same rule. |
| `SettlementCompiler.Compile`, `IsHubHeartDistrict` | Plot compile. Four Hub heart ids. | Map those ids as listed above. `sandrun_forge_quarter` maps to `dist_sangree_forge`. | Do not call `Compile` from this spec. Do not parcel a `not_layout` name. |
| `WorldBook.DistrictsForCountry` | Copies `controlled_districts`. | This table is the filter. | Do not delete faction files. |
| `WorldGeography.BuildSettlements`, `SettlementTypeFor`, `PopulationFor` | Local-metre district pins. Population clamp 30–900. | Do not read that clamp as this census. | Do not move pins into veil kilometres. |

Procedural buildings and TreeLayer wait for G6. A district is not a mesh. Nil is not a timber source. The plaza takes no tree scatter.

## Outputs for later stages

Population may attach a headcount to an existing `district_id`. It may not add a district to spend that headcount. It may not read `populationBaseline` or a claim radius. Sere sketches take no kilometre census.

Economy may price a district that cites a W07 `site_id`, and may price `dist_hub_market` as import food with no local yield. It may not open a market on `port_sere_pier`. It may not price the breadlands.

Growth may set `parcel_count` only after a headcount exists. This file leaves it null. Growth may not invent a use.

Infrastructure may pave a road whose cited edge is already `finished`, or whose class is `ring`, `lane`, `terrace`, `wharf`, or `built_relief`. Class `unfinished` takes no pavement. No new edge ids.

G6 may mesh a district only after a later stage sets `physicalize` true.

## Aura / Cursor — what not to build yet

- No parcels, no street splines, no NavMesh, no building meshes, no foliage scatter.
- No edit to `world-terrain.js`, `terrain-water.js`, `procgen-settlements.js`, `faction-strategy.js`, `SettlementCompiler.cs`, `WorldBook.cs`, or `WorldGeography.cs`.
- No ninth Link, no Sere gate, no closed Crucible capital, no Hub kingdom, no layout whose id is the forbidden place-name.
