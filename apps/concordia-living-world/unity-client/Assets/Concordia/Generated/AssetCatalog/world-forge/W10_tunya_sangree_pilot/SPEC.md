# W10 — Sangree pilot (Tunya)

**Slice:** `W10_tunya_sangree_pilot`  
**Phase:** pilot. One town, `layout_tunya_sangree`, walked in pipeline order.  
**Batch:** `WF_pilot_sangree`  
**Machine file:** `SPEC.json` (`concordia-world-forge-sangree-pilot/1.0`).  
**Consumes:** W00 through W09. This file does not rescore a region, add an edge, add a district, or allocate the 2 km grid.

`world_id` Fantasy stays the Sundering. Flower Law stays a 42 m horizontal disk on the Hub. Steel stays live on Tunya ground. A blade carried onto the Hub plaza, outside the Arena, is a flower. Sere stays off `Canon.Gates`. GoldenSlice remains the only forge that crafts. The Sangree stack is the yard. `sandrun_sanguire` holds the seat. Sandrun’s arid capital and volcanic coast stay off the layout list. `extends_world` labels stay labels.

The countries.json pin “Sangree Fire Forge” at local metres (−4.43, −65.85), radius 28 m, stays on the claim plane. The sector anchor is the design-intent offset (+55, +10) km from the Tunya center (−282.84, +282.84) km, which places the sector at (−227.84, +292.84) km. Offset distance from the Tunya center is 55.9 km, inside the 110 km disc. The two frames are not added.

## Stage trace

Each row copies the earlier slice. Pop through Physicalization are the first filled rows, and they apply only to this layout.

| Order | Stage | Inherited record | Pilot write |
| --- | --- | --- | --- |
| 0 | Canon | W00 `tunya_sangree`. Stack yard, blackened stone, terrace runnel, `sangree_ore` quantity null, bias ordinal `works` relative 0.65. | None |
| 0b | Field | W01 exemplar `Tunya:tunya_sangree`. Veil datum. Slope `moderate`, rise/run max 0.18. | None |
| 1 | Elevation | W02 class `stack_yard`, 200–450 m above the Inner Veil. | None. `renderedElevationAt` is not sampled. |
| 2 | Hydrology | W03 `tunya_sangree_runnel`. Kind `runnel`, outlet `dry_end`, accumulation `local_only`, depth 0.05–0.3 m, seed depth 0.05 m, max trace cells 3. | None. The forge is not a water district. |
| 3 | Climate | W04 mean 16–24 °C, plus 8 °C on one face of the stack. Rain 500–800 mm. Humidity 0.35–0.55. | None |
| 4 | Biome | `forge_scrub`, soil `ash_and_scree`, flora budget “scrub burned on one face”, density 0.10–0.22, spawn `suppress`. | None |
| 5 | Resources | `sangree_ore` only. Fertility 0.20, class `scrub`. Quantity null. | Quantity stays null. |
| 6 | Mobility | No W05 edge terminates on this sector. Disc edges that touch Tunya stay `gate_hub_tunya`, `road_hub_tunya`, `march_fantasy_tunya`, `walk_tunya_frontier`, `sea_tunya_fantasy`. W08 road is `road_sangree_yard`, class `lane`, `cites_edge` null, `length_km` null. | No new edge. No new minutes. Length stays null. |
| 7 | Suitability | W06 `raw` 0.484, tier `town`, ordinal `works`, `cannot_found` false, type `forge`, holder `verdant_veil`, forge authority GoldenSlice. | Checked, not recomputed. See the sum below. |
| 8 | Civ | W07 `cap_tunya_sangree` (town, `kingdom` false, faction `sandrun_sanguire`) and `mine_sangree_ore`. `border_tunya_terrace` has no coordinates. Farms on this region: none. The continent’s one farm remains `farm_masond_landings`. | No kingdom. No second mine. No farm site. |
| 8b | Layout | W08 three districts under cap 4: `dist_sangree_forge` (`sandrun_forge_quarter`), `dist_sangree_ore`, `dist_sangree_yard_trade`. Forbidden uses `agricultural` and `water`. | Slots unchanged. |
| 9 | Pop | Contract in W09. | Design-intent headcount 260, split 104 / 91 / 65. |
| 10 | Economy | Contract in W09. | Sites named. Concord Coin stays null. Quantity stays null. |
| 11 | Growth | Contract in W09. | Design-intent parcels 5 / 4 / 3, layout sum 12. |
| 12 | Infra | Contract in W09. | `road_sangree_yard.paved` true. |
| 13 | Physicalization | Contract in W09. | `physicalize` true on this layout and its three districts only. |
| 14 | Unity streaming | `WorldStreamManager` already queues. | Job described. This file does not enqueue. |

