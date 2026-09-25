# W06 — Settlement suitability solver

**Slice:** `W06_settlement_suitability`  
**Phase:** G4b (suitability only). Territory polygons, capitals as political objects, and faction borders wait for civ.  
**Batch:** `WF4_suitability`  
**Machine file:** `SPEC.json` (`concordia-world-forge-suitability/1.0`).  
**Consumes:** `concordia-world-forge-transport/1.0`, biome-resource, hydrology, continental, field schema, canon graph.

Pipeline order places suitability after mobility and before civilization. This stage scores **named W00 regions**. It does not allocate the 2 km grid, does not write a W01 field channel, and does not found a settlement.

A high score is a label. `spawnSettlementForRegion` still waits for a later bind. A two-minute plaque does not mint a city. A fertile cell does not mint a town. A port node already on the graph does not add a second harbor.

`world_id` Fantasy stays the Sundering. Flower Law stays a 42 m horizontal disk. Sere stays off `Canon.Gates`. The Crucible–Grid seam stays unfinished. The place-name forbidden by W00 `no_vinewood` is not a settlement id.

## What this stage is

Geography has already said where land, water, weather, deposits, and routes are. Suitability answers: **how livable is each named pad, and which village / town / city tier may sit on it.**

The product is a table of 44 region rows:

- Eight axes (water, food, trade, resources, terrain, defense, transport, faction) on `[0, 1]`.
- A weighted sum, then vetoes and ordinal caps from the canon graph.
- A tier in `{city, city_district, town, village, hamlet, none}`.
- A Unity `type_hint` that already exists on `WorldGeography.SettlementTypeFor` (`court`, `port`, `forge`, `hold`, `mining`, `borough`, `archive`, `village`, `works`, plus `hamlet` / `none` / `city_district` for pads that function never named).

Hub remains one city-state. Its rings are districts, not extra cities. Claim-plane circles in `countries.json` stay politics. Unplaced names stay `coordinates: null`. Resource `quantity` stays null. Population numbers here are ordinals, not a census.

## Inputs from prior stages

| Axis | Reads | Does not |
| --- | --- | --- |
| Water | W00 `water_dependency`, W03 `water.kind` / `body_id`, W04 `channel_carry` | Call `setWater`. Treat a wet carry label as a river. Wet the plaza. Use the 24 km strait as `crime_working_river`. |
| Food | W04 `fertility_0_1`, `fertility_class`, `suitability_cap`, `veto` | Farm Nil. Retcon Sere breadlands. Treat silt cells as a breadbasket. |
| Trade | W00 `trade_nodes`, W05 pathfinder edges that **touch** the region | Convert plaque minutes into 400 km of commerce. Promote `edge_cyber_crime` to a chord. |
| Resources | W04 locus **presence** on that `region_id` | Invent a deposit. Set tonnage. |
| Terrain | W02 slope class / built relief, W01 class breaks | Pathfind on the Poughkeepsie grid. Retune seed `0xc0ffee`. |
| Defense | Terrain affinity (wall, cliff, stacks, fault) plus Hub wall metres | Spawn an army. Give Hub a kingdom. |
| Transport | W05 `weight_minutes`, `pathfinder_use`, `finished`, named crossings | Treat a low minute count as a city. Pave `seam_crucible_cyber`. Dijkstra a ninth spoke. |
| Faction | Authored holders already in native-bible / `WorldGeography` / `faction-strategy` | Mint a kingdom from noise. Fill `WorldGeography.Territories(Hub)`. |

`stamp_cells: false` regions (every Sere row, `tunya_fallback`, `tunya_unplaced`, `frontier_last_dome_unplaced`, `ruins_envoy_claim`, `dawn_crown_stair_glue`) still receive a **role** score. They do not receive a kilometre city.

## Algorithm

Run in this order. No step writes elevation, water, biome, fertility, or an atlas edge.

