# SLICE REPORT — S01_hub_ecology_mobs

STATUS: COMPLETE

World: Hub (Unburned Court). Facet: ecology_mobs. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Caps, quests, unspawned seeds |
| ECOLOGY.json | Primary: 7 creatures, 5 bands, 4 side quests, empty boss lists |
| STORIES.md | Ecology essay, seven stories, quest backstories |
| AURA_BIND_NOTES.md | Bind order, flower override, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S01_hub_ecology_mobs/`.

## Counts

- Spawn rows: 7 (`faun_court_pigeon`, `faun_lantern_moth`, `faun_court_cat`, `faun_saltroad_hare`, `faun_pinewood_stag`, `faun_wagon_horse`, `hyb_saltwyrm`).
- Bosses: 0. Mini-bosses: 0.
- Light hostiles: market mouser (vermin only), stag shove (horse or wyrm, not a player hunt), salt wyrm (one ditch, spit slows, collar is the tell).
- Side quests: 4, all with givers who already exist and with backstory tied to lore.
- Volume weights: cited, not edited.
- Prior Hub quests left in place: `q_hub_pinewood_milepost`, `q_hub_flower_urn`, `q_hub_lamplighter_round`, `q_hub_three_notebooks`, `first_cycle_fight`.

## Law placement

Flower disk 42 m holds pigeon, moth, and mouser. Arena disk (center z=18, radius 8) holds none, because that is where steel stays steel. Hare, stag, horse, and salt wyrm start at or past 42 m. Pinewood Crossing remains (62, −28), outside the 56 m wall. A wyrm spit that crosses the disk crusts as flowers and does not slow. A player swing inside the disk and off the sand applies a flower and no health table.

## Honesty gaps

- `plaza_strider` and `cistern_lurker` remain Canon seeds with no taxonomy id. Unspawned on purpose. Closing them would be a taxonomy change, which this slice does not make.
- `faun_court_cat` is `hostile: true` in `ANIMALS.json` and `hyb_saltwyrm` is `hostile: false` in `HYBRIDS.json`. Spawn contracts here override aggro without editing those files. A later binder should follow this slice's `player_aggro` fields.
- Health, damage, and loot stay table names already on the bible rows. No live numbers were invented.
- Riding the wagon horse is still absent. The hitch cap does not claim a mount camera.
- Kiren Owl's uncatalogued print and Orin Rede's exhausted-mount record stay on `hub_impossible_print`. This ecology does not identify them.
- Southern moth thinness points at the Year 89 and Year 91 dome record. The quest records a count. It does not brief the Assembly.
- The Lamplighter's one sentence is lore. If Three Lanterns is already accepted or complete, Count the Diamonds is chalk on the first eastern post and he is not spawned again. The other person in the old lantern lineage stays unnamed.
- Fantasy shares stag, hare, and salt wyrm ids. Those worlds' densities were not retuned.
- S02 and S24 name this slice's caps, the moth count, the salt wyrm, and the stag as already settled. This pass did not retune those caps or those quest ids.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` radii and `SteelLive`. `concordia-hub/lore.json` (Year 38 tide, Year 89 dome, Year 91 southern arc, Lamplighter, Impossible Print, Founding Day), `cities.json` Pinewood Crossing (62, −28), `creatures.json` seeds, and the npc entries for Asbir, Kiren, and Orin. Native bible art direction, taxonomy, animal and hybrid rows, volume density Hub block, `q_hub_lamplighter_round`, and bind schema. Art style guide Hub row. Later slices S02 and S24 were read so this facet would not move what they already cite.
