# W01 — World Forge G0 World Field schema

**Slice:** `W01_world_field_schema`  
**Phase:** G0 (canonical geographic data model). Text and JSON only.  
**Machine file:** `SPEC.json` (`concordia-world-forge-field/1.0`).  
**Consumes:** `W00_world_forge_canon_graph` (`concordia-world-forge-canon-graph/1.0`).  
**Examples:** Hub, Fantasy (display name the Sundering), Tunya. The other seven discs use the same channels when a later slice fills them. This file does not invent their cells.

Kilometres, Hub metres, and region ids are copied from W00. Numeric bands in the exemplars are `design_intent` class ranges, not station records and not a heightmap. Resource `quantity` stays null. Unplaced names stay unfielded.

Flower Law is a **horizontal** Hub disk of 42 m. It is not an elevation.

## What this stage is

The World Field is the stack of geographic channels every later stage reads. G0 defines the channels, their units, which pipeline stage may write them, and one exemplar per named region of three discs. It does not generate a continent, a watershed raster, or a city.

Pipeline order, same list as W00, and the only order `SPEC.json` `pipeline` allows:

Elevation → Hydrology → Climate → Biome → Resources → Mobility → Suitability → Civ → Pop → Economy → Growth → Infra → Physicalization

Dwarf Fortress writes rainfall before rivers. Concord does not. Hydrology here places channels from elevation plus W00 `water_dependency`. Climate then writes temperature, rainfall, and humidity as volume and season on top of those channels. Rainfall may later scale how much water a channel carries. It may not move a channel, cut a river through the Hub plaza, or turn the Sundering into a lake country.

## Two frames that must not be added together

| Frame | What it is | Authority |
| --- | --- | --- |
| `continental_veil_datum` | Metres above the Inner Veil / Exodus water plane, in `megaworld_km`. Region exemplars and, later, a 2 km cell. | Design-intent bands in this slice. G1 will write the grid. |
| `play_patch_metres` | The patch the player walks. `world-terrain.js` `renderedElevationAt`, clamp **[0, 80] m**, square **2000 m**, fixed seed **`0xc0ffee`**. `terrainSpec` samples 64×64, so the embedded cell is 31.25 m. Deformation and `terrain-water.js` use `CELL_SIZE` 10 m (`CONCORD_TERRAIN_CELL_M`). | Authored code. This slice does not retune it. |

`terrainSpec(worldId)` still builds the same grid for every world. `hashSeed(worldId)` is reserved and is not applied to that grid. A World Field exemplar must not be resampled into `sampledGrid`. Continental metres must not be added to the 0–80 m patch. The Hub court uses a third, local datum, `hub_court_walk`: the walk surface. Steps and the arena dish are relief of a few metres. The Warden wall is built relief, not a slope class of `cliff`.

## Channels

One exemplar carries every channel, or carries `channels: null` when W00 left the place unlocated.

| Channel | Unit | Written by | Read by | Rule |
| --- | --- | --- | --- | --- |
| `elevation` | m above the datum named on the exemplar | elevation (G1) | hydrology, slope | Class must be one of the region’s W00 `terrain_affinity` tags. |
| `slope` | rise/run, derived | elevation | mobility, suitability | Never authored apart from elevation. Classes: `near_level` < 0.04, `gentle` < 0.12, `moderate` < 0.25, `steep` < 0.50, `cliff` ≥ 0.50. |
| `geology` | rock class | elevation (rock is the landform, not a new stage) | soil, resources | No new pipeline step. |
| `drainage` | watershed id, accumulation class | hydrology (G2) | climate volume, soil, fertility | Obeys `water_dependency.forbidden`. |
| `water` | body id, kind, depth | hydrology (G2) | biome, economy | `kind: none` is a real value. A forbidden kind is an error. |
| `temperature` | °C mean annual band | climate | biome | Not a weather sim. Local forge heat is an anomaly, not the regional mean. |
| `rainfall` | mm/year band | climate | biome, fertility, later flow volume | Does not redraw drainage. |
| `humidity` | fraction 0–1 band | climate | biome | Mist at a waterfall is local, not a disc climate. |
| `biome` | class id | biome (G3) | resources, flora budget | Must agree with W00 `climate_tag` and `flora_budget`. |
| `soil` | class, depth class | biome (from geology + drainage + climate) | fertility | Paving is a soil class. It is not “missing data”. |
| `resource` | id, kind, quantity | resources (G3) | economy | Ids are a subset of that region’s W00 resources. `quantity` is null. |
| `fertility` | class and score 0–1 | resources (derived) | suitability | Civ, pop, and economy do not write it. A high score is not permission to clear a listening grove. |

`continent` is one object: the megaworld (`concordia_megaworld`), Canon Ring 400 km, seas `inner_veil` and `exodus_ocean`. Discs are worlds on that field. They are not ten continents and not ten random maps.

## Exemplars (design-intent)

Full rows are in `SPEC.json` `exemplars`. The bands below are the same numbers.

**Hub** (`hub_court_walk` inside the metro; approaches on the veil datum). Plaza, Ring of Doors, and the ground at the wall sit at 0–2 m with slope `near_level`. Drainage is `hub_civic_drain` (buried civic, not a river mouth). Surface water kind is `none`. Soil is paving over dressed stone. Biome `civic_hardscape`. Fertility score 0.05. Cut stone is the only plaza resource. Pinewood Crossing is a salt-road drain and a pine verge: rainfall band drier than the court (450–700 mm), fertility 0.15, and the salt line must not cross `hub_plaza`. Approaches (40–80 km, design-intent) are road and verge, 15–40 m on the veil datum, still with no river capital. Rain “as a visitor” is the 700–950 mm court band, not a monsoon and not a desert.