1. **Inherit the region.** Copy `region_id`, `world_id`, `population_bias`, trade nodes, `stamp_cells`, and any W04 `suitability_cap` / `veto`.
2. **Score eight axes** with the closed maps in `SPEC.json` `axis_maps`. Each map is design-intent. A binder that substitutes a second formula has left the spec.
3. **Import substitution for food.** If `trade >= 0.70` and the ordinal is one of `plaza_peak`, `ring_dense`, `block`, `pedestrian_roof_transit`, set `food_effective = max(food, 0.55)`. The city eats from the graph, not from plaza loam. This substitution is forbidden on `tunya_nil`, on any Sere row, on `sere_breadlands` especially, and wherever `veto` is `no_clearcut`.
4. **Weighted sum.**

```
raw = 0.16*water + 0.14*food_effective + 0.14*trade
    + 0.10*resources + 0.12*terrain + 0.10*defense
    + 0.14*transport + 0.10*faction
```

Weights are design-intent and sum to 1.00.

5. **Veto.** If a veto fires, keep `raw` for audit and set `cannot_found: true`. Founding a Living Society row on that pad is illegal even if `raw` looks like a village.
6. **Ordinal cap.** `population_bias.ordinal` is a ceiling, not a bonus.

| Ordinals | Maximum tier |
| --- | --- |
| `plaza_peak`, `ring_dense`, `block`, `pedestrian_roof_transit` | city, and city also requires the city threshold |
| `harbor`, `quiet_forum`, `works`, `terrace_road` | town, unless `raw >= 0.72` (then city is legal) |
| `service`, `shade`, `track`, `crossing`, `thinned`, `march`, `post`, `pocket`, `sparse`, `stub`, `platform`, `contested`, `grove_quiet` | town |
| `road_verge`, `empty_road`, `empty_then_post`, `almost_empty`, `few`, `thin`, `exhausted`, `shift` | village |
| `claim`, `claim_plane`, `unplaced`, `unsurveyed`, `almost_nothing` | none |

`shift` on `sere_furnace` is a work crew, not a capital. `exhausted` on `sere_old_capital` is repair, not a new court.

7. **Thresholds** (design-intent), applied after the cap:

| Tier | `raw` |
| --- | --- |
| city | `>= 0.72`, or `>= 0.66` when the ordinal is in the city set |
| town | `>= 0.48` |
| village | `>= 0.30` |
| hamlet | `>= 0.16` |
| none | below that, or `cannot_found`, or ordinal none |

8. **Parent city.** `hub_doors` is `city_district` of `hub_plaza`. It does not found a second Hub city. `hub_wall` stays a defense village on the 56 m band.
9. **Do not emit a cell raster.** When a grid exists later, a cell inherits its region row. Unstamped cells stay `none`.

Impassable or vetoed founding stores `cannot_found: true` and `tier` as listed. It does not store a sentinel score of 0 when the audit sum is real.

## Vetoes (founding)

Closed list. A later civ slice may attach a faction to a vetoed pad for story; it may not found a town there.

