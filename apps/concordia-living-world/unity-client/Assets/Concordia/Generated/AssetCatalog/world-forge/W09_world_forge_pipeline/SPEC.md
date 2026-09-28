# W09 — World Forge pipeline

**Slice:** `W09_world_forge_pipeline`  
**Phase:** G6 bind contract. Population, prices, parcels, pavement, and meshes stay unwritten. `physicalize` stays false.  
**Batch:** `WF6_pipeline`  
**Machine file:** `SPEC.json` (`concordia-world-forge-pipeline/1.0`).  
**Consumes:** the canon graph, the field schema, and every authored geo and civ table from W02 through W08.

This file is the run order. It does not allocate the 2 km grid, does not write a W01 channel, and does not found a settlement. `spawnSettlementForRegion` still sprinkles 3–5 NPCs. A district is still a slot.

`world_id` Fantasy stays the Sundering. Flower Law stays a 42 m horizontal disk. Sere stays off `Canon.Gates`. The Crucible–Grid seam stays unfinished. The place-name forbidden by W00 is not a pipeline id. Pinewood Crossing is the only lettering of that Hub milepost.

## Bands

The sacred stage list is one sequence. The bands are how Aura and Cursor schedule that sequence. A later band reads the earlier band’s files. It does not redraw them.

| Band | Stages | Authored by | Product |
| --- | --- | --- | --- |
| Fields | Constraint graph, then the channel contract | W00, W01 | Ten worlds, frames, forbidden landforms, channel units |
| Geo | Elevation → Hydrology → Climate → Biome → Resources → Mobility | W02, W03, W04, W05 | Class bands, water bodies, cost graph |
| Civ | Suitability → Civ → layout slots | W06, W07, W08 | Region tiers, sites, districts, internal roads |
| Physical | Pop → Economy → Growth → Infra → Physicalization | Contract only, this slice | Headcount, price, parcels, pavement, then `physicalize` |
| Unity streaming | Consumer of a physicalized district | Live code already | `WorldStreamManager` jobs. No second streamer |

W04 stores Climate, Biome, and Resources in one spec. A runtime still applies them in that order. Rainfall does not redraw a channel. W02 stores slope and geology with elevation. Slope is derived from neighbours. Geology rides the landform. Neither is an extra stage.

W08 sits after Civ and before Pop. It names the district and road slots. It is not a skip of Population.

## Stage ledger

Counts below are copied from the slice that wrote them. This file does not re-score a region.

| Order | Stage | Slice | Schema | Writes | State |
| --- | --- | --- | --- | --- | --- |
| 0 | Canon | W00 | `concordia-world-forge-canon-graph/1.0` | Constraint graph, 10 worlds | Authored |
| 0b | Field contract | W01 | `concordia-world-forge-field/1.0` | Channel units. No cells | Authored |
| 1 | Elevation | W02 | `concordia-world-forge-continental/1.0` | `elevation`, `slope`, `geology` | Authored. `grid_materialized` false |
| 2 | Hydrology | W03 | `concordia-world-forge-hydrology/1.0` | `drainage`, `water` | Authored. Lakes 0 |
| 3 | Climate | W04 | `concordia-world-forge-biome-resource/1.0` | `temperature`, `rainfall`, `humidity` | Authored inside W04 |
| 4 | Biome | W04 | same | `biome`, `soil` | After climate |
| 5 | Resources | W04 | same | `resource`, `fertility` | `quantity` stays null |
| 6 | Mobility | W05 | `concordia-world-forge-transport/1.0` | `transport_cost_graph` | 31 edges |
| 7 | Suitability | W06 | `concordia-world-forge-suitability/1.0` | `settlement_suitability_table` | 44 regions |
| 8 | Civ | W07 | `concordia-world-forge-territory/1.0` | `territory_site_table` | 7 capitals, 10 borders, 3 mines, 1 farm, 4 ports, kingdoms minted 0 |
| 8b | Layout slots | W08 | `concordia-world-forge-settlement-layout/1.0` | `settlement_layout_table` | 28 layouts, 8 Sere role sketches, 57 districts, 20 roads, 1 agricultural district. `physicalize` false |
| 9 | Pop | — | contract in this file | `population` on an existing `district_id` | Unwritten |
| 10 | Economy | — | contract | `price` on an existing `site_id` or `dist_hub_market` | Unwritten |
| 11 | Growth | — | contract | `parcel_count` after a headcount | Unwritten. Stays null |
| 12 | Infra | — | contract | `paved` on a legal layout road | Unwritten |
| 13 | Physicalization | — | contract | `physicalize: true` on one district that already has parcels | Unwritten. Stays false |
| 14 | Unity streaming | — | consumer | A `WorldStreamManager` job for that district | Live scheduler. Forge does not enqueue yet |