### Suitability check

Copied axes: water 0.30, food_effective 0.20, trade 0.55, resources 0.80, terrain 0.55, defense 0.45, transport 0.50, faction 0.70.

```
0.16*0.30 + 0.14*0.20 + 0.14*0.55 + 0.10*0.80
+ 0.12*0.55 + 0.10*0.45 + 0.14*0.50 + 0.10*0.70
= 0.484
```

Trade 0.55 is below the 0.70 import-substitution gate, and ordinal `works` is outside that gate’s ordinal set, so food stays 0.20. Ordinal ceiling is town unless raw is at least 0.72. 0.484 clears the town threshold 0.48 and stays a town. `verdant_veil` is the suitability holder. `sandrun_sanguire` is the capital faction. Both stand.

## Pop

Design-intent census for this pilot, authority `design_intent_pilot`. It is not `WorldGeography.PopulationFor` (that clamp, 30–900, is a local-metre pin). It is not the 28 m claim radius. It is not a spawn count.

Rule: reference town 400 × W00 relative bias 0.65 = 260. District weights, summing to 1, applied to the three districts that already exist: forge hold 0.40, ore face 0.35, yard trade 0.25.

| District | People |
| --- | --- |
| `dist_sangree_forge` | 104 |
| `dist_sangree_ore` | 91 |
| `dist_sangree_yard_trade` | 65 |
| Layout | 260 |

`spawnSettlementForRegion` still sprinkles 3–5 NPCs. `MAX_NPCS_PER_REGION` stays 5. The 260 are the sector census the later economy tick may read. They are not 260 bodies.

## Farms

The farm stage runs and emits an empty list for Sangree.

`forbidden_uses` includes `agricultural`. Fertility 0.20 is scrub. W07’s single farm is `farm_masond_landings` on `tunya_masond`. Food for this town is a dependency across `border_tunya_terrace`, which still has no kilometres and no new edge. `flora_tunya_terrace_tree` and `npc_role_tunya_labor` stay on terrace fruit work. They are not placed on the ore face. Nil stays a listening grove and is not cut for this yard.

## Economy

Concord Coin is null on every Sangree row. No ledger price was read, and ore quantity is still null, so a coin figure would be an assay this pilot does not have. Ranks are mention order for a later `npc-economy-cycle` key. They are not prices.

| Key | District | Coin | Quantity | Note |
| --- | --- | --- | --- | --- |
| `mine_sangree_ore` | `dist_sangree_ore` | null | null | One stack face. Rank 1. |
| `cap_tunya_sangree` | `dist_sangree_forge` | null | — | Bound by role `forge_hold`. The seat does not price a second crafting forge. Rank 2. |
| — | `dist_sangree_yard_trade` | null | — | Cites no W07 `site_id`, so the contract leaves it unpriced. |

`port_sere_pier`, the breadlands, `mine_asbir_salt`, and `mine_crucible_scrap` are outside this pilot.

## Growth

Design-intent parcel rule, after the headcount exists: `floor(people / 20)`, minimum 1. Growth adds no use, no farm, and no district.

| District | Parcels |
| --- | --- |
| `dist_sangree_forge` | 5 |
| `dist_sangree_ore` | 4 |
| `dist_sangree_yard_trade` | 3 |
| Layout | 12 |

## Infra

`road_sangree_yard` is class `lane`, so W09 allows pavement. `paved` is true. `length_km` stays null. `cites_edge` stays null. Disc edges that are already `finished` are not repaved here and are not snapped onto the stack. Class `unfinished` does not appear on this layout. `road_crucible_end` is untouched.

## Physicalization

`physicalize` is true on `layout_tunya_sangree`, on its three districts, and on `cap_tunya_sangree` and `mine_sangree_ore`, because each of those districts now has a headcount and a parcel count. Every other layout in W08 stays `physicalize` false. Continent-wide physicalization stays false. The 2 km grid stays unallocated. `SettlementCompiler.Compile` is not called. `createBuilding` is not called. `TreeLayer` is not mounted by this file. A later binder may pass biome `forge_scrub` into `TreeLayer` for the unburned faces. The burned face takes zero scrub. The Hub 42 m disk is not a Tunya scatter target.

Field channels stay as W02–W04 left them. The stack mesh does not change the 200–450 m band. The runnel does not become a lake. `setWater` stays the play-patch writer and does not add `tunya_sangree_runnel` as a second body.

## Bill of materials

Existing catalog ids only. `prompts_index_rows_added` is 0. ORGANIC feed order is unchanged. Instance counts below are design-intent placement, not generated meshes.

