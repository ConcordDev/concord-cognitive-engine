# W04 — World Forge G3 climate, biome, resources

**Slice:** `W04_biome_resource_spec`  
**Phase:** G3. Text and JSON only.  
**Machine file:** `SPEC.json` (`concordia-world-forge-biome-resource/1.0`).  
**Consumes:** `concordia-world-forge-hydrology/1.0`, and through it the continental spec, the field schema, and the canon graph.  
**Batch:** `WF3_biomes`.

This stage writes `temperature`, `rainfall`, `humidity`, `biome`, `soil`, `resource`, and `fertility`. Ecosystem key, vegetation density, and a viability-cone report live on the biome channel. A `channel_carry` label sits beside an existing water body. It does not write elevation, slope, geology, drainage, or water, and it does not move a polyline.

Flower Law is a horizontal Hub disk of 42 m. It is not a climate cell and not a grove. `world_id` Fantasy stays Fantasy. The display name is the Sundering. There is no second fantasy continent and no ninth Link.

## What this stage is

G1 left land and rock. G2 left a closed list of channels. G3 says what weather that land is allowed to have, which canon biome class that weather supports, how much vegetation the flora budget spends, and which already-named resource locus may sit on that rock.

The field is analytic. Region bands are the climate. `hashSeed` may break a density tie inside a band. It may not raise a rainfall, invent a Köppen code, or add a deposit. Lookfeel `GEO_*` climate lines and `STYLE_*` palettes are binds. The palette tints fog and ground. It does not set a Celsius value.

Dwarf Fortress derives biomes from rain and temperature after drainage. Concord’s pipeline keeps the same order and a stricter list. A cell’s biome class is the class of its region. Signals may be reported to the existing creature cones. The cones do not rename the class.

## Three substages, one slice

| Substage | Writes | Reads | Does not |
| --- | --- | --- | --- |
| Climate | `temperature`, `rainfall`, `humidity`, and a `channel_carry` label | Elevation class, sea mask, `water.kind`, ephemeral flag, W00 `climate_tag`, `GEO_*` climate line | Redraw drainage. Apply a second lapse on top of a W01 band. Paint mist across a disc. |
| Biome | `biome` (class, flora budget, ecosystem key, density, spawn gate, viability report), `soil` | Climate bands, geology class, `water.kind`, W00 `flora_budget`, W01 exemplar class where one exists | Call `classifyBiome` to choose the class. Blend a march into a fourth kit. |
| Resources | `resource`, `fertility` | Geology rock (read-only), region resource ids, soil, rainfall, drainage | Invent a locus. Set `quantity`. Let civ, pop, or economy write fertility. |

Geology stays the G1 channel. Resources read it. They do not open a new pipeline stage and they do not retitle a landform.

## Grid inherited from G1 and G2

- Frame: `continental_veil_datum`. Cell 2 km. Origin of cell `(0,0)` is (−520, −580) km. The same `gx` / `gz` as G1.
- Bbox, design-intent: 520 × 550 = 286000 cells if allocated. **Do not write that raster.**
- Sea mask: elevation ≤ 0. Sea has no land biome and no resource locus. Aquatic species are not gridded onto the Exodus.
- Cells in G1 `stamps_skipped` (`tunya_unplaced`, `tunya_fallback`, every Sere region, `frontier_last_dome_unplaced`, `ruins_envoy_claim`, `dawn_crown_stair_glue`) receive climate and biome as **roles** with `stamp_cells: false`.
- The walk patch remains `play_patch_legacy` (seed `0xc0ffee`, clamp [0, 80] m). Its west-to-east depression is not a climate transect.

## Algorithm

Run in this order. No step rewrites elevation, slope, geology, a coast polyline, or a G2 trace.

