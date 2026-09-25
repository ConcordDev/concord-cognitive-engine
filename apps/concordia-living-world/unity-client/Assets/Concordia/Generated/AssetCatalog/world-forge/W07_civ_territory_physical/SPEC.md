# W07 — Civilization territory physicalizer

**Slice:** `W07_civ_territory_physical`  
**Phase:** G4c (civilization geography). Population, economy, growth, infrastructure, and mesh physicalization wait.  
**Batch:** `WF4_territory`  
**Machine file:** `SPEC.json` (`concordia-world-forge-territory/1.0`).  
**Consumes:** `concordia-world-forge-suitability/1.0`, and through it transport, biome-resource, hydrology, continental, field schema, and the canon graph.

Pipeline order places civilization after suitability and before population. This stage attaches **existing Concord factions** to **named W06 regions** and emits a closed site table: borders, capitals, mines, farms, ports.

It does not allocate the 2 km grid, does not write a W01 field channel, and does not found a settlement. `spawnSettlementForRegion` still waits. A high suitability score is not a kingdom. A `countries.json` circle is not a surveyed border.

`world_id` Fantasy stays the Sundering. Flower Law stays a 42 m horizontal disk. Sere stays off `Canon.Gates`. The Crucible–Grid seam stays unfinished. The place-name forbidden by W00 `no_vinewood` is not a realm id.

## What this stage is

Suitability already labeled how livable each named pad is. Civilization answers: **which authored faction may sit on that pad, and which physical sites that sitting is allowed to be.**

The product is a site table, not a map:

- 7 capitals, every one `kingdom: false`
- 10 borders (9 atlas disc-pairs plus one Tunya terrace seam)
- 3 mines
- 1 farm
- 4 port records (3 that may be walked later, 1 Sere pier that stays a role)

Zero new kingdoms. The 70 `countries.json` rows (radii about 18–28 local metres; Hub has no countries file) stay on `local_claim_metres`. The 85 faction records under `content/world/**/factions.json` stay the name list. A faction that is not in `realm_bind` below gets no kilometre site.

`WorldGeography.BuildTerritories` already turns each country row into a `KingdomTerritoryDef` disc and a 10-gon. That disc is the claim plane this slice refuses to promote. A later binder does not add discs, and it does not move those centers into veil kilometres.

## Inputs

| Site kind | Reads | Does not |
| --- | --- | --- |
| Capital | W06 `tier` in {city, town}, `cannot_found`, `faction_holder`, vetoes `no_ninth_district`, `catalogue_not_conquer`, `no_victory_heart`, `no_hub_kingdom` | Mint a crown because a faction file exists. Treat `hub_doors` as a second city. Close a Crucible capital. Lift Sangree Fire Forge (−4.43, −65.85) local metres into kilometres. |
| Border | W05 atlas edge ids and `finished`. Tunya’s six stamped sectors. | Treat overlapping claim circles as a surveyed line. Pave `seam_crucible_cyber`. Draw `dawn_crown_stair_glue` as a land border. Add a ninth Link. |
| Mine | W04 locus id on that `region_id`, predicate ore / salt / scrap | Invent a deposit. Set `quantity`. Mine `ruins_cold_iron` (archive iron). Mine `aekon_ice`. Quarry `hub_cut_stone` inside Flower Law. |
| Farm | W04 fertility and W06 food vetoes | Farm the plaza. Clearcut Nil. Retcon `sere_breadlands` into a breadbasket. Plant Dawn parks or Crime tenements as fields. |
| Port | W05 port records with `adds_port_city: false` | Add a harbor city. Promote `edge_cyber_crime` to a chord. Treat the waystone or `node_sere_delta` as a port. Put a harbor on the Dawn shore. |

W06 holder aliases are corrected here to file ids. The alias is not a second faction.

| W06 holder id | File id | Where the file lives |
| --- | --- | --- |
| `concordant_assembly` | `concordant_assembly` | `content/world/concordia-hub/factions.json` |
| `zero_collective` | `zero_collective` | `content/world/cyber/factions.json` |
| `catalogue_keepers` | `ruins_archivists` | `content/world/sovereign-ruins/factions.json` |
| `wildwood_circle` | `wildwood_circle` | `content/world/fantasy/factions.json` |
| `verdant_veil` | sector ids below, not `verdant_veil_remnant` | `content/world/tunya/factions.json`. The remnant in `content/world/factions.json` gets no disc. |
| `delgado_syndicate` | `iron_rose_syndicate` | `content/world/crime/factions.json`. There is no faction id `delgado_syndicate`. Mama Delgado is this syndicate. |
| `dawn_civic` | `superhero_civic_super_taskforce` | `content/world/superhero/factions.json` |
| `unclosed_foundry` | `crucible_lattice_engineers` | `content/world/lattice-crucible/factions.json` |
| `tally_house` | `the_tally_house` | `content/world/sere/factions.json` |