| Where | Id | Count | Why this id |
| --- | --- | --- | --- |
| `dist_sangree_forge` | `env_tunya_sangree_stack` | 1 | The one stack, 9 m, soot mouth, short ore trough. |
| `dist_sangree_ore` | same stack | 0 extra | The trough is the mine mouth. A second stack would be a second mine. |
| `dist_sangree_forge` | `arch_hero_tunya_terrace_hall` | 1 | Existing Tunya hall and parent of the interior kit. Government room beside the stack. |
| Hall interior | `arch_int_tunya_terrace_floor`, `arch_int_tunya_wood_ceiling`, `arch_int_tunya_shutter_leaf`, `arch_int_tunya_terrace_stair`, `arch_int_tunya_hold_sconce`, `arch_int_tunya_door_leaf`, `arch_int_tunya_solar_tile` | 1 each | Kit `arch_kit_tunya_veil`, batch `B24_arch_tunya`. |
| Hall interior, kit-present and unused on this seat | `arch_int_tunya_seed_table`, `arch_int_tunya_dye_shelf` | 0 | Seed and dye belong to terrace and harbor work. They stay in the kit file. |
| Runnel trace | `env_tunya_terrace_lip` | 1 | Limestone lip and runnel module for `tunya_sangree_runnel`. Fruit on that lip’s lore stays on `flora_tunya_terrace_tree`, which is not instanced here. |
| Unburned scrub | `flora_tunya_ash_scrub` | density band 0.10–0.22 | One face of the stack has zero instances. Spawn of creatures stays `suppress`. |
| Yard cloth for the 3–5 sprinkle | `npc_terrace_outfit_solar_square`, `npc_terrace_face_cx_pollen`, `npc_terrace_fac_solar_tab` | sprinkle only | CX body, Concordia face. Capoeira stays on `npc_role_tunya_labor`, who is not moved onto the ore face. |
| Unity district id | `sandrun_forge_quarter` | map | Already the W08 alias of `dist_sangree_forge`. |

`WorldStreamManager` remains the only queue. A later enqueue, after this pilot and only while the player is inside the existing stream window, may submit cell kind `Settlement` for the three districts and cell kind `Road` for `road_sangree_yard`, band `Full`. `CellMeters` 64, `BudgetMs` 3.5, and `PrefetchAheadM` 120 stay as shipped. This file does not submit the job.

## Concord integration (extend, do not replace)

| Target | What the pilot names | Leave in place |
| --- | --- | --- |
| `server/lib/world-terrain.js` `renderedElevationAt` | Walk surface. Sangree’s 200–450 m is a veil-datum class band. | Seed `0xc0ffee`, 2000 m patch, 80 m max. Do not add veil metres into the sample. |
| `server/lib/terrain-water.js` `setWater`, `solveFlowStep` | Play-patch flow. Continental body id is `tunya_sangree_runnel`. | Do not seed the plaza. Do not add a lake. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | Later filter may require `layout_tunya_sangree`. | Cap stays 5. Heartbeat frequency 240. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | A later move target may be this `layout_id`. | Expansion adds no district and no kingdom. Frequency 200. |
| `server/lib/npc-economy.js` `dispatchEconomicAction` | Later price key may be `mine_sangree_ore` or `cap_tunya_sangree`. | Coin stays null until a ledger row exists. Frequency 8. Quantity stays null. |
| `SettlementCompiler` | `sandrun_forge_quarter` maps to `dist_sangree_forge` when a binder runs. | Do not call `Compile` from this spec. |
| `createBuilding` | Web silhouette is legal only after the physicalize flag this file sets. | Do not generate a kit. |
| `TreeLayer` | Biome string `forge_scrub` after a binder mounts the district. | Burned face stays clear of scrub. |
| `WorldStreamManager`, `ContinentStream` | The only streaming bind. | Radii and budgets unchanged. |

No file in that table is edited by this slice.

## What this pilot leaves unbuilt

- No 2 km raster, no NavMesh, no street spline, no border mesh, no new prompt row, no image.
- No assayed ore quantity and no Concord Coin price.
- No farm site, no fourth district, no second stack, no kingdom.
- No edit to terrain, water, settlement, faction, economy, compiler, or streaming source.
- W11 remains the Hub court degrade into `renderedElevationAt` and `terrain-water.js`. This file does not write it.

## Living loop

The heartbeats stay at their registered frequencies. This pilot supplies the first Sangree rows they may read later: headcount on the three districts, null coin on the two sites, parcel counts, pavement on `road_sangree_yard`, and `physicalize` true on this layout alone. A building still does not change continental elevation. Rainfall still does not redraw the runnel. `economy-anomaly-cycle` stays observe-only.
