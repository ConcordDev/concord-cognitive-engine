# SLICE REPORT — S10_crime_politics_sidequests

STATUS: COMPLETE

World: Crime (display Iron Coast). Facet: politics_quests. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Claims, presences, vendors, quests, combat ceiling |
| POLITICS.json | Primary: geography, cultures, vendors, 7 presences, 8 side quests |
| STORIES.md | Docks against inland, three cultures, vendor backstories, the eight stops |
| AURA_BIND_NOTES.md | Bind order, empty-hand rule, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S10_crime_politics_sidequests/`.

## Counts

- Side quests: 8. Givers are Mama (2), Marquez, Halloran, Navarro, Iris, Dom, Bell. Each stops at a public fact.
- Presences: 7 uniques. They do not spend S09's labor budget of 6 or bandit budget of 3.
- Vendor rows added: 0. `vend_crime_bell` is cited. Maddox and Lou are readings with spawn nothing.
- Cultures: 4. Dock overlap, south overlap, separated desks, the corner.
- Bosses added: 0. Mini-bosses added: 0. Political encounters: 4, all with a null health table.
- Volume weights, `enc_outstanding`, and the three S09 windows plus `raid_unpaid_shift`: cited, not edited.
- Prior Crime quests left in place: eight `q_crime_*` volume rows, three S09 rows, and the canon Thorpe, Dahlia, and Ada chains.

## Law placement

The bill arrives. Witnesses remember. A truce, a skim, a motto, a blank source line, and a refused pitch are ways the coast keeps a fact smaller than the secret under it. This slice does not enlarge them. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). Coast steel stays live. People stay Wing Chun on CX, empty-handed. The stamp still drops only from the bill hound, on the volume evening, after acknowledgment.

## Honesty gaps

- District pins are recomputed from `WorldGeography.DeterministicOffset` with key `settlement/crime/{faction_id}:{district}` and radius `8+2i`. S09's warehouse, gap, and three fixed-step labels use a different 10 m step. Both are written down. The fixed-step labels are left empty. If `SettlementId.value` ever differs from the constructor string, recompute before binding. Do not fall back onto (+8, −6).
- `iron_rose_estate` is 18.88 m from the S09 warehouse and inside the Ghost disk. The slice says so. It does not rename that walk as inland. Inland, in these coordinates, is Hexshore at 70.51 m, the federal floor outside the Ghost disk, and the south overlap 78.59 m from the warehouse.
- The 14th and Halloran capitals are 1.03 m apart. Their hash doors are 9.49 m apart. The quests use the doors. The 1.03 m stays the claim overlap.
- Mama's shotgun is on her appearance sheet and is not spawned. Faction pistol and baton archetypes are not spawned.
- Bell's schedule room `crime_alley_corner` has no coordinate. He is paired to the S09 gap, even days only, so `enc_stair_switch` keeps the odd midday. If his mesh is missing, `q_s10_gap_between` cannot be turned in.
- `vend_crime_bell` stock and standing tiers are cited, not edited. No new item id.
- Role string `delgado_syndicate` and volume string `ghost_contracts` are not canon faction ids. Quest deltas are empty. No third book is written.
- Secrets listed in `unresolved_on_purpose` stay unrendered, including the named source of the tips, the godson, the nephew's name, the Voss letters, Renny's off-book letter, and Lou's back room.
- Jax, Cipher, Tomás, Renny, Lou, Maddox, Dahlia, Ada, Iniko, Pia, Thorpe, and Pidgeon have no pair. Generated Iron Racket is not a polity.
- `thorpe_family`, `crime_watch`, `city_judiciary`, and `wharf_workers` have no country, so they have no hash pin. The courthouse, the morgue, the pier office, and the Sunken Anchor spawn nobody.
- Named sets `wharf`, `tenement`, `armored_warehouse`, and `foundry_steam` stay unplaced. The Anchor memorial is not moved onto the warehouse.
- Health for these uniques is absent on purpose. No hit points were invented. Creature health stays on S09's rows.
- `day_index` is the volume day counter, the same convention S09 used. This slice does not define a new clock.
- Meshes are stubs. Until Aura binds a native mesh, each unique spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` WorldId order, Crime WorldDef (law, Ghost Contracts, Wing Chun, fauna aliases hound and drone, steel live), gate angle 5π/4, Flower Law 42 m. Crime `lore.json`, `countries.json`, `factions.json`, `factions-extra.json`, `npcs.json`, `npcs-extra.json`, quest files `thorpe-bust`, `dahlia-ledger`, `ada-pell-log`. `WorldGeography.BuildPlaces` and `CityAtlas.DistrictsForCountry`. Native bible art direction, taxonomy Crime row, `arch_kit_crime_coast`, coast labor and bandit roles, `vend_crime_bell`, volume Crime quests. Art style guide WorldId map. Prior slices S08 (politics shape) and S09 (floors, caps, quests not redone). S01 through S07 were not retuned.