1. **Inherit.** Read the G1 cell class, metres, derived slope, geology, and sea mask. Read the G2 `watershed_id`, accumulation class, `outlet`, `water.kind`, `body_id`, and ephemeral flag. A cell with no region stamp stays `unstamped` on every G3 channel.
2. **Region band.** Copy the closed row in `regions[]`. Where `band_authority` is `w01_exemplar`, the Celsius, millimetre, humidity, soil, biome class, and fertility score are the W01 numbers. Where it is `design_intent`, the row is new in this slice and marked as such. One band per region. Do not subdivide a disc with noise.
3. **No second lapse.** Alpine cold, Aekon ice, and Asbir heat are already different rows. A further −6.5 °C per 1000 m on top of those rows is forbidden. Intra-region exceptions are only the named anomalies: Sangree `local_anomaly_c` 8 on one face of the stack, foundry steam on the foundry edge, and the Crucible prose that two temperatures may share a sky. That prose stays `unresolved_drift`. It is not a second raster.
4. **No second rain shadow.** The Sundering already separates wet fold, wet wildwood, and drier salt toll. Crime rain, Nil canopy, and Asbir drought are region rows. A coast cell may not leave its region humidity band. Mist extent stays the W01 note: at the fall, not the disc. Nil’s humidity stays inside Nil.
5. **Carry label.** From the region rainfall midpoint, attach `channel_carry` to a body that already exists. Classes, design-intent: `arid_trace` below 250 mm, `seasonal_low` below 600, `moderate` below 1000, `wet` below 1600, `saturated` at or above 1600. The label does not change `depth_m`, Strahler, `max_trace_cells`, or `realizes`. Ephemeral `kind: none` bodies may record `seasonal_wet_fraction` and stay dry as a kind. `crucible_sheet.realizes` stays false. Gutters stay short of a flood. The Hub civic drain stays buried and does not become a river because the court is in the moderate band.
6. **Biome class.** The class is the region row. It must agree with that world’s W00 `flora_budget`. A miss is an error, not a new class. `classifyBiome` in `server/lib/viability/biome.js` remains the live cone labeler over temperature, humidity, and light. A binder may store its top cone as `viability_affinity_report`. If the cone disagrees with the region class, the region class wins. Civic stone that scores `temperate` stays `civic_hardscape`.
7. **Soil.** Copy the row. Soil is derived in the authoring sense from geology, drainage, and climate. Paving is a legal class. Do not invent a loam under the Hub plaza.
8. **Ecosystem and density.** Map the class through `ecosystem_binds` onto a key that `speciesForBiome` already understands: `plains`, `forest`, `highland`, `mountain`, `arid`, `water`. The universe string is the loot-table key for that world. Sere has no key in `BIOME_SPECIES`. Sere roles set `spawn: suppress` rather than falling through to `standard` deer. Spawn is also suppress when the flora budget is hardscape, weed, ash stain, wet street, ice, stubble, thorn, or civic planting. `water` is passed only for a realized surface body in `aquatic_bodies`, and only inside a future play window. It is not passed for sea, steam, ice, civic drains, or the Crucible sheet. Density is a 0–1 band on the class. `hashSeed(worldId + ":" + gx + ":" + gz + ":veg")` may pick a value inside the band. It may not leave the band.
9. **Cottonwood marker.** `frontier_former_water` stays `kind: none` and biome `wind_empty`. When its `seasonal_wet_fraction` is above 0.05, the cell may set `veg_marker: cottonwood`. That marker is not a forest class and not a new channel.
10. **Resources.** A locus stamps only when its id is on that `region_id` in W00 and the geology or water predicate in `resource_predicates` matches. `quantity` stays null. Timber follows the flora budget, not a disc-wide forest. Silt follows the realized river or the Sere delta role. Salvage, scrap, concrete, and brick follow the built region, not a random rock cell.
11. **Fertility.** On a `w01_exemplar` row, the W01 score is the score, including `suitability_cap` and veto. On a `design_intent` row, the score in this slice is the authored design-intent number. Civ, population, and economy do not write it. A high score does not place a city. Nil’s veto remains `no_clearcut`. Breadlands stay exhausted. The name is not a retcon.
12. **Marches.** Inside a disc, the disc’s class holds. In the open gap outside both discs, channels are `march_gap`: biome class null, density 0, resources empty. Weathering may cross. Kits do not merge. East of the Sundering toward Ruins, moss stays on the Fantasy side of the radius and ash on the Ruins side. The gap is not a fourth blend biome.
13. **Flower Law.** Cells are kilometres. The 42 m disk is not a cell. Any play window that intersects the Hub plaza, doors, or wall keeps `civic_hardscape`, paving, and fertility at the exemplar, and never calls a tree scatter. Pine and the salt crust stay on `hub_pinewood`, outside that disk.

