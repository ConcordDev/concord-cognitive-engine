# W11 — Hub court degrade (Unburned Court)

**Slice:** `W11_hub_court_pilot`  
**Phase:** pilot. One place, `layout_hub_court`, walked in pipeline order. The pilot write is the read-side degrade of continental fields onto the existing Hub heightmap and the existing local water grid.  
**Batch:** `WF_pilot_hub`  
**Machine file:** `SPEC.json` (`concordia-world-forge-hub-court-pilot/1.0`).  
**Consumes:** W00 through W09. W10 stays the Sangree trace and is not revised here.

`world_id` Fantasy stays the Sundering. Flower Law stays a 42 m horizontal disk on the Hub. The arena sand at (0, 18) m, steel radius 8 m, is the steel exception inside that disk. Steel is live on the wall and beyond. Sere stays off `Canon.Gates`. The eight plaques stay eight. Vinewood stays absent. The Hub has no kingdom. `Territories(Hub)` stays empty.

Heights below that carry `sampled_from_renderedElevationAt` were read from the current pure function (`seed` `0xc0ffee`, patch 2000 m, clamp 80 m) on 2026-09-25. They are samples of that formula. They are not a plaza survey and they are not a new elevation channel.

## Stage trace

| Order | Stage | Inherited record | Pilot write |
| --- | --- | --- | --- |
| 0 | Canon | W00 `hub_plaza` through `hub_approaches`. Bias ordinals `plaza_peak` / `thinned` / `crossing` / `road_verge`. Quantity null. | None |
| 0b | Field | W01 exemplars. Plaza and doors on `hub_court_walk`. Approaches on `continental_veil_datum`, band 15–40 m. | None |
| 1 | Elevation | W02 classes `flat_court`, `low_wall`, `salt_road_drain`, `road_and_verge`. | Read-side blend. `renderedElevationAt` is not rewritten. |
| 2 | Hydrology | W03 `hub_civic_drain`, `hub_salt_road`, `hub_approach_ditches`. Kind `none`, depth 0, `seed` false. | Translation rule for `baseElevation` / `setWater`. No water is seeded. |
| 3 | Climate | W04 plaza 11–16 °C, rain 700–950 mm, humidity 0.45–0.60. Tag `clear`. | None. Rainfall does not call `setWater`. |
| 4 | Biome | `civic_hardscape`. Spawn `suppress`. Density band 0.02–0.08. | Scatter count inside 42 m stays 0. |
| 5 | Resources | `hub_cut_stone` on the plaza. Quantity null. | Quantity stays null. |
| 6 | Mobility | Door ring cites the eight `gate_hub_*` edges. `road_hub_flower_ring` cites no edge. | No new edge. Plaque time stays 2 minutes. |
| 7 | Suitability | W06 `hub_plaza` raw 0.723, tier `city`. | Checked, not recomputed. |
| 8 | Civ | W07 `cap_hub_court`. `kingdom` false. Faction `concordant_assembly`. | No kingdom. No farm. No mine. |
| 8b | Layout | W08 five court districts under cap 6, plus folded `dist_hub_doors`. Forbidden uses `agricultural`, `industrial`, `water`. | Slots unchanged. |
| 9 | Pop | Contract in W09. | Headcount stays null. |
| 10 | Economy | Contract allows a later price on `dist_hub_market` as import food. | Concord Coin stays null. |
| 11 | Growth | Contract in W09. | `parcel_count` stays null. |
| 12 | Infra | Rings exist. Class `ring` may be paved by the W09 rule. | `paved` stays false. |
| 13 | Physicalization | Contract in W09. | `physicalize` stays false. The walk surface is the heightmap already in the client. |
| 14 | Unity streaming | `WorldStreamManager` already queues. `HubKeepM` is 125. | Job described. This file does not enqueue. |

### Suitability check

Copied axes for `hub_plaza`: water 0.55, food_effective 0.55, trade 0.92, resources 0.45, terrain 0.90, defense 0.80, transport 0.72, faction 0.95.

```
0.16*0.55 + 0.14*0.55 + 0.14*0.92 + 0.10*0.45
+ 0.12*0.90 + 0.10*0.80 + 0.14*0.72 + 0.10*0.95
= 0.7226
```

