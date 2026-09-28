# SLICE REPORT — S13_frontier_geo_mounts_mobs

STATUS: COMPLETE

World: Frontier (display The Frontier). Facet: geo_mounts_mobs. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Floors, mounts, caps, windows, quests, unspawned |
| GEO.json | Primary: floors, mounts, vehicles, eight archetypes, four mini-bosses, three side quests |
| STORIES.md | Law, salt, drift, the Link perimeter, each body, the windows, three backstories |
| AURA_BIND_NOTES.md | Bind order, caps, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S13_frontier_geo_mounts_mobs/`.

## Counts

- Floors with a point: salt lens, 12 m Pinewood exclusion, drift gap plus two shoulders, pale flat, cut plus two rim guards, council hitch. Link Post Alpha and the enclave ridge are placed and capped at 0.
- Mounts: `mount_wagon_horse` cap 2 at the council hitch, lead only. `mount_wind_pronghorn` cap 6 day / 0 night on the pale flat, no tack. S01's horse cap of 2 stays on the Crossing.
- Vehicles: `veh_salt_wagon` hitches the council pair and stops at the exclusion. `veh_frontier_windwagon` crosses the drift with no horse.
- Crowds: 5 road wardens, 2 dome bandits, 1 road bandit. Those are the volume budgets.
- Fauna caps: wolves 3 on the drift, horses 2 at the council, pronghorn 6 by day on the pale flat.
- Mini-bosses: 4. `enc_chevron_morning` and `enc_canvas_dive` are new windows on the drift gap. `enc_last_dome` and `enc_road_followed` keep their volume clocks and stay unplaced, so they spawn nothing until their sentences have transforms.
- Side quests: 3. Givers are one council guard, one drift-shoulder guard, and the single road bandit, each inside the crowd budgets. No skill grant. No new item id.
- Volume weights, both Frontier encounter clocks, and S01's Pinewood ecology are cited, not edited.
- Prior Frontier quests left in place: the eight `q_frontier_*` rows and the canon chains those rows extend.

## Law placement

The road is the door. Wind does the rest of what a dome would have done. The salt lens is two country discs sharing 21.54 m, with Pinewood Crossing inside both and excluded from this facet by 12 m. The drift is the 18.71 m neither the Freenodes nor the Couriers own. Horses are led. Pronghorn follow without a bridle. A sail staked into a roof fails the canvas dive. Flower Law stays a Hub disk of 42 m and covers the Hub-ring gate stone at (−34, 0). Country floors are CountryCenter coordinates. Frontier Present at (−220, 0) is the spoke, and this facet does not spawn onto it. People stay CX. Wardens and dome bandits stay Muay Thai. The road-bandit role stays Sword in the catalog file. Steel on these floors stays live.

## Honesty gaps

- Canon `creatures.json` still lists `dust_courser`, `rail_vulture`, and `thunder_yak`. None of those ids exist in the native bible. This slice spawns the bible bodies or nothing. It does not delete the Canon sentences.
- Canon fauna aliases are `hound` and `wolf`. Taxonomy's Frontier row is dust wolf, horse, pronghorn, and domebreaker. `hound` resolves to nothing. `wolf` resolves to `faun_dust_wolf`.
- `enc_last_dome` names a mile past the frontier gate. `enc_road_followed` names a wagon mile between hitching rail and verge. Neither sentence is a coordinate. Both windows spawn nothing until placed. The drift gap is not a substitute.
- `hyb_dustgriffin` bible spawn says mesas. No mesa is placed. The dusk window proposes the drift gap. A binder that requires the word mesa spawns nothing. Catalog `hostile` stays false.
- Named sets `wagon_yard`, `wind_camp`, and `broken_dome_rib` have kit names and no Canon point. District names `ambush_corridor_seven`, `frontier_perimeter`, and the others listed in `GEO.json` are the same. The Mesh Gate's geographic center is lore. The six-capital average (22.91, −1.58) is arithmetic, not the plaque.
- `frontier_militia` has no country disc. Zara Morn's schedule location has no x,z. She is not spawned. Her rifle sentence and the pioneer rifle preference stay unmeshed.
- Role faction strings `open_road` and `road` are not the canon country ids. The argument quest writes +1 once into `frontier_couriers_guild`. No third book.
- `npc_role_frontier_guard` names weapon `wpn_pole_frontier_wagoniron`. The weapon row that exists is `wpn_2h_frontier_wagoniron`. The role file was not edited.
- The frontier kit's `culture` field says `grove`. The kit file was not edited.
- Country climate logs wind as low on every disc. WorldDef weather is wind. The drift gap is where this facet lets the law read as weather. Climate rows were not edited.
- Health for the three roles is absent from `ROLES.json`. No hit points were invented. Creature health stays the table names already on the rows.
- `day_index` is the volume day counter. This slice does not define a new clock service.
- Hidden truths in the Handshake, the compromised relays, the parcel echo, and Zara's scouts stay unrendered.
- `q_frontier_pale_flag` still targets the string `pronghorn_flat`. The pale flat in this file is the herd floor. The quest file was not retied.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.
- Courier politics, the militia, the portal, the Mesh Cult, and the enclave's private crack are left for a later Frontier slice.

## Sources read

`Canon.cs` WorldId order, Frontier WorldDef (law, Open Road, Muay Thai, fauna aliases hound and wolf, steel live), gate angle π, RingRadius 34, Flower Law 42 m. `MegaworldMap.Present` (220 m, Frontier at (−220, 0)). `WorldGeography.CountryCenter`. Frontier `lore.json`, `countries.json` capitals and radii, `factions.json`, `creatures.json` seeds, `npcs.json`, `npcs-extra.json`. Native bible art direction, taxonomy Frontier row, Frontier animal and monster and hybrid rows, the three roles, `arch_kit_frontier_road` named sets, volume density, mounts and vehicles, `enc_last_dome`, `enc_road_followed`, volume Frontier quests, `item_horse_tack`, `item_wagon_pin`, `item_canteen_salt`, `item_rem_dome_rivet`, `item_rem_watcher_nail`, `skill_steel_dust_kick`. S01 horse and Pinewood rules. Prior slices S01 through S12, read so this facet would not retune their caps, their clocks, their quests, or Pinewood Crossing.
