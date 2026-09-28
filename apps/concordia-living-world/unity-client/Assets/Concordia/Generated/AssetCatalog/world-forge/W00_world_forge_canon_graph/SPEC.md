# W00 — World Forge G0 canon graph

**Slice:** `W00_world_forge_canon_graph`  
**Phase:** G0 (World Field). Text and JSON only.  
**Machine file:** `SPEC.json` (`concordia-world-forge-canon-graph/1.0`).  
**Sources:** `lookfeel/MAP_MASTER.json`, `lookfeel/geography/GEO_*.md`, `GEOGRAPHY_INDEX.json`, `WORLD_FORGE_GEO_CIV_AUDIT.md`.  
**Honesty:** Kilometres below are copied from the megaworld atlas or marked `design_intent`. Claim circles in `countries.json` (about 18–28 local metres) are politics, not this graph. Unplaced names stay `coordinates: null`. No census, no ore tonnage, no mesh prompts.

Fantasy is the Sundering (`world_id` stays `Fantasy`). Flower Law is the Hub disk of **42 local metres**. There is no Vinewood, no ninth Link door, and no Hub kingdom.

## What this stage is

Layer 0 of World Forge: a geographic **constraint graph** the later stages must consume. It does not generate elevation, rivers, biomes, kingdoms, or cities. A generator that ignores a rule in `constraints[]` is wrong even if the picture looks plausible.

Pipeline order, sacred, and the only order `SPEC.json` `pipeline` allows:

Elevation → Hydrology → Climate → Biome → Resources → Mobility → Suitability → Civ → Pop → Economy → Growth → Infra → Physicalization

Each stage reads the previous stage’s field plus this graph. None of them may invent a landmass, a river, a capital, or a road that the graph forbids.

## Data model

| Object | Role |
| --- | --- |
| `frames` | Four coordinate books. Do not add them. |
| `worlds[]` | Ten discs. Center, radius, climate tag, neighbors. |
| `worlds[].regions[]` | Named sectors with terrain affinity, water dependency, resources, architecture kit, population bias, trade nodes. |
| `trade_graph[]` | Atlas links (gate, road, sea, walker, weak). Mobility reads this. It does not resample it. |
| `constraints[]` | Hard rejects for G1–G6. |
| `integration` | Real Concord files this graph extends. |

### Frames

| Frame | Unit | Use |
| --- | --- | --- |
| `megaworld_km` | kilometres from Hub origin, +x east, +z north | Disc centers, Crown Roads, marches, Exodus gaps. |
| `hub_canon_metres` | metres on the Hub | Flower Law 42, Ring of Doors 34, wall 56, arena, Pinewood (62, −28). |
| `present_metres` | 0.55 m per atlas kilometre; Canon Ring drawn at 220 m | What the player jogs. Not travel time. A Link is 2 minutes of plaque, not 400 km. |
| `local_claim_metres` | per-world claim plane | `countries.json` circles, Fluxom Gate (62, 18) on Tunya, Ruins envoy pin. Never promote these into kilometres. |

Hub metro **40 km** and court **12 km** are authored (`HubMetroKm`, `HubCourtKm`). Spoke discs of **110 km** and the Sere disc of **80 km** are `design_intent_disc`. Approaches from 40 km to about 80 km are design-intent before the Crown Road enters the open ring.

## Fields each region must carry

- **terrain_affinity** — elevation class the continental generator (G1) is allowed to express. Qualitative. No heightmap in this file.
- **water_dependency** — what hydrology (G2) may place. `forbidden` is as load-bearing as `required`.
- **resources** — named loci only. `quantity` is null. G3 may score these; it may not invent a deposit the region does not list.
- **architecture** — existing catalog kit id plus a grammar phrase. Physicalization uses the kit. This slice does not author meshes.
- **population_bias** — ordinal from the geography prose (`plaza_peak`, `track`, `block`, `empty_then_post`, `pocket`, `shift`). `relative` is a design-intent rank inside that world, not a headcount.
- **trade_nodes** — ids that also appear on `trade_graph` or as civic hearts. Economy attaches here. It does not spawn a second port.

## Pilot numbers (design-intent unless marked authored)

Copied from `MAP_MASTER.json` so G4 mobility costs have one table.