W06 stores 0.723. This pilot keeps 0.723. Trade 0.92 clears the 0.70 import gate, so food_effective stays 0.55. The tier stays city. `hub_doors` stays `cannot_found` as a district of `hub_plaza`.

## Two horizontal frames

The mesh and the server flow grid already disagree about where (0, 0) is. This pilot names the translation and leaves both functions in place.

| Frame | Who uses it | Origin | Query |
| --- | --- | --- | --- |
| Player / mesh, centered | Flower Law, plaques, arena, Pinewood, Three Refusals, `sampleRenderedHeight` | Hub walk origin | `nx = (wx + 1000) / 2000` |
| Flow / deformation, corner | `baseElevation`, `cellOf`, `setWater`, `waterDepthAt` | Southwest corner of the 2000 m patch | `nx = wx / 2000`, wx expected in `[0, 2000]` |

Translation, already implied by the two formulas: `wx_corner = wx_centered + 1000`, `wz_corner = wz_centered + 1000`. After that shift, `baseElevation(wx_corner, wz_corner)` matches `sampleRenderedHeight(wx_centered, wz_centered)`. The match was checked at the origin, the arena, the east door, the flower edge, the wall, Pinewood, Three Refusals, the keep edge, and the west river sample.

Calling `baseElevation` on centered player metres skips the shift. At the court origin that call returns 2 m, the river end of the profile. The centered sample at the same point is 39.9094 m. The gap is 37.9094 m. A later water query for the court uses the corner frame. This file does not change `baseElevation`.

Flower Law in the corner frame is a disk centered at (1000, 1000) m, radius 42 m. With `CELL_SIZE` 10 m that disk covers cells `cx` and `cz` from 95 through 104 inclusive. Those cells are named so a later reader can see the disk. They are not written.

## Elevation degrade

Continental veil metres and play-patch metres stay in their own frames.

- Inside the player disk, walk height is the centered sample, then flattened.
- `h_mesh(wx, wz) = sampleRenderedHeight(wx, wz)`.
- `h_origin = h_mesh(0, 0) = 39.9094` m on the current seed. Plateau, not the river, not the veil.
- `r = hypot(wx, wz)` in centered metres.
- `r <= 42`: `h_walk = h_origin`. Relief this pilot is 0, which sits inside the plaza band 0–1.5 m and the door band 0–1.0 m.
- `42 < r < 125`: `u = (r - 42) / 83`, `s = u² (3 - 2u)`, `h_walk = (1 - s) h_origin + s h_mesh`.
- `r >= 125`: `h_walk = h_mesh`, out to the patch edge at 1000 m.
- `125` is `ContinentStream.HubKeepM`. The blend radius is that published keep, not a new constant.

The raw mesh on the 42 m ring departs from `h_origin` by as much as 1.7549 m, at bearing 209°. Rise over that radius is 0.0418, above the plaza slope cap 0.03. The flatten sets slope inside the disk to 0, which satisfies `near_level`. The discarded simplex is not stored. Relief stays 0, so the 1.5 m band still holds. The arena dish stays an affinity with `depth_m` null; paving and sand share `h_origin` until a later pass dishes inside the band. The wall’s built relief, 2–4 m, stays a mesh on the walk. It is not added to `h_walk`.

| Place | r m | `h_mesh` m | `h_walk` m | Delta from origin m | Zone |
| --- | --- | --- | --- | --- | --- |
| Origin | 0 | 39.9094 | 39.9094 | 0 | flower flat |
| Arena (0, 18) | 18 | 40.0482 | 39.9094 | 0 | flower flat |
| East door | 34 | 40.2327 | 39.9094 | 0 | flower flat |
| Flower edge | 42 | 40.8462 | 39.9094 | 0 | flower flat |
| Wall, bearing 0 | 56 | 40.8806 | 39.9829 | +0.0736 | annulus |
| Pinewood (62, −28) | 68.029 | 40.6888 | 40.0913 | +0.1819 | annulus |
| Three Refusals (−48, −58) | 75.286 | 38.5499 | 39.4288 | −0.4806 | annulus |
| Keep edge | 125 | 40.4577 | 40.4577 | +0.5484 | raw begins |
| Present ring, bearing 0 | 220 | 47.4945 | 47.4945 | +7.5851 | raw mesh |
| West river sample (−950, 0) | 950 | 2.9342 | 2.9342 | −36.9752 | raw mesh |