| Id | Regions | Effect |
| --- | --- | --- |
| `flower_law_not_a_farm` | `hub_plaza`, `hub_doors` | Food stays paved. Import substitution is the only food path. No tree scatter, no river capital. |
| `no_clearcut` | `tunya_nil`, `tunya_fallback` | Food usable for settlement farming clamps to 0.25. No timber road. Nil stays a listening grove. |
| `listening_grove` | `tunya_nil` | Cap `suitability_cap`. Village maximum. |
| `landings_only` | `tunya_masond` | Fertility and terrain apply to terrace landings. The cliff face is not a city slab. |
| `ice_spell_false` | `tunya_aekon` | Ice is not a liquid water score. Pocket warmth is not a city. |
| `no_port_city_from_node` | `cyber_wharf_march`, `node_sere_delta`, Fluxom lock as extra city | The node already on W05 does not add a city. |
| `adds_city_false` | every W05 port record | Same rule. |
| `low_minutes_are_not_a_city` | any plaque (2 min) | Access is `transport`/`trade` credit, not a tier jump. |
| `seam_unfinished` | `crucible_foundry`, `cyber_stacks` (seam side) | `seam_crucible_cyber` stays `finished: false`. Transport credit 0.20 for that mode. |
| `no_ninth_district` | Crucible | City illegal. Closed capital illegal. |
| `catalogue_not_conquer` | `ruins_forum` | Archive town. Not a conquest capital. |
| `no_victory_heart` | `dawn_kane` | Kane’s fin is the tall read. No victory statue as the heart. |
| `drowned` | `sere_flooded` | `cannot_found`. |
| `no_new_beauty` | `sere_delta` | `cannot_found`. Silt is not a new city. |
| `exhausted_not_breadbasket` | `sere_breadlands` | Forbidden retcon `fertile_heartland`. |
| `no_resort` | `sere_haven` | Platform village. Not a resort. |
| `no_link_sere` | every Sere row | No plaque. No Flower Law. Waystone is a mark. |
| `do_not_lift_to_kilometres` | `ruins_envoy_claim`, Tunya country pins, Sere Tally House | Claim plane. |
| `unplaced` | `tunya_unplaced`, `frontier_last_dome_unplaced`, unplaced Tunya names | `tier: none`. Last Dome stays a mile of prose. |
| `glue_not_a_border` | `dawn_crown_stair_glue` | Not a shared land border with the Sundering. |
| `no_vinewood` | all | No region, settlement, or kit of that name. |
| `cottonwood_is_not_a_town` | `frontier_drift` | Marker on former water. |
| `house_voss_is_a_stair` | `sunder_fold` | Not a flying castle. |

## Axis maps (design-intent)

**Water** from W03 kind (and W00 mode when kind is absent):

| Kind / mode | Score |
| --- | --- |
| `river`, `harbor_canal` | 0.88–0.90 |
| `harbor_meet`, `drainage_meets_harbor` | 0.55–0.60 |
| `civic_drain` | 0.55 (piped; not a river) |
| `alley_drain` | 0.50 |
| `canopy_basin` | 0.70 |
| `waterfall_shelf`, `spout`, `short_run` | 0.35–0.40 |
| `reed_flood`, `flood_sheet`, `tide_stain` | 0.80–0.85 (then likely veto) |
| `ice`, `steam` | 0.15–0.25 |
| `none` / ephemeral / dry salt | 0.20–0.22 |
| `reflection` / trench | 0.45 |

**Food** is W04 `fertility_0_1` unless import substitution or a cap replaces it.

**Trade** is a closed sum, capped at 1.0: 0.25 per civic-heart node, 0.12 per finished pathfinder mode that touches the region, 0.15 if a Link plaque stands on that world (access, not kilometres), 0.05 if the only extra mode is the unfinished seam.

**Resources** from locus count on that region: none 0, one 0.45, two 0.70. Salvage / scrap / brick sit at 0.50 even with one locus. Ore / dye sit at 0.75. Lichen under `no_clearcut` sits at 0.20. Presence only.

**Terrain** from slope / relief: `near_level` 0.90, `gentle` 0.75, `moderate` 0.55, `steep` 0.30, `cliff` 0.15 (Masond landings 0.50), Grid stacks built relief 0.80–0.85, ice 0.10, drowned 0.20.

**Defense:** plaza inside the 56 m wall 0.80, wall band 0.85, stacks 0.70–0.75, cliff / alpine 0.70–0.75, lattice fault 0.55, open Frontier flats 0.20, flood 0.15, forum 0.40.

**Transport:** finished Crown Road 0.70–0.85, ring march 0.65, walker 0.40, barge / harbor 0.80–0.90, Crime–Sere strait 0.55 (96 minutes, not a Link), waystone 0.25, unfinished seam 0.20, plaque access 0.30 extra and never a substitute for the Crown Road under it. Parallel modes take the minimum of legal modes; they are not added. `march_crucible_cyber` stays off the pathfinder.