Tunya sector binds, each a real faction id, each a W00 region, none of them a new kingdom:

| Region | Faction id | Country row |
| --- | --- | --- |
| `tunya_masond` | `masond` | No `country_id`. GEO says so. The sector seat does not need a claim circle. |
| `tunya_asbir` | `asbir` | `asbir` circle stays local metres. |
| `tunya_sangree` | `sandrun_sanguire` | `country_id` `sangree`. Capital name “Sangree Fire Forge” stays on the claim plane. |
| `tunya_aekon` | `aekon` | Circle stays local. Hamlet. No seat, no mine. |
| `tunya_fluxom` | `fluxom` | Fluxom Gate (62, 18) m stays `tunya_local_metres`. |
| `tunya_nil` | `nil` | Circle stays local. `no_clearcut`. No farm. |

These Tunya ids get no seam and no site. Some are country rows, some are faction ids only: `dinye`, `sahm`, `bahiij`, `akeia`, `vessine`, `corre`, `dormas`, `vrellan_nationalists`, `ancient-tunyan-ruins`, `cactem-strip`.

## Algorithm

Run in this order. No step writes elevation, water, biome, fertility, a road polyline, or a faction row.

1. **Copy the region.** `region_id`, `world_id`, `tier`, `cannot_found`, `stamp_cells`, `type_hint`, `parent_region_id` come from W06 unchanged.
2. **Bind the faction.** Replace the W06 alias with the file id in the table above. If the region has no bind, `faction_id` is null. Do not pick the next countries.json row to fill the hole.
3. **Capital test.** Emit a capital only when all of these hold: tier is `city` or `town`; `cannot_found` is false; a file id is bound; the region is not under `catalogue_not_conquer`, `no_ninth_district`, or `no_victory_heart` as a **conquest** or **closed** capital; the ordinal is not `exhausted`, `shift`, `unplaced`, `claim`, or `claim_plane`. Set `kingdom: false` on every row. `no_victory_heart` still allows a skyline seat at `dawn_kane`. It forbids a victory statue and it forbids giving `luminary_empire` that seat.
4. **Border test.** Emit one record per atlas disc-pair already in W05, copying edge ids and `finished`. Emit one Tunya terrace seam across the six sector ids, with no coordinates. Do not emit a border for a claim-circle overlap, for Flower Law, for the 56 m wall, for a Crown Road (those leave the Hub; they are not a second realm), or for `dawn_crown_stair_glue`.
5. **Mine test.** Emit only `sangree_ore`, `asbir_salt`, and `crucible_scrap`. `quantity` stays null. `ruins_cold_iron`, `aekon_ice`, `hub_cut_stone`, `cyber_cable_salvage`, `sere_furnace_iron`, and `sere_headframe` stay notes, not mines.
6. **Farm test.** Emit `farm_masond_landings` on `tunya_masond` terrace landings only. Cliff face excluded. Every other food path fails a veto or is import food, a park, a tenement, a cottonwood, or exhausted stubble.
7. **Port test.** Emit the three W05 harbors that already have nodes, plus the Sere pier as `physicalize: false`. `adds_city` stays false on all four. Waystone, delta node, and Dawn coast emit nothing.
8. **Co-presence.** Other factions in the same world’s `countries.json` are listed on the capital or the border as `claim_plane_only`. They do not receive a second site of the same kind.

Impassable pads store no site. They do not store a placeholder kingdom with radius 22.

## Capitals (design-intent seats, not crowns)