| Measure | Value | Authority |
| --- | --- | --- |
| Canon Ring radius | 400 km | authored megaworld |
| Present scale | 0.55 m/km, ring 220 m | authored presentation |
| Spoke disc / Sere disc | 110 km / 80 km | design-intent |
| Neighbor chord of spoke centers | 306.15 km | derived from ring geometry |
| Open march between 110 km disc edges | 86.1 km | design-intent |
| Walk model | road 5, walker 3.5, coastal sea 15, barge 20, Exodus 12, waystone 3 km/h | authored atlas time |
| Crown Road center to center | 400 km, 4800 min at 5 km/h | design-intent road under the Link |
| Link plaque | 2 min | authored; not the 220 m jog |
| Ring march (road) | 1033 min for 86.1 km | design-intent |
| Walker Path (Tunya–Frontier, Frontier–Crime) | 1476 min | design-intent |
| Inner Veil shoal (Tunya–Sundering) | 86.1 km at 15 km/h, 344 min | design-intent |
| Iron river lane (Crime–Dawn) | 86.1 km at 20 km/h, 258 min | design-intent |
| Crime–Sere strait | center 214.0 km; water gap about 24 km; 96 min | design-intent |
| Dawn–Sere coastal leg | water gap about 54.8 km; 219 min | design-intent |
| Frontier–Sere long Exodus | water gap about 329 km at 12 km/h; 1645 min | design-intent |
| Waystone Crime–Sere | 480 min at 3 km/h | authored as a mark, not a door |
| Unclosed seam Crucible–Grid | 1476 min, kind `weak` | authored presentation |
| Sere center | (−227.76, −489.62) km, bearing 245.05°, factor 1.35 on Crime’s angle + 0.35 rad | authored placement, disc radius design-intent |
| Flower Law / doors / wall / arena | 42 m disk; doors 34 m; wall 56 m; arena (0, 18) m, steel radius 8 m | authored Hub metres |
| Pinewood Crossing | (62, −28) m, about 68 m from origin, outside the wall and outside Flower Law | authored |

Sector offsets inside Tunya (Masond, Asbir, Sangree, Aekon, Fluxom, Nil) are the design-intent kilometres in `GEO_Tunya.md`. They are not the overlapping claim circles.

## Concord integration (extend, do not replace)