**Faction** is occupancy by an **already authored** holder:

| Holder | Where it may weight |
| --- | --- |
| `concordant_assembly` | Hub court and doors. Hub territories stay empty. |
| `zero_collective` | Grid stacks / under. |
| `catalogue_keepers` | Ruins forum (catalogue). |
| `wildwood_circle` | Sundering wildwood / fold. |
| `verdant_veil` and Tunya country ids | Named Tunya sectors, claim plane. Unplaced names stay 0. |
| `delgado_syndicate` and Iron Coast bill presences | `crime_sodium`, `crime_wharf`. Politics stay on the claim plane. |
| Dawn civic / task force | `dawn_kane`, arterials. |
| Unclosed foundry people | Crucible, weight low. No closed capital. |
| Sere Tally House | Claim plane on `sere_old_capital` only. Not a kilometre capital. |

`faction-strategy.js` `pickMove` / `applyMove` may later **name** a `region_id` from this table. They may not create a faction to justify a score.

## Scored table (design-intent)

`raw` values are the weighted sums in `SPEC.json`. They are not a census and not Unity `populationBaseline`.

### Hub — one city-state

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `hub_plaza` | 0.723 | city | court | Flower Law 42 m. Import food. Civic drain. Steel presents as a flower except arena sand at (0, 18) r=8. |
| `hub_doors` | 0.662 | city_district | court | Parent `hub_plaza`. Eight plaques, radius 34 m. Not a second city. |
| `hub_wall` | 0.391 | village | village | 56 m band. Defense ring. |
| `hub_pinewood` | 0.405 | village | village | (62, −28) m. Milepost. Outside Flower Law. Letter this name only. |
| `hub_approaches` | 0.389 | village | village | Crown Roads leave here. Ordinal `road_verge` forbids a city even though transport is high. |

`CityAtlas.For(Hub)` remains the Unity list. This table does not replace `BuildSettlements`. It tells later growth which Hub pad is the court.

### Grid (`Cyber`)

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `cyber_stacks` | 0.733 | city | borough | Ring-dense heart. Sky-bridges are built relief, not atlas kilometres. |
| `cyber_under` | 0.435 | village | borough | Service. Not hell. No pastoral river. |
| `cyber_wharf_march` | 0.344 | village | village | Harbor is the march. `adds_port_city` stays false. Not a chord to Crime. |

### Sovereign Ruins

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `ruins_forum` | 0.552 | town | archive | Catalogue. One spout. No lake. |
| `ruins_rib` | 0.284 | hamlet | hamlet | Channel kind stays `none`. Cold iron is archive iron. |
| `ruins_unfinished` | 0.200 | hamlet | hamlet | Empty road. |
| `ruins_envoy_claim` | null role | none | none | Local metres. Do not lift. |

### Sundering (`Fantasy`)

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `sunder_wildwood` | 0.486 | village | village | Grove. Oak shrine. Not a lake country. |
| `sunder_fold` | 0.426 | village | village | Mist at the fall. House Voss is a stair fragment. |
| `sunder_alpine` | 0.274 | hamlet | hamlet | Titan pillar is a landmark, not a range. |
| `sunder_salt_toll` | 0.405 | village | village | Dry track `pass_sunder_salt`. Inner Veil on the southwest. |

East moss stays on this disc. Ash stays on Ruins. The gap is not a fourth town.

### Tunya

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `tunya_masond` | 0.580 | town | town | One realized river. Landings only. `cross_tunya_masond` is a foot crossing, not a city. |
| `tunya_asbir` | 0.347 | village | mining | Wadi stays dry. |
| `tunya_sangree` | 0.484 | town | forge | GoldenSlice is the only crafting forge. |
| `tunya_aekon` | 0.292 | hamlet | hold | Ice. Warm pocket 0.15 fertility is not a city. No ice spell. |
| `tunya_fluxom` | 0.696 | town | port | Harbor. Lock is the harbor. Fluxom Gate (62, 18) stays `tunya_local_metres`. |
| `tunya_nil` | 0.355 | village | village | Cap `listening_grove`. Veto `no_clearcut`. |
| `tunya_fallback` | 0.320 role | none (km) | village role | Names inherit terrace grammar. No kilometres. |
| `tunya_unplaced` | — | none | none | Hold of First Arrival and the rest stay unplaced. |