## Region bands

W01 rows are copied, not recomputed. Other rows are design-intent. Rainfall is millimetres per year. Temperature is a mean-annual band in Celsius. Humidity is a fraction.

| Region | Authority | °C | mm | Biome class | Density | Fertility |
| --- | --- | --- | --- | --- | --- | --- |
| `hub_plaza`, `hub_doors`, `hub_wall` | W01 | 11–16 | 700–950 | `civic_hardscape` | 0.02–0.08 | 0.05 / 0.04 / 0.06 |
| `hub_pinewood` | W01 | 10–16 | 450–700 | `pine_verge` | 0.15–0.30 | 0.15 |
| `hub_approaches` | W01 | 9–16 | 650–900 | `road_verge` | 0.08–0.18 | 0.18 |
| `sunder_wildwood` | W01 | 10–15 | 1100–1500 | `temperate_oak_wood` | 0.55–0.80 | 0.62 |
| `sunder_fold` | W01 | 8–13 | 1200–1600 | `mist_fold` | 0.25–0.45 at the fall | 0.32 |
| `sunder_alpine` | W01 | 0–7 | 700–1000 | `rune_scar_pine` | 0.12–0.28 | 0.12 |
| `sunder_salt_toll` | W01 | 12–17 | 400–700 | `salt_track` | 0.08–0.18 | 0.16 |
| `tunya_masond` | W01 | 12–20 | 800–1100 | `cliff_terrace` | 0.20–0.40 landings | 0.35 landings only |
| `tunya_asbir` | W01 | 22–34 | 50–180 | `hot_dune` | 0.02–0.08 | 0.08 |
| `tunya_sangree` | W01 | 16–24, +8 on one face | 500–800 | `forge_scrub` | 0.10–0.22 | 0.20 |
| `tunya_aekon` | W01 | −6–2 | 600–1000 snow water | `glacial_ark` | 0–0.02 | 0.02, pocket 0.15 |
| `tunya_fluxom` | W01 | 14–22 | 900–1300 | `dye_harbor` | 0.12–0.28 | 0.40 |
| `tunya_nil` | W01 | 18–26 | 1600–2400 | `wet_canopy` | 0.75–0.95 | 0.72, veto `no_clearcut` |
| `tunya_fallback` | W01 role | 14–24 | 800–1400 | `terrace_grove` | role only | 0.50, cap `no_clearcut` |
| `cyber_stacks`, `cyber_under`, `cyber_wharf_march` | design-intent | 14–22 / 12–18 / 13–20 | 900–1400 | `weed_moss_pad` | 0.04–0.12 | 0.06 |
| `ruins_forum`, `ruins_unfinished` | design-intent | 14–22 | 180–350 | `ash_stain` | 0.03–0.10 | 0.07 / 0.05 |
| `ruins_envoy_claim` | design-intent, no cells | 14–22 | 180–350 | `ash_stain` | role | 0.05 |
| `ruins_rib` | design-intent | 11–19 | 150–320 | `ash_stain` | 0.03–0.08 | 0.06 |
| `frontier_hitch`, `frontier_drift` | design-intent | 8–18 | 180–350 | `wind_empty` | 0.04–0.12 | 0.12 |
| `crime_sodium`, `crime_wharf` | design-intent | 9–15 | 1100–1600 | `wet_street` | 0.06–0.16 | 0.10 street, 0.22 silt cells |
| `dawn_kane`, `dawn_arterials` | design-intent | 13–20 | 700–1000 | `civic_planting` | 0.12–0.28 | 0.15 |
| `dawn_crown_stair_glue` | design-intent | same dawn band | same | `civic_planting` | role, no land border | 0.10 |
| `crucible_lattice` | design-intent | 10–18, drift unresolved | 400–700 | `fault_moss` | 0.04–0.12 | 0.10 |
| `crucible_foundry` | design-intent | edge +6 steam | 400–700 | `foundry_edge_pad` | 0.02–0.08 | 0.08 |
| Sere roles | design-intent, no cells | smog band per row in JSON | per row | role classes | stubble, reed, or thorn | exhausted, not a breadbasket |