| Target | What it does today | What G0 gives it | What not to do |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` `terrainSpec` / `generatePoughkeepsieHeightmap` | One Hub/Poughkeepsie heightmap. Fixed seed `0xc0ffee` for every world. `hashSeed(worldId)` is reserved and **not** consumed by the rendered grid. | Per-world elevation **class** and forbidden landforms. G1 may add a continental field beside this profile. | Do not retune the fixed seed or swap this function for a random continent. `terrain-deformation.js` `baseElevation` already delegates to `renderedElevationAt`. |
| `server/lib/terrain-water.js` | Local 4-neighbour flow (`FLOW_RATE`, `setWater`, `tickWaterFlow`) on the cell grid. | Which discs may have a river, a spout, a flood, or no channel. G2’s watershed graph may **seed** `setWater`. | Do not add a second flow solver. Do not cut a river through the Hub plaza. |
| `server/lib/procgen-settlements.js` and `server/emergent/procgen-settlement-cycle.js` | Fills a procgen region with 3–5 NPCs and a Living Society `settlements` row. Heartbeat `procgen-settlement-cycle` at frequency 240. | Named hearts and population ordinals so a later suitability pass can **choose** regions. | This is not a city physicalizer. Do not replace `spawnSettlementForRegion`. |
| `server/lib/embodied/faction-strategy.js`, `server/domains/faction-strategy.js`, `server/emergent/faction-strategy-cycle.js` | Stance machine and moves (`DECLARE_WAR`, `RAID`, alliances) on authored factions. | A place a move can be **about** (a named region, a march, a strait). | Do not mint kingdoms from noise. Hub `WorldGeography.Territories(Hub)` stays empty: the Hub has no kingdom. Claim-plane factions (Iron Coast bills, Dawn task force, Sere Tally House, Tunya countries) stay on `local_claim_metres`. |
| `concord-frontend` procedural buildings and TreeLayer (consumers of `hashSeed` / biome) | Local meshes and trees. | Architecture kit id and flora budget (Grid: weed and moss, not a forest). | Do not generate a new kit in G0. Kits already named in the asset catalog stay the ids. |
| Unity `WorldGeography` | Routes, borders, Hub settlements. | This graph is the atlas those routes must agree with when a later slice binds them. | Do not add a Hub territory. Do not treat Present metres as the Crown Road. |

World ids in this graph are the atlas ids (`Hub`, `Cyber`, `Ruins`, `Fantasy`, `Tunya`, `Frontier`, `Crime`, `Superhero`, `Crucible`, `Sere`). Binding them onto Concord `world_id` strings is a later slice. G0 does not rename `Fantasy`.

## Per-world constraint (short)

Detail is in `SPEC.json`. This is the reject list a generator must pass.

**Hub.** Flat court. Civic drain only. No mountain, no river capital. One city-state; districts are rings. Density peaks on the plaza and thins to road-and-verge. Eight Crown Roads leave the approaches. Steel inside 42 m presents as a flower except arena sand.

**Sundering (`Fantasy`).** Wildwood (lower, west of center), fold and waterfall (mid), alpine rim (north). Salt toll on the drier south road. Inner Veil shoal on the southwest coast toward Tunya. Not a lake country. Titan pillar is a landmark, not a range. House Voss is a stair fragment, not a flying castle. East march meets Ruins as moss against ash; kits do not blend into a fourth grammar.

**Tunya.** Six design-intent sectors: Masond cliffs and one river, Asbir dunes and buried vault, Sangree ore and one stack, Aekon glacier and warm hold, Fluxom harbor and dye lock, Nil wet canopy and one lichen. Terraces connect them. Fallback names (Dinye, Sahm, Bahiij, Akeia, Vessine, Corre, Dormas, Vrellan, Sandrun) inherit terrace grammar and have **no** kilometres here. Unplaced: Hold of First Arrival, twelfth lip, sky temple, quiet quarter, tide temple, old Fluxom harbor, ancestor caves. GoldenSlice remains the only forge that crafts. No ice spell.

**Sovereign Ruins.** Forum on a cracked flat. One spout, dry channel under the rib until rain. No lake, no lava tube. Catalogue, do not conquer. Envoy pin stays local metres.

**Iron Coast (`Crime`).** Low tenements, river and harbor on the Exodus side. Rain is climate, not a flood apocalypse. Short strait to Sere. Uncounted Wharf is the march toward the Grid. Politics stay on the claim plane. Wing Chun is the people’s style; that is culture, not a terrain field.

**Grid (`Cyber`).** Stacks up, Under-District a few metres down, sky-bridges as mid-air roads. Alley drainage, no pastoral river. Highest ring density after the Hub plaza; flora budget is weed and moss. Unclosed seam toward the Crucible is walkable and unfinished.

**Frontier.** Flats, a drift gap, a dry rut. No mesa, no dome, no river the Walker Paths follow. A cottonwood marks where water was. Long empty, then a post. Last Dome stays “one mile past the frontier gate” and this graph does not convert the mile. The Road That Followed stays unplaced.

**Permanent Dawn (`Superhero`).** Skyline, roof pads, arterials, ground parks. Kane’s fin is the tall read. North river lane toward the Coast. No sacred lake, no victory statue as the heart. The Held Crown Stair toward the Sundering is a glue kit across the Hub, not a shared land border.

**Crucible.** Folded basalt, a fault, a road that ends. Water may refuse to fall. No pretty river city. Lattice heart and foundry edge only. No ninth district, no closed capital. People are few; drift masses are not populations. Northeast seam toward the Grid stays `weak`.

**Sere.** Off-ring wound. Ten named regions, roles only, no invented kilometres. Low and drowned toward the south and west of the disc, highland windier, furnace belt industrial-flat. Exodus outside. Waystone on the Crime-facing coast is a mark, not a portal. Build on existing pads. Repair is the history. The Tally House is a political name on the claim plane, not a kilometre capital.

## Outputs for the next stage (G1 continental generator)

G1 reads `worlds[].regions[].terrain_affinity`, `constraints` with `stage: elevation`, disc centers, and radii. It writes an elevation field in `megaworld_km` whose classes match the affinity tags. It does not place rivers (G2), biomes beyond the climate tag (G3), settlements (suitability), or faction polygons (civ).

G1 must also emit the **march** ground between discs (86.1 km open, or sea where `trade_graph.kind` is `sea`) so worlds are not floating islands. The Inner Veil and the Exodus are the seas already named in the atlas. They are not a new ocean.

## What not to build yet

- No heightmap, watershed raster, biome raster, or road mesh.
- No city block-out, no pretty capitals, no procedural kingdom names.
- No retune of Flower Law, mob caps, `enc_outstanding`, or asset batches B21–B31.
- No change to `PROMPTS_INDEX.json`.
- No Unity scene edits and no server code in this slice. Integration targets are named so Aura and Cursor extend them in G1+.

## Validation a later binder can run

1. Exactly ten `world_id`s, Sere `gate` null, eight spokes with Link gates.
2. Every `trade_graph` endpoint is a world id in the ten.
3. Every non-null region `architecture.kit_id` is one of the kit ids already in the asset catalog. Tunya kits are null on purpose.
4. Every region with `coordinates: null` is either fallback, unplaced, or a Sere role. A binder that fills those nulls has left G0.
5. `constraints[].id` `no_vinewood`, `flower_law_42m`, `fantasy_is_sundering`, `no_hub_kingdom`, `sere_not_a_gate` are present.