W05 pathfinder exclusion `march_crucible_cyber` stays excluded. W06 cities are 4, plus 1 city-district fold, 5 towns, 17 villages, 10 hamlets, 7 `none`, 8 `cannot_found`. W08 refused pads stay refused: `ruins_envoy_claim`, `tunya_fallback`, `tunya_unplaced`, `frontier_last_dome_unplaced`, `dawn_crown_stair_glue`, `sere_flooded`, `sere_delta`. `hub_doors` stays folded into `layout_hub_court`.

## One legal run

A future executor walks this list once per continent. Each step reads the previous step’s file. No step samples `renderedElevationAt` to invent a continental height.

1. Load W00. Keep null coordinates null. Keep Sere off the gate list. Keep Hub territories empty.
2. Load W01 units. Continental heights are metres above the Inner Veil. Hub walk heights are metres above the court. The two are not added.
3. Apply W02 class bands. Leave the 2 km grid unallocated.
4. Apply W03 bodies. A forbidden water kind is an error. The civic drain on the plaza stays kind `none`. The Masond river stays the one realized Tunya river.
5. Apply W04 climate bands, then biome, then resources. Resource quantity stays null.
6. Apply W05 edges. Publish no new minutes. Add no chord on `edge_cyber_crime`. Leave `seam_crucible_cyber` unfinished.
7. Apply W06 tiers. Do not rescore.
8. Apply W07 sites. `kingdom` stays false. A port does not add a city. `port_sere_pier` stays `physicalize: false`.
9. Apply W08 districts and internal roads. Do not add a use. Agricultural use stays `dist_masond_landings` citing `farm_masond_landings`.
10. Stop. Pop, Economy, Growth, Infra, and Physicalization have inputs and no rows.

## Contracts for the unwritten stages

These are the only writes those stages are allowed, once a later slice fills them. This slice fills none of them.

**Pop.** Attach a headcount to a `district_id` that already exists on a layout whose W06 tier is hamlet or above and whose `cannot_found` is false. Sere role sketches take no kilometre census. `WorldGeography.PopulationFor` (clamp 30–900) is a local-metre pin, not this census. A claim radius is not a headcount. Pop may not add a district to spend the people.

**Economy.** Price a district that cites a W07 `site_id`. Price `dist_hub_market` as import food with no local yield. Leave `port_sere_pier` unpriced while `physicalize` is false. Leave the breadlands unpriced (`exhausted_not_breadbasket`). Quantity on `mine_sangree_ore`, `mine_asbir_salt`, and `mine_crucible_scrap` stays null until a later slice has a sourced number. This file does not invent one.

**Growth.** Set `parcel_count` only on a district that already has a headcount. Leave it null until then. Growth may not invent a use, a farm, or a mine.

**Infra.** Set `paved` true only on a W08 road whose class is `ring`, `lane`, `terrace`, `wharf`, or `built_relief`, or whose cited W05 edge is already `finished`. Class `unfinished` takes no pavement. `road_crucible_end` cites `seam_crucible_cyber` and stays unpaved. Infra adds no edge id.

**Physicalization.** Set `physicalize` true only after that district has a headcount and a `parcel_count`. Mesh ids, when a later pilot names them, come from batches already in the asset catalog. Physicalization does not author a new prompt row. It does not call `SettlementCompiler.Compile`.

## Living feedback loop

The loop runs only after the first physicalization row exists. Until then the live heartbeats keep their current jobs. Frequencies are the ones registered in `server/server.js`. This slice does not retune them.