Pinewood’s walk sits 0.1819 m above the origin. The salt-road class band is 1–4 m on the walk datum. That band is an envelope, not a target the blend has to hit. This pilot does not add metres to reach 1.

`hub_approaches` stays 15–40 m on the veil datum, kilometres 40–80, outside the 2000 m patch. The court inherits that band only as W02’s label. No `court_absolute_veil_m` is stored. Veil metres are not added to 39.9094 m. A sum would invent a hill in the 55–80 m range and would violate the W02 pin.

Present scale stays 0.55 m/km (`present_ring_m` 220). `WorldField` scene scale stays 0.4. Neither scale redraws the 42 m disk. A present-scale impostor at 220 m reads raw `h_mesh` and does not import another world’s veil band (the Sundering alpine band stays on Fantasy).

Fall Kill Creek at the origin: `nx = 0.5`, `nz = 0.5`, creek center `0.425`, distance `0.075`, wider than the `0.04` cut. The creek does not enter the disk. The west river zone (`nx < 0.1`, centered x near −800 to −1000) stays a heightmap valley on the patch edge. It is not a W03 body and it is not the civic drain.

## Hydrology degrade

`hub_civic_drain`, `hub_salt_road`, and `hub_approach_ditches` stay kind `none`, `body_id` null, depth 0, `seed` false. Outlet of the civic drain stays `civic_buried`. The salt road’s outlet stays `dry_end` and its trace stays out of `hub_plaza`. Crown egress count stays 8 and those egresses carry no channel. Lake count on the continent stays 0.

`setWater` is the play-patch writer. This pilot calls it zero times. Continental depth 0 contributes 0 to `water_height`. Player-dug water already in `world_water_cells` still flows through `solveFlowStep` on `baseElevation`. A later court query that does call `setWater` or `waterDepthAt` passes corner-frame metres. Rainfall 700–950 mm stays a climate label. Canon weather stays clear. The brass of the court is the palette in `STYLE_Hub.md`. It is not a seeded spring and it has no new prop id in this slice.

The inner veil begins past the approaches. It is not cut through the plaza.

## Climate, biome, resources

Plaza, doors, and wall stay 11–16 °C, 700–950 mm, humidity 0.45–0.60, biome `civic_hardscape`, soil `paving_over_stone`, fertility 0.05 / 0.04 / 0.06. Pinewood stays `pine_verge`, fertility 0.15, resources `hub_pine` and `hub_salt_dust`, quantities null. Approaches stay `road_verge`.

`TreeLayer` scatter inside the 42 m disk stays 0. The density band 0.02–0.08 is the field value. It does not place trees on the paving. Spawn stays `suppress`. The world vegetation scalar is not copied onto `hub_plaza`.

## Pop through physicalization

Headcount, parcel count, coin, and `physicalize` stay null / false on `layout_hub_court`, `layout_hub_wall`, `layout_hub_pinewood`, and `layout_hub_approaches`.

W09 allows a headcount, and W10 used that allowance at Sangree. This pilot leaves the census null because the court walk is the heightmap the client already draws. A headcount here would be the gate that sets `physicalize` true, and `physicalize` true is what lets `SettlementCompiler.Compile` stamp districts. Stamping the court again would stack a second plaza on Flower Law. The 3–5 NPC sprinkle and `MAX_NPCS_PER_REGION` 5 stay as they are. Bias `relative` 1.0 on `hub_plaza` stays a within-world rank, not a census. `WorldGeography.PopulationFor` (30–900) stays a local-metre pin, not this headcount.

`dist_hub_market` food stays `import_only`. No farm site is added. The continent’s one farm remains `farm_masond_landings`. Coin stays null because no ledger row was read. `hub_cut_stone` quantity stays null.

`road_hub_flower_ring` and `road_hub_door_ring` stay class `ring`, `length_km` null, `cites_edge` null, `paved` false. The W09 pavement rule would allow a later true. This pilot leaves them false so the degrade does not pretend to repave the disk. The eight gate edges stay finished as W05 left them and are not retimed. Plaque time stays 2 minutes. That minute count is the atlas step. It is not 400 km and it is not the 220 m present jog.