`tunya_unplaced` and `frontier_last_dome_unplaced` stay unstamped. The Last Dome mile gains no enclosed biome.

## Carry on existing water

| Body | Carry | Seasonal fraction | Still true |
| --- | --- | --- | --- |
| `hub_civic_drain` | `moderate` | none | Buried. Not a river. |
| `sunder_short_run`, `sunder_shelf_fall` | `wet` | none | No lake. Mist local. |
| `sunder_alpine_seep` | `moderate` | none | Accumulation class stays `none`. |
| `tunya_masond_river` | `wet` | none | Count 1. Stops at the region edge. |
| `tunya_asbir_wadi` | `arid_trace` | 0.05 | Stays dry. No lake. |
| `tunya_nil_basin` | `saturated` | none | Basin, not a lake. No clearcut. |
| `tunya_aekon_glacier` | `moderate` | none | Ice. No liquid handoff. |
| `ruins_rib_channel` | `seasonal_low` | 0.15 cap 0.20 | `kind` stays `none`. |
| `frontier_former_water` | `seasonal_low` | 0.12 cap 0.25 | Cottonwood marker only. Paths do not follow a river. |
| `crime_working_river` | `wet` | none | One polyline. |
| `crime_gutters` | `wet` | 0.15 cap | Not a flood apocalypse. |
| `crucible_sheet` | `seasonal_low` | 0 | `realizes` stays false. |
| `sere_failed_levee`, `sere_delta` | role | no cells | Not a clean lake. |

## Resources

Every id is a W00 locus. `quantity` is null. The predicate is the only new claim.

| Id | Region | Predicate |
| --- | --- | --- |
| `hub_cut_stone` | `hub_plaza` | geology rock `dimension_stone` |
| `hub_pine` | `hub_pinewood` | biome `pine_verge` |
| `hub_salt_dust` | `hub_pinewood` | salt crust on that road, not the plaza |
| `sunder_oak` | `sunder_wildwood` | biome `temperate_oak_wood` |
| `sunder_shrine_stone` | `sunder_fold` | rock `dimension_stone` |
| `sunder_pine_scar` | `sunder_alpine` | biome `rune_scar_pine` |
| `sunder_salt_toll` | `sunder_salt_toll` | salt-affected soil |
| `masond_cliff_stone` | `tunya_masond` | rock `dimension_stone` |
| `asbir_salt` | `tunya_asbir` | dune |
| `sangree_ore` | `tunya_sangree` | one stack face. GoldenSlice stays the only crafting forge. |
| `aekon_ice` | `tunya_aekon` | rock `ice` |
| `fluxom_dye` | `tunya_fluxom` | harbor works |
| `nil_lichen` | `tunya_nil` | one lichen. Not a clearcut. |
| `terrace_limestone`, `terrace_timber` | `tunya_fallback` | role only, no cells |
| `cyber_cable_salvage` | `cyber_stacks` | built pad, not a woodland |
| `ruins_limestone`, `ruins_ash` | `ruins_forum` | ash on stone |
| `ruins_cold_iron` | `ruins_rib` | archive iron, not a magma city |
| `frontier_dust` | `frontier_hitch` | wind empty. Not a mesa. |
| `crime_river_silt` | `crime_wharf` | cells of `crime_working_river` only |
| `dawn_concrete` | `dawn_kane` | civic pad |
| `crucible_basalt` | `crucible_lattice` | rock `basalt` |
| `crucible_scrap` | `crucible_foundry` | foundry edge |
| `sere_soot_brick`, `sere_furnace_iron`, `sere_exhausted_soil`, `sere_silt`, `sere_headframe` | matching Sere roles | `stamp_cells: false` |