**Sundering** (`world_id` `Fantasy`, veil datum). Wildwood 180–320 m, oak loam, short clear run, fertility 0.62. Fold 300–520 m with a steep lip, one shelf waterfall (`sunder_shelf_fall`) that ends in a short run and infiltration, not a lake. Alpine rim 700–1100 m, thin soil, mist only, rune-scar pine, fertility 0.12. The titan pillar is a landmark note with **no** metre height. Salt toll 160–280 m, drier (400–700 mm), salt-affected soil. East march stays moss against Ruins ash; this schema does not add a blend biome.

**Tunya** (veil datum, design-intent offsets from W00). Masond cliffs 400–900 m, slope `cliff`, one river. Asbir dunes 80–220 m, 50–180 mm, fertility 0.08. Sangree 200–450 m, regional mean 16–24 °C, one-face forge anomaly, terrace runnel, ore quantity null. Aekon glacier 900–1600 m, mean at or below freezing, water kind `ice`, warm-hold pocket fertility 0.15 against a field score of 0.02. No ice spell. Fluxom 0–15 m, harbor and a lock into the Inner Veil; Fluxom Gate (62, 18) m stays on the local claim plane and is not this sector. Nil 40–180 m wet canopy, fertility 0.72 with `suitability_cap: listening_grove` and `no_clearcut`. Fallback terrace countries carry a grove-default class and `anchor_km: null`. The seven unplaced names have `channels: null`.

## Concord integration

| Target | Today | What this schema asks later | Do not |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` `terrainSpec`, `generatePoughkeepsieHeightmap`, `renderedElevationAt`, `hashSeed` | One 2000 m patch, max 80 m, seed `0xc0ffee` for every world. `seedForWorldId` is exposed and unused by the grid. | Keep the patch function. Read continental class from this schema beside it. A future detail layer may use `hashSeed(worldId)` only as micro-relief **inside** the existing clamp. | Do not replace the formula, do not add continental metres to `renderedElevationAt`, do not put Flower Law’s 42 into elevation. |
| `server/lib/terrain-deformation.js` `baseElevation`, `CELL_SIZE` (10 m) | `baseElevation` delegates to `renderedElevationAt`. | Digs stay on the play patch. | Do not store a continental raster in the deformation table. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow`, `waterDepthAt` | 4-neighbour flow, volume conserved, on the play-patch cell. | G2 may **seed** `setWater` only where an exemplar’s `water.kind` is a surface body and the cell is inside the play patch. Depth in the field is a design-intent band, not a column height to copy blindly. | Do not ship a second solver. Do not seed the Hub plaza. Do not seed a Sundering lake. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs and a Living Society row. | Suitability will later read fertility, slope, and water kind to **choose** a region id that already exists. | Do not treat fertility as a city generator. |
| `server/lib/embodied/faction-strategy.js` | Stance and moves on authored factions. | A move may name a `region_id` or a `water.body_id` from this field. | Do not mint a kingdom from a high fertility cell. Hub still has no territory. |
| Unity `WorldGeography` | Routes and borders. Hub territories empty. | Binder agrees disc fields with the atlas. | Do not promote claim circles or Present metres (0.55 m per km) into this field. |

`world-terrain.js` extension note, for the binder, not a patch in this slice:

The play patch answers “what is the ground under this 2 km window.” The World Field answers “which class that window was allowed to express.” `sampleRenderedHeight` stays the play-patch query. A new reader, when G1 exists, loads `exemplars[]` by `world_id` and refuses any sample whose elevation class is outside that region’s W00 affinity. Until that reader exists, the Poughkeepsie patch remains the only numeric elevation Concord serves, including on the Sundering and on Tunya. That is a known gap, not a license to pretend the patch is Masond’s cliffs.

## Outputs for the next stage

G1 (continental elevation) reads W00 affinities and this schema’s `elevation`, `slope`, and `geology` contracts. It writes a grid on `continental_veil_datum` at the design-intent 2 km cell, and it derives slope from neighbour elevation. It leaves drainage, water, climate, biome, resources, and fertility at the exemplar bands or null. It does not fill `tunya_unplaced`. It does not change `generatePoughkeepsieHeightmap`.

G2 reads `drainage` and `water` plus W00 `water_dependency`. G3 reads biome, soil, resource, fertility. Mobility and suitability are not channels in this schema; they consume slope, water, and fertility later.

## What not to build yet

- No heightmap, no watershed raster, no climate model, no city block-out.
- No edit to `world-terrain.js`, `terrain-water.js`, settlement spawn, or faction strategy.
- No retune of Flower Law, seeds, cell size, or asset batches B21–B31.
- No `PROMPTS_INDEX` rows. No meshes.

## Validation a later binder can run

1. `schema` is `concordia-world-forge-field/1.0` and `consumes` names the W00 schema.
2. Every exemplar `region_id` exists on that `world_id` in the W00 graph.
3. Exemplar worlds are only `Hub`, `Fantasy`, `Tunya`.
4. `tunya_unplaced.channels` is null. `tunya_fallback.anchor_km` is null.
5. Every `resource.quantity` is null, and every resource id is listed on that W00 region.
6. No exemplar `water.kind` appears in that region’s W00 `water_dependency.forbidden`.
7. `slope.derived_from` is `elevation` on every filled exemplar.
8. `play_patch.max_elevation_m` is 80 and `seed` is `12648430` (`0xc0ffee`). Flower Law is recorded as radius 42, datum horizontal.
9. Strings `Vinewood` and a ninth Link do not appear. `Fantasy` is not renamed.