| Id | Region | Faction file id | W06 tier | Role |
| --- | --- | --- | --- | --- |
| `cap_hub_court` | `hub_plaza` | `concordant_assembly` | city | City-state court. Flower Law 42 m. Import food. Civic drain. `WorldGeography.Territories(Hub)` stays empty. |
| `cap_cyber_stacks` | `cyber_stacks` | `zero_collective` | city | Borough heart. Sky-bridges are built relief, not a realm outline. |
| `cap_crime_sodium` | `crime_sodium` | `iron_rose_syndicate` | city | Block heart. Wing Chun is culture, not a border. Rain is climate, not a flood. |
| `cap_dawn_kane` | `dawn_kane` | `superhero_civic_super_taskforce` | city | Skyline heart. Kane’s fin. No victory statue. `luminary_empire` is not this seat. |
| `cap_tunya_masond` | `tunya_masond` | `masond` | town | Sector hold on cliff landings. No country row to promote. |
| `cap_tunya_sangree` | `tunya_sangree` | `sandrun_sanguire` | town | Forge hold. GoldenSlice remains the only crafting forge. The countries.json forge pin stays local metres. |
| `cap_tunya_fluxom` | `tunya_fluxom` | `fluxom` | town | Harbor hold. The lock is the harbor. Not a second city on top of the port. |

`hub_doors` stays a district of `cap_hub_court`. Parent remains `hub_plaza`.

### Seats this pass refuses

- `ruins_forum` is an archive town (`ruins_archivists`, catalogue, not a conquest capital).
- `sunder_wildwood` and `sunder_fold` stay villages. `house_voss` is a stair fragment on the fold, not a capital and not a flying castle. `fantasy_obsidian_crown` and the other six Sundering country rows stay 25.5 m claim circles.
- `tunya_aekon` is a hamlet. Ice is not a seat. `tunya_nil` is a listening grove. `tunya_asbir` is a village with a salt pan, not a capital. Fallback names stay unplaced or kilometre-less.
- `frontier_hitch` is a post. `frontier_drift` is a cottonwood. No Frontier capital. `frontier_pioneer_alliance` and the other five Frontier countries stay claim circles.
- `crucible_lattice` and `crucible_foundry` are villages. No closed capital. No ninth district. The other five Crucible countries stay claim circles.
- Every Sere region. `the_tally_house` stays claim-plane on `sere_old_capital`. `the_tessera`, `house_aldermere`, and `the_clearing_spire` are not kilometre capitals.
- `dawn_arterials` is not a second Dawn city. `cyber_under` is service. `cyber_wharf_march` is not a port city.

## Borders

A border is an atlas edge or the one terrace seam. It has no new polyline.

| Id | Edges (copied) | Sides | Finished |
| --- | --- | --- | --- |
| `border_cyber_ruins` | `march_cyber_ruins` | `zero_collective` / `ruins_archivists` | yes |
| `border_ruins_fantasy` | `march_ruins_fantasy` | `ruins_archivists` / `wildwood_circle` | yes. Moss stays on the Sundering. Ash stays on Ruins. Not a fourth kit. |
| `border_fantasy_tunya` | `march_fantasy_tunya`, `sea_tunya_fantasy` | `wildwood_circle` / Tunya sectors, sea side meets `fluxom` | yes. Not one Tunya kingdom. |
| `border_tunya_frontier` | `walk_tunya_frontier` | Tunya sectors / no Frontier capital | yes. Walker. Not a river. |
| `border_frontier_crime` | `walk_frontier_crime` | no Frontier capital / `iron_rose_syndicate` | yes |
| `border_crime_dawn` | `march_crime_superhero`, `sea_crime_superhero` | `iron_rose_syndicate` / `superhero_civic_super_taskforce` | yes. Barge lane is not a second port on Dawn. |
| `border_dawn_crucible` | `march_superhero_crucible` | task force / `crucible_lattice_engineers` | yes |
| `border_crucible_cyber` | `seam_crucible_cyber` | engineers / `zero_collective` | **no**. `march_crucible_cyber` stays off the pathfinder. |
| `border_crime_sere` | `sea_crime_sere`, `waystone_crime_sere` | `iron_rose_syndicate` / `the_tally_house` on the claim plane | water yes, gate no. Waystone is a mark. 96 minutes and 480 minutes stay W05’s clocks. |
| `border_tunya_terrace` | none (no kilometres) | `masond`, `asbir`, `sandrun_sanguire`, `aekon`, `fluxom`, `nil` | seam between stamped sectors only |

`edge_cyber_crime` is not in this table. The Grid wharf is a port inside `cyber_wharf_march`, not a chord to the Iron Coast.

These are not borders: Flower Law 42 m, the Hub wall at 56 m, Pinewood (62, −28) m, eight Crown Roads, `dawn_crown_stair_glue`, any of the 70 claim discs, a player standing in two Tunya circles (that is a claim conflict on the local clock).