### Frontier

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `frontier_hitch` | 0.405 | village | village | Post. Walker Paths do not follow a river. |
| `frontier_drift` | 0.270 | hamlet | hamlet | Bridge **site**. Cottonwood marks former water. |
| `frontier_last_dome_unplaced` | — | none | none | “One mile past the frontier gate.” Not converted. |

### Iron Coast (`Crime`)

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `crime_sodium` | 0.681 | city | town→city | Block ordinal. Rain climate, not a flood apocalypse. Wing Chun is culture, not a terrain field. |
| `crime_wharf` | 0.653 | town | port | Working river + barge + strait. Strait is 96 minutes and not a Link. |

Crime district pins already placed with `WorldGeography.DeterministicOffset` stay where they are. This solver does not move them.

### Permanent Dawn (`Superhero`)

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `dawn_kane` | 0.671 | city | capital/borough | Kane’s fin. No victory statue heart. |
| `dawn_arterials` | 0.395 | village | borough | Present-metre streets. Not a second city. |
| `dawn_crown_stair_glue` | — | none | none | Glue kit across the Hub, not a land border. |

### Crucible

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `crucible_lattice` | 0.407 | village | works | Few people. No closed capital. Sheet does not realize. |
| `crucible_foundry` | 0.338 | village | works | Road ends. Seam 1476 minutes, unfinished. |

### Sere (roles, `stamp_cells: false`)

No Link. No Flower Law. Build on existing pads. Repair is the history.

| Region | Raw | Tier | Type hint | Note |
| --- | --- | --- | --- | --- |
| `sere_old_capital` | 0.369 | village | archive | Repair. Tally House stays claim plane. |
| `sere_spire` | 0.212 | hamlet | hamlet | Stub and footing. |
| `sere_furnace` | 0.352 | village | works | Shift crew. One eye in a stack. |
| `sere_breadlands` | 0.258 | hamlet | hamlet | Exhausted. Not a breadbasket. |
| `sere_flooded` | 0.276 stored | none | none | `cannot_found`, cap `drowned`. |
| `sere_drowned` | 0.248 | hamlet | hamlet | Tide stain. |
| `sere_passes` | 0.244 | hamlet | hamlet | Thorn. |
| `sere_haven` | 0.317 | village | village | Platform. No resort. |
| `sere_delta` | 0.398 stored | none | none | `cannot_found`, `no_new_beauty`. Node is not a city. |
| `sere_highland` | 0.218 | hamlet | hamlet | Headframe. Almost nothing. |

## Clocks (unchanged)

| Clock | Suitability may |
| --- | --- |
| Plaque, 2 minutes | Credit access on Hub doors and spoke hearts. Never convert to kilometres of trade. |
| Atlas `travel_minutes` | Credit transport when an edge **touches** the region. Copy minutes. Do not retime. |
| Present 0.55 m/km | Leave `WorldGeography` waypoints. Do not feed them into the 5 km/h formula. |
| Hub canon metres | Price plaza, doors, wall, Pinewood, arena. Flower Law remains 42 m. |
| Local claim metres | Faction weight only. Never promote Fluxom Gate, Ruins envoy, or Tally House into veil kilometres. |

`sea_crime_sere` stays 96 minutes. The waystone stays 480. Sere is not a ninth door.

## Concord integration (extend, do not replace)