| Tick | Frequency | What it already does | What a later forge pass may add |
| --- | --- | --- | --- |
| `npc-economy-cycle` | 8 | `dispatchEconomicAction` for gather, craft, trade, rest. Refreshes `regional_scarcity`. Kill-switch `CONCORD_NPC_ECONOMY=0`. | A price key that is an existing `site_id` or `dist_hub_market`. |
| `procgen-settlement-cycle` | 240 | `spawnSettlementForRegion`, 3–5 NPCs, `MAX_NPCS_PER_REGION` 5. | A filter on an existing `layout_id`. The cap stays 5. A layout is not a spawn key today. |
| `faction-strategy-cycle` | 200 | `pickMove`, `applyMove`. Stances include `PROCLAIM_EXPANSION`. | A move target that is an existing `layout_id` or `district_id`. Expansion adds no district and no kingdom. |
| `economy-anomaly-cycle` | 240, scope `global` | Observe-only pathology counter. Kill-switch `CONCORD_ECON_ANOMALY=0`. | Nothing. It does not price a district and does not mint coin. |

One closed pass, when those rows exist:

1. The strategy tick and the NPC economy tick read the current site, district, and scarcity tables.
2. Pop writes a headcount on a district that is already in W08.
3. Economy writes a price on a site that is already in W07, or on the Hub market import.
4. Growth writes `parcel_count` where a headcount now exists.
5. Infra writes `paved` where the road rule above already allows it.
6. Physicalization flips `physicalize` on that district alone.
7. Streaming enqueues that district. See below.
8. The field channels stay as W02–W04 left them. A building does not change continental elevation. A farm does not change biome class. Rainfall does not redraw drainage. `setWater` stays the play-patch writer in `terrain-water.js` and does not add a W03 body. `terrain-deformation.js` stays inside the 0–80 m play-patch clamp and is not added to veil datum.

`no_clearcut` on `tunya_nil` and `tunya_fallback` still holds. Nil is not a timber source. The plaza takes no tree scatter.

## Unity streaming

The scheduler that already exists is the consumer.

- `WorldStreamManager` (`Assets/Concordia/Scripts/WorldStreamManager.cs`) is the single queue. Workers enqueue. They do not run a second loop. Default `CellMeters` is 64. `BudgetMs` is 3.5. `PrefetchAheadM` is 120. This slice does not retune those fields.
- Cell kinds already in the enum: `Settlement`, `Road`, `Wilderness`, `Interior`, `Impostor`, `NavChunk`, `Systems`.
- Bands already in the enum: `Visual`, `Abstract`, `Simulation`, `Full`. A forge district with `physicalize` false is data at most (`Abstract`). `Full` is legal only after `physicalize` is true and the player is inside the existing stream window.
- `ContinentStream` remains the travel authority. `TravelMode` is `continent_stream`. `SoftEnter` is the world enter. Radii already shipped: stream-in 175 m, stream-out 360 m, L3 near 55 m, chunk radius 52 m, Hub keep 125 m.
- `WorldField` presents the kernel sample. `CivilizationRadiusKm` is 400. `HubCourtKm` is 12. `HubMetroKm` is 40. Those match the W00 authored court and metro kilometres. `SceneMetresToKm` is 0.4. W00 also records `present_metres_per_km` 0.55 for the jog. Both numbers stay as published. This slice does not pick a replacement.
- `WorldField.GateAngle` puts Fantasy at π/2. Sere is offset from the Crime angle, outside the ring, and is still not a gate.
- `MegaworldMap.PresentToKm` is the live conversion when `ContinentStream.Live` is set. Layout coordinates in hub canon metres stay hub canon metres.

`SettlementCompiler.Compile`, `CompileOne`, `CompileRoadsOnly`, and `DressBuilding` stay the Unity building path. `IsHubHeartDistrict` still recognizes the four Hub heart ids W08 already mapped. `createBuilding` in `concord-frontend/lib/world-lens/procedural-buildings.ts` stays the web silhouette path. `TreeLayer` stays the web flora mount. A later physicalization row may pass an existing biome id into `TreeLayer`. It may not scatter the 42 m disk. Neither compiler runs from this spec.

## ORGANIC and Aura bind order

Mesh generation stays `asset-catalog/ORGANIC_FEED_ORDER.md`. That order is unchanged: lookfeel heroes and landmarks, then B23 through B31 as already queued. World Forge does not re-prompt those rows and does not append `PROMPTS_INDEX`.