## Bill of materials

Existing catalog ids only. `prompts_index_rows_added` is 0. Instance counts from this slice are 0. The court is already the live Hub.

| Where | Id | Count from this slice | Why this id |
| --- | --- | --- | --- |
| Flower Law | `env_hub_flower_law_urn` | 0 | Already the SoftEnter landmark. The urn is not a water source. |
| Ring of Doors | `env_hub_ring_door` | 0 | Eight plaques. No ninth. |
| Pinewood | `env_hub_pinewood_milepost` | 0 | Lettering stays “Pinewood Crossing”. |
| Arena | `arch_hero_hub_arena_gate` | 0 | Steel exception, radius 8 m, center (0, 18). |
| Unity ids already on the layout | `council_chamber`, `archive_quarter`, `market_district`, `warden_ring_wall` | 0 | W08 aliases. `Compile` is not called. |

`WorldStreamManager` remains the only queue. A later enqueue, after a pilot that has actually set `physicalize` true, may submit cell kind `Settlement` for court districts while the player is inside the existing stream window. Until then the keep is the blend radius only. `CellMeters` 64, `BudgetMs` 3.5, `PrefetchAheadM` 120, `hub_keep_m` 125, stream-in 175, stream-out 360 stay as shipped. This file does not submit the job.

## Concord integration (extend, do not replace)

| Target | What the pilot names | Leave in place |
| --- | --- | --- |
| `server/lib/world-terrain.js` `renderedElevationAt`, `sampleRenderedHeight` | Centered walk sample. Flatten is a reader. | Seed `0xc0ffee`, 2000 m, max 80 m. Do not add veil metres. Do not encode 42 as elevation. |
| `server/lib/terrain-deformation.js` `baseElevation`, `cellOf` | Corner frame. Court queries add 1000 m before the call. | `CELL_SIZE` 10. Do not swap in `sampleRenderedHeight` inside `baseElevation`. |
| `server/lib/terrain-water.js` `setWater`, `solveFlowStep`, `waterDepthAt` | Play-patch flow. Continental bodies contribute depth 0. | Do not seed the plaza, the salt road, or the west river valley. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | Later filter may require `layout_hub_court`. | Cap stays 5. Heartbeat frequency 240. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | A later move target may be this `layout_id`. | Expansion adds no district and no kingdom. Frequency 200. Hub territories stay empty. |
| `server/lib/npc-economy.js` `dispatchEconomicAction` | A later price key may be `dist_hub_market` as import food. | Coin stays null until a ledger row exists. Frequency 8. |
| `SettlementCompiler` | Unity district ids stay the W08 aliases when a binder runs. | Do not call `Compile` from this spec. |
| `createBuilding` | Web silhouette waits on `physicalize`, which stays false here. | Do not generate a kit. |
| `TreeLayer` | Plaza scatter stays 0 inside 42 m. | Do not copy the world vegetation scalar onto the paving. |
| `WorldStreamManager`, `ContinentStream` | The only streaming bind. `HubKeepM` 125 is the blend outer radius. | Radii and budgets unchanged. |

No file in that table is edited by this slice.

## What this pilot leaves unbuilt

- No edit to terrain, water, deformation, settlement, faction, economy, compiler, or streaming source.
- No 2 km raster, no NavMesh, no street spline, no border mesh, no new prompt row, no image.
- No stored court absolute on the veil datum, no seeded civic drain, no plaza river, no lake.
- No headcount, no parcel count, no Concord Coin, no pavement flip, no `physicalize` true.
- No second Hub city, no ninth gate, no Hub kingdom, no farm, no mine.
- Arena dish depth stays null. Salt-road class minimum is not forced onto the walk.

## Living loop

The heartbeats stay at their registered frequencies. Field channels stay as W02–W04 left them. A building still does not change continental elevation. Rainfall still does not redraw the civic drain. `economy-anomaly-cycle` stays observe-only. The degrade is a read rule for a later binder: centered sample, flatten inside 42 m, smoothstep out to 125 m, corner-frame translation before any water cell, continental depth 0.