| Target | Today | What G4b names | Leave in place |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` `renderedElevationAt`, `generatePoughkeepsieHeightmap` | Hub/Poughkeepsie heightmap, seed `0xc0ffee`. `hashSeed(worldId)` reserved. | Terrain axis reads W02 slope class, not this heightmap. | Do not retune the seed. Do not pathfind the walk patch. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow` | Local 4-neighbour flow. | Water axis reads W03 `kind`. | Do not seed flow from a score. Do not wet the plaza. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs and a Living Society `settlements` row. Heartbeat `procgen-settlement-cycle` freq 240. | Later bind: spawn only when `cannot_found` is false and tier is hamlet or above. `MAX_NPCS_PER_REGION` stays. | Do not spawn from fertility, Nil canopy, `sere_delta`, cottonwood, a port node, or a cheap minute count. This is not a city physicalizer. |
| `server/domains/procgen-settlements.js` | Read surface. | Same gate. | No second identity table. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | Stance machine on authored factions. | A move may name a scored `region_id`. Faction axis uses existing holders. | Do not mint kingdoms. Hub territories stay empty. Crucible gains no ninth district. |
| `server/domains/faction-strategy.js`, `server/emergent/faction-strategy-cycle.js` | Domain + heartbeat. | Same. | |
| Unity `WorldGeography.BuildSettlements` | Hub from `CityAtlas`; spokes from cities / arrival fallback; `SettlementTypeFor`. | `type_hint` agrees with that function’s vocabulary. | Do not rewrite `populationBaseline`. Do not add a Hub territory. Do not move DeterministicOffset crime pins. |
| `WorldGeography.Routes` | Nine Present-space internatioal-road ids. | Transport axis looks up W05 atlas edges. | Do not move waypoints. |
| `MegaworldMap.HasLinkGate` | False for Sere. | Keep false. | |
| `WorldGate` / `Canon.Gates` | Eight plaques. | Eight. | No ninth. |

Procedural buildings and TreeLayer wait for physicalization. They are not consumers of this table.

## Outputs for the next stage (civ)

Civilization reads:

- `tier`, `cannot_found`, `parent_region_id`
- `faction_holder` (authored id or null)
- `type_hint`
- `stamp_cells`

It attaches existing factions to named regions. It does not draw a new kingdom, does not close a Crucible capital, and does not promote a claim circle into a disc border.

Population after that checks `population_bias` against Living Society rows. Economy attaches to `trade_nodes`. Growth may add a structure only on a pad whose tier is village or above and `cannot_found` is false. Infrastructure may build only on W05 edge ids and named crossings. Physicalization uses existing architecture kits.

## Aura / Cursor — what not to build yet

- No city block-out, no parceler, no street spline, no NavMesh.
- No 2 km suitability raster.
- No edit to `world-terrain.js`, `terrain-water.js`, `procgen-settlements.js`, `faction-strategy.js`, or `WorldGeography.cs`.
- No `PROMPTS_INDEX` rows, no meshes, no images.
- No retune of Flower Law, mob caps, or batches B21–B31.
- No new `MAP_MASTER` link.

Pilot counts (design-intent): 4 cities (`hub_plaza`, `cyber_stacks`, `crime_sodium`, `dawn_kane`), 1 city district, 5 towns, 17 villages, 10 hamlets, 7 none (including stored-but-blocked Sere flood/delta). Forty-four regions. Zero new place-names.

## Honesty pins

1. Scores live on named W00 `region_id`s only.
2. `writes_channels` is empty. Mobility was not a field channel; suitability is not one either.
3. W04 `suitability_cap` and `veto` are honored. Nil is a grove. Breadlands stay exhausted. Delta is not a city.
4. W05 `outputs_for_suitability.may_not` is honored: low minutes are not a city; Nil cap is not ignored; a port record does not add a city.
5. Hub is one city-state. Flower Law 42 m. Pinewood is a crossing village outside the disk.
6. Fantasy is the Sundering. No Vinewood.
7. Sere has no Link gate. The seam is unfinished.
8. `quantity` stays null. `population_bias.relative` is not a headcount.