## Lookfeel bind

| World | GEO file | GEO climate line | STYLE file | Field weather word |
| --- | --- | --- | --- | --- |
| Hub | `GEO_Hub.md` | temperate civic, clear | `STYLE_Hub.md` | `clear` |
| Fantasy | `GEO_Fantasy.md` | forest to alpine, clear | `STYLE_Fantasy.md` | `clear` |
| Tunya | `GEO_Tunya.md` | multi-biome, grove default | `STYLE_Tunya.md` | `grove` |
| Ruins | `GEO_Ruins.md` | ash | `STYLE_Ruins.md` | `ash` |
| Crime | `GEO_Crime.md` | rain coast | `STYLE_Crime.md` | `rain` |
| Cyber | `GEO_Cyber.md` | haze neon | `STYLE_Cyber.md` | `neon` |
| Frontier | `GEO_Frontier.md` | wind | `STYLE_Frontier.md` | `wind` |
| Superhero | `GEO_Superhero.md` | permanent dawn | `STYLE_Superhero.md` | `dawn` |
| Crucible | `GEO_Crucible.md` | drift | `STYLE_Crucible.md` | `drift` |
| Sere | `GEO_Sere.md` | smog extraction | `STYLE_Sere.md` | `smog` |

Palette hex values live in `styles/STYLE_INDEX.json` and are copied into `SPEC.json` as presentation only. Fog, ground, and sun do not enter the Celsius band.

`WorldVisualProfileCatalog.For` already stores a single `vegetationDensity` per world (Hub 0.62, Fantasy 0.72, Tunya 0.92, Frontier 0.38, Ruins 0.28, Dawn 0.24, Sere 0.22, Crime 0.18, Crucible 0.14, Cyber 0.12). Those scalars are today’s presentation constants. They are not this field. Copying 0.62 onto `hub_plaza` would plant a grove inside Flower Law. The catalog’s Fantasy weather key `wind` and its Superhero bible string `Aegis` stay in that file. The field weather words remain W00 `clear` and `dawn`, and the display name remains Permanent Dawn.

`PresentationBiomeEcologyHook.Evaluate` currently derives moisture from Perlin noise plus a Tunya and Frontier offset. That noise is not continental climate. A later binder samples this field. This slice does not edit the hook.

## Concord integration

| Target | Today | Design target this spec names | Leave in place |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` | `renderedElevationAt`, seed `0xc0ffee`. `hashSeed` is FNV-1a and does not drive that grid. | Density ties use `hashSeed` once a reader exists. Climate does not read the walk formula as a transect. | Do not retune the seed, the 80 m clamp, or feed veil metres into `renderedElevationAt`. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow` | 4-neighbour flow, volume conserved. G2’s `channelSeedForPlayPatch` returns `play_window_unplaced`. | Carry labels do not add a source term. Ephemeral fractions do not call `setWater`. | Do not wet the plaza, lake the Sundering, or refill a column on the heartbeat. |
| `server/lib/viability/biome.js` `classifyBiome` | Ranks `arctic`, `temperate`, `desert`, `tropical`, `aquatic`, `cave`, `volcanic` from live signals. Fallback label `barren`. | Report only. Inputs, when a binder builds them, are the region band midpoint and humidity as a percent. | Do not let the top cone replace `biome.class`. Do not add an eighth envelope in G3. |
| `server/lib/ecosystem/loot-tables.js` `speciesForBiome` | Universe flavor plus `standard` for `plains`, `forest`, `highland`, `mountain`, `arid`, `water`. | Pass the mapped key only when `spawn` is `allow`. Universe strings stay the existing keys, including `concordia_hub`, `sovereign_ruins`, and `lattice_crucible`. | Do not add a Sere universe, a stag species, or a target count. The prose stag on the salt road is not a loot-table id. |
| `server/lib/ecosystem/creature-homes.js` `ensureHomeFor` | Idempotent home per `(world, biome, species)`. Skips biome `water` at insert. | Homes wait until spawn is `allow` and a play window exists. | Do not anchor a wolf on `civic_hardscape` because a cone said temperate forest. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs and a Living Society row. | Suitability, later, may read fertility and `water.kind` on an existing `region_id`. | Do not spawn a town from a fertile cell, from Nil’s canopy, from `sere_delta`, or from cottonwood. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | Stance on authored factions. | A move may name a `region_id` or a resource id already on that region. | Do not mint a kingdom on oak, silt, or basalt. Hub territories stay empty. The Crucible gains no ninth district. |
| Unity `WorldGeography` | Routes and borders. | Disc fields agree with the atlas when a binder arrives. | Do not promote claim circles or the 0.55 m/km present scale into veil metres. |
| `WorldVisualProfileCatalog`, `PresentationBiomeEcologyHook` | One density scalar and Perlin moisture. | Later, scale scatter by this field’s density band. | Do not edit them in G3. Do not treat the scalar as the plaza. |
| Procedural buildings and TreeLayer | Local meshes. Named in the G0 integration note. | Physicalization reads `biome.class` and density. | Not a G3 consumer. No new tree mesh. |