Cursor and Aura code order, after this contract and still not in this slice:

1. A read-only loader for W00–W08 JSON beside the live modules. No write into `renderedElevationAt`.
2. Geo apply in stage order, region class bands only, grid still unallocated.
3. Civ apply: suitability, then sites, then layouts. Caps and refusals copied, not recomputed.
4. The four unwritten table stages, in order, on one pilot place. W10 is the Sangree trace. W11 is the Hub degrade into the existing heightmap and local water. Both are later slices. Both stay text until their own reports. A pilot may not set continent-wide `physicalize`.
5. One streaming enqueue, and only for a district whose `physicalize` the pilot set true, through `WorldStreamManager`.
6. Mesh bind from a catalog id that already exists. Sangree’s forge district is `dist_sangree_forge` (`sandrun_forge_quarter`). GoldenSlice remains the only crafting forge. `mine_sangree_ore` quantity stays null in this file. Hub’s court rings stay 42 m and 34 m. The wall stays 56 m. Arena sand stays (0, 18) radius 8, steel live, inside the disk. Pinewood stays (62, −28).

## Concord integration (extend, do not replace)

| Target | Today | What this contract names | Leave in place |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` `renderedElevationAt`, `generatePoughkeepsieHeightmap` | Hub/Poughkeepsie heightmap, seed `0xc0ffee`, size 2000 m, max 80 m. | Walk surface inside hub canon metres. Continental bands stay labels. | Do not add veil metres to the height sample. Do not retune the seed. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow` | Local 4-neighbour flow. | Play-patch water. W03 ids are the continental bodies. | Do not `setWater` the plaza. Do not add a body from a district. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs. Heartbeat frequency 240. | Later filter only. | Cap stays 5. Domain file stays the read surface. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | Stance machine. Heartbeat frequency 200. | Later target may be a `layout_id`. | Expansion adds no district. No new faction file. |
| `server/lib/npc-economy.js` `dispatchEconomicAction` | Live workplace actions. Heartbeat frequency 8. | Later price key is an existing site. | Do not replace the heartbeat. |
| `SettlementCompiler` | Plot compile. | Maps W08 Hub heart ids when `physicalize` is true. | Do not call `Compile` from this spec. |
| `createBuilding` | Web procedural silhouette. | Same gate: `physicalize` true. | Do not generate a new kit here. |
| `TreeLayer` | Biome trees on a ready scene. | Biome string from W04 after physicalization. | Plaza stays clear. Nil is not timber. |
| `ContinentStream.SoftEnter`, `WorldStreamManager` | Live travel and the job queue. | The only streaming bind. | Do not add a parallel streamer. Do not retune radii. |
| `WorldField`, `WorldBook.DistrictsForCountry`, `WorldGeography.BuildSettlements` | Presentation, claim-plane district strings, local-metre pins. | W08 remains the layout filter. | Do not move claim pins into veil kilometres. |

## What not to build yet

- No population table, no prices, no `parcel_count`, no pavement, no `physicalize: true`.
- No 2 km raster, no NavMesh, no street spline, no border mesh, no building mesh, no foliage scatter, no image.
- No edit to `world-terrain.js`, `terrain-water.js`, `terrain-deformation.js`, `procgen-settlements.js`, `faction-strategy.js`, `npc-economy.js`, `SettlementCompiler.cs`, `WorldBook.cs`, `WorldGeography.cs`, `ContinentStream.cs`, `WorldStreamManager.cs`, `WorldField.cs`, or `MegaworldMap.cs`.
- No new `PROMPTS_INDEX` row and no redo of batches B19–B31.
- No ninth Link, no Sere gate, no closed Crucible capital, no Hub kingdom, no kingdom minted, no layout whose id is the forbidden place-name.
- No retune of Flower Law, of seed `0xc0ffee`, of heartbeat frequencies, or of `MAX_NPCS_PER_REGION`.
- W10 and W11 are the next slices. This file does not write their pilots.

## Next

`W10_tunya_sangree_pilot` traces one town, `layout_tunya_sangree`, through this order and may name a bill of materials. `W11_hub_court_pilot` traces `layout_hub_court` and states how veil bands degrade into `renderedElevationAt` and `terrain-water.js`. Both inherit `physicalize` false until their own stage rules are satisfied in those files.