## Mines

`quantity` is null on all three. Design-intent presence only.

| Id | Locus | Region | Faction | Note |
| --- | --- | --- | --- | --- |
| `mine_sangree_ore` | `sangree_ore` | `tunya_sangree` | `sandrun_sanguire` | One stack face. The forge seat is not a second mine. |
| `mine_asbir_salt` | `asbir_salt` | `tunya_asbir` | `asbir` | Salt pan on the dune. Wadi stays dry. Village, not a capital. |
| `mine_crucible_scrap` | `crucible_scrap` | `crucible_foundry` | `crucible_lattice_engineers` | Scrap yard at the road’s end. Not a ninth district. Seam stays unfinished. |

Not mines: `ruins_cold_iron` (archive), `aekon_ice` (no ice spell), `hub_cut_stone` (plaza stone, not a quarry camp), `cyber_cable_salvage` (built salvage), `nil_lichen` (one lichen under `no_clearcut`), `sere_furnace_iron` and `sere_headframe` (`stamp_cells: false`).

## Farms

| Id | Region | Faction | Where |
| --- | --- | --- | --- |
| `farm_masond_landings` | `tunya_masond` | `masond` | Terrace landings beside the one realized river. Not the cliff face. Not a clearcut. |

Refused farms: `hub_plaza` and `hub_doors` (import food, Flower Law), `tunya_nil` and `tunya_fallback` (`no_clearcut`), `sere_breadlands` (exhausted stubble, not a breadbasket), `sere_flooded` and `sere_delta` (`cannot_found`), `frontier_drift` (cottonwood), Crime tenements, Dawn parks, Crucible sheet.

## Ports

All four keep `adds_city: false`.

| Id | Node already on W05 | Region | Faction | Physicalize |
| --- | --- | --- | --- | --- |
| `port_fluxom` | `node_fluxom` | `tunya_fluxom` | `fluxom` | Later, on the lock. Same hold as `cap_tunya_fluxom`, not an extra city. Fluxom Gate (62, 18) m is not this port. |
| `port_crime_wharf` | `node_wharf` | `crime_wharf` | `iron_rose_syndicate` | Working river and barge. The 24 km strait is `border_crime_sere`, not this wharf’s polygon. Town tier. Not a second capital. |
| `port_cyber_march` | `edge_cyber_crime` as the march node, water `cyber_wharf_meet` | `cyber_wharf_march` | `zero_collective` | Harbor is the march. Village. Not a chord to Crime. No pastoral river. |
| `port_sere_pier` | `node_sere_pier` | Sere coast role | `the_tally_house` claim plane | `physicalize: false`. `stamp_cells: false`. Not a Link. |

No port: `node_sere_waystone`, `node_sere_delta`, Dawn coast (`node_kane` is the heart), Hub civic drain, Sundering salt road.

## Clocks (unchanged)

| Clock | Territory may |
| --- | --- |
| Plaque, 2 minutes | Leave access on Hub doors. Never convert a plaque into a capital or a border length. |
| Atlas minutes | Copy them onto the border row that cites that edge. Do not retime. |
| Present 0.55 m/km | Leave `WorldGeography` waypoints. Do not feed them into realm radii. |
| Hub canon metres | Price Flower Law 42, doors 34, wall 56, Pinewood, arena. None of these are faction borders. |
| Local claim metres | The only legal plane for the 70 country discs, Fluxom Gate, the Ruins envoy pin, and the Tally House. |

## Concord integration (extend, do not replace)