## Outputs for the next stage

Mobility reads slope, the G2 crossings, and this slice’s carry labels. A wet label does not create a ford. `pass_crucible_road_end` stays a road that ends. `crime_dawn_lane` stays barge water at 20 km/h. The 24.0 km strait stays `open_exodus`.

Suitability, later, may read fertility, slope, and `water.kind`. It may not treat a score as a city, and it may not ignore a `suitability_cap`.

## What not to build yet

- No climate raster, no biome tint texture, no 286000-cell JSON, no Köppen grid.
- No edit to `world-terrain.js`, `terrain-water.js`, `classifyBiome`, loot tables, settlement spawn, faction strategy, the ecology hook, or the visual catalog.
- No TreeLayer scatter and no procedural building pass.
- No cells for Sere, `tunya_unplaced`, `tunya_fallback`, the Last Dome mile, `ruins_envoy_claim`, or the Dawn crown-stair glue.
- No new resource id, no tonnage, no spawn rate.
- No retune of Flower Law, of seed `0xc0ffee`, of the 80 m clamp, or of batches B21–B31.
- No meshes, no images, no `PROMPTS_INDEX` rows.

## Validation a later binder can run

1. `schema` is `concordia-world-forge-biome-resource/1.0` and `consumes` names hydrology, the continental spec, the field schema, and the canon graph.
2. `writes_channels` is exactly `temperature`, `rainfall`, `humidity`, `biome`, `soil`, `resource`, `fertility`. Geology, drainage, and water are absent from that list.
3. Every `region_id` exists on that `world_id` in the W00 graph. Every resource id is one of that region’s W00 ids. Every `quantity` is null.
4. Every W01 exemplar band in this file matches the W01 exemplar numbers for that region.
5. `hub_plaza` biome is `civic_hardscape`. No Hub region has biome `temperate_oak_wood` or water kind `river`. Pine and salt stay on `hub_pinewood`.
6. No Sundering row is a lake. `tunya_nil` keeps veto `no_clearcut`. `tunya_masond` fertility applies to landings only. `sunder_fold` humidity extent is the fall.
7. `crucible_sheet` is not realized by rainfall. `ruins_rib_channel` and `frontier_former_water` stay `kind: none`. Cottonwood is a marker.
8. `stamp_cells` is false on every G1 skip: Sere, `tunya_fallback`, `tunya_unplaced`, `frontier_last_dome_unplaced`, `ruins_envoy_claim`, and `dawn_crown_stair_glue`.
9. `spawn: allow` occurs only on classes listed in `spawn_allow_classes`. Sere ecosystem universe is null. No species id is introduced.
10. STYLE hex values match `STYLE_INDEX.json`. They are marked `presentation`. The retired place-name forbidden by W00 `no_vinewood` is not a biome id. `world_id` Fantasy is not renamed. Flower Law radius is 42 on a horizontal axis.
