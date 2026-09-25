# SLICE REPORT — S11_cyber_creatures_density

STATUS: COMPLETE

World: Cyber. Facet: creatures_density. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Floors, caps, three windows, quests, unspawned |
| DENSITY.json | Primary: sky deck, clinic hinge, uncounted gap, caps, 3 mini-bosses, boss unmoved, 3 side quests |
| STORIES.md | Ecology, each body, three windows, three quest backstories |
| AURA_BIND_NOTES.md | Bind order, perch rule, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S11_cyber_creatures_density/`.

## Counts

- Creature rows capped: `mon_grid_drone` 2 ambient / 3 in the triangle, `mon_grid_sentinel` 1, `mon_grid_construct` 1, `faun_grid_stray` 2, `faun_cable_sparrow` 4 day / 2 night and only on a dressed perch, `hyb_nullhound` 0 ambient / 1 in the cloak window.
- Caps held at 0: `hyb_censusconstruct`, `hyb_billdrone`, Crime and Sere for the drone, Superhero for the sentinel, Crucible for the construct.
- People: labor 4 of budget 6, officer 2 of budget 2. Neither role joins a creature roster.
- Mini-bosses: 3. `enc_disc_triangle` (new window, existing drone, count 3). `enc_hinge_blank` (new window, existing construct, count 1, same instance). `enc_cloak_skip` (new window, existing nullhound, count 1).
- Boss: `enc_census` / `mon_boss_census` cited, hours 2–4 every third day, not retuned, not moved onto the deck. Unplaced until `census_block` exists.
- Volume window: `enc_junction_null` cited, hours 13–15 every second day, not retuned, dark until a live junction box exists. Not counted as a fourth staged floor.
- Side quests: 3. No skill grant. No new item. No DTU. Hidden truths withheld.
- Raid: none.
- Volume weights and both Cyber clocks: cited, not edited.
- Prior Cyber quests left in place: `q_cyber_packet_tea`, `q_cyber_silver_path`, `q_cyber_missing_number`, `q_cyber_stray_ear`, `q_cyber_sparrow_nest`, `q_cyber_lavren_door`, `q_cyber_practice_rail`, `q_cyber_hand_list`, plus the canon chains those volume rows extend.

## Law placement

Do not be counted. Dogs are not drones. A finished sum fails the refusal even when the bar breaks. The triangle paints three digits on an 8 m deck and must not be allowed to total them. The clinic construct tries to close its own ground-off serial and must walk away still blank. The nullhound skips one tick and stays a dog with plates, beside a one-eared stray that is not a machine. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). Steel on the deck is live. People use Capoeira and the pulse. Ambient hands do not hold rifles.

## Honesty gaps

- Canon seeds `glitch_hound`, `neural_parasite`, `black_ice_construct`, `void_walker`, and `rogue_drone_swarm` have no bible ids. They stay unspawned. The triangle does not become the rogue swarm.
- `mon_grid_drone` catalog spawn says 4–8. This slice caps the deck at 2 ambient and 3 in the window. The catalog was not edited.
- `mon_grid_sentinel`, `mon_grid_construct`, and `hyb_nullhound` are `hostile: false`. The hinge and the cloak set aggro on the instance. The sentinel door does not. The files were not edited.
- `hyb_censusconstruct` is a real Cyber/Crucible row and stays at cap 0 so the bar and the hood do not merge.
- `hyb_billdrone` keeps Cyber cap 0. S09 owns that hybrid.
- Named sets `census_block`, `uncounted_alley`, and `sky_bridge` have no Canon point. The deck plan and the gap are the floors. The boss and Junction Null stay dark until their own anchors exist.
- `census_authority`, `uncounted`, `lattice_patrol`, `lattice_runners`, and `cyber_polysteel_society` appear as faction strings and are not country ids. No book is opened under those names. The country that is the club is `cyber_augmented_elite_club`. Its disputed-border string does not match. The file was not patched.
- `under_district` sits inside Blackout and Polysteel. `nevex_tower_central` sits inside Nevex and Zero. Both are empty of this facet. Blackout's disputed list does not mention Polysteel. Geometry emptied the district anyway.
- Neon Quarter, Lavren's door, and the practice frame have quests and no country coordinate. This slice does not invent those points.
- The Week the Quarter Went Dark has no declared cause. None was added.
- Health stays table names already on the rows. Card loot strings are not item ids. No live numbers and no new items were invented.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` Cyber WorldDef, gate angle 0, steel live, Capoeira, fauna aliases drone, sentinel, construct. Cyber `lore.json`, `countries.json`, `factions.json`, `creatures.json`, `npcs.json`, `npcs-extra.json`, quests `kira-packet-map`, `silver-identity`, `ghost-7-trace`. Native bible art direction, taxonomy Cyber row, animal and monster and hybrid rows named above, `arch_kit_cyber_grid` sky-bridge module and named sets, volume density Cyber block, `enc_census`, `enc_junction_null`, volume Cyber quests, `skill_steel_pulse`, `skill_presence_refuse_count`, remembrance items `item_rem_missing_number` and `item_rem_null_ring`. Art style guide Cyber line. Prior slices S01 through S10, read so this facet would not retune their caps, S09's billdrone, or the existing Cyber quests.