| Target | Today | What G4c names | Leave in place |
| --- | --- | --- | --- |
| `server/lib/world-terrain.js` `renderedElevationAt`, `generatePoughkeepsieHeightmap` | Hub/Poughkeepsie heightmap, seed `0xc0ffee`. `hashSeed(worldId)` reserved. | Sites name regions. They do not sample this heightmap for a border. | Do not retune the seed. Do not draw a realm on the walk patch. |
| `server/lib/terrain-water.js` `solveFlowStep`, `setWater`, `tickWaterFlow` | Local 4-neighbour flow. | Ports cite W03/W05 water ids. | Do not seed flow from a port. Do not wet the plaza. The Masond river stays the one realized Tunya river. |
| `server/lib/procgen-settlements.js` `spawnSettlementForRegion` | 3–5 NPCs and a Living Society `settlements` row. Heartbeat `procgen-settlement-cycle` frequency 240. | A later bind may spawn only where W06 `cannot_found` is false. A capital flag is not that bind. | Do not spawn a kingdom, a mine camp, or a farm from this table. `MAX_NPCS_PER_REGION` stays. This is not a city physicalizer. |
| `server/domains/procgen-settlements.js` | Read surface. | Same gate. | No second identity table. |
| `server/lib/embodied/faction-strategy.js` `pickMove`, `applyMove` | Stance machine. Moves include `DECLARE_WAR`, `RAID`, `PROCLAIM_EXPANSION`. | A move’s `target` may be a `site_id` or `region_id` already in this table. Expansion does not create a site. | Do not mint a faction. Do not let `PROCLAIM_EXPANSION` invent a kingdom polygon. Hub territories stay empty. |
| `server/domains/faction-strategy.js`, `server/emergent/faction-strategy-cycle.js` | Domain and heartbeat. | Same target rule. | |
| Unity `WorldGeography.BuildTerritories` | One `KingdomTerritoryDef` per country, default radius 22, 10-gon, capital id from `faction_id`. Hub returns an empty list. | Kilometre sites in this file are the civ layer. The 10-gon stays the claim plane. | Do not add countries. Do not delete the claim discs in this slice. Do not fill Hub. |
| `WorldGeography.BuildBordersAndRoutes` | Nine Present-space international roads. | Border rows cite those route ids the way W05 already mapped them. | Do not move waypoints. Do not add `route/concordia-hub/...`. |
| `WorldGeography.Territories` | Empty for Hub. | Stays empty. | |
| `MegaworldMap.HasLinkGate` | False for Sere. | Keep false. | |
| `WorldGate` / `Canon.Gates` | Eight plaques. | Eight. | No ninth. |

Procedural buildings and TreeLayer wait for physicalization. A capital is not a mesh. A farm is not a foliage scatter.

## Outputs for the next stage (population)

Population reads `site_id`, `kind`, `faction_id`, `region_id`, `kingdom`, `physicalize`, and `stamp_cells`. It may place people only on a W06 pad whose tier is hamlet or above and `cannot_found` is false. It uses `population_bias` as an ordinal. It does not read `territory_radius`. It does not give `luminary_empire`, `fantasy_obsidian_crown`, or `the_tessera` a headcount from a claim circle.

Economy, after that, may attach trade to the three physical ports, the Sangree ore face, the Asbir salt pan, the Crucible scrap yard, and the Masond landings. It may not open a market on `port_sere_pier` while `physicalize` is false, and it may not price a claim radius.

Growth may add a structure only on `physicalize: true`. Infrastructure may build only on W05 edge ids already cited here. The unfinished seam takes no pavement.

## Aura / Cursor — what not to build yet

- No city block-out, no parceler, no street spline, no NavMesh, no border mesh.
- No edit to `world-terrain.js`, `terrain-water.js`, `procgen-settlements.js`, `faction-strategy.js`, or `WorldGeography.cs`.
- No new faction files and no new `countries.json` rows.
- No `PROMPTS_INDEX` rows, no meshes, no images, no retune of Flower Law, mob caps, or batches B21–B31.
- No 2 km raster and no new `MAP_MASTER` link.

Pilot counts (design-intent): 7 capitals, 10 borders, 3 mines, 1 farm, 4 port records, 0 kingdoms minted, 70 claim circles left on the local clock, 85 faction records left in place. Forty-four regions unchanged from W06.

## Honesty pins

1. Every `faction_id` on a site is a string in `content/world/**/factions.json`. `delgado_syndicate`, `dawn_civic`, `catalogue_keepers`, `unclosed_foundry`, `verdant_veil`, and `tally_house` are aliases, not file ids.
2. `kingdom` is false on every capital. `kingdoms_minted` is 0.
3. `writes_channels` is empty. Territory is not a field channel.
4. Hub has no territory list. Flower Law stays 42 m. Pinewood stays a crossing, not a realm.
5. Fantasy is the Sundering. House Voss is a stair. No Vinewood.
6. Sere has no Link and no kilometre capital. The pier does not physicalize. The seam is unfinished.
7. A port does not add a city. A claim circle does not become a border. `quantity` stays null.
8. Masond’s farm is landings only. Nil is not a farm. Breadlands stay exhausted.
