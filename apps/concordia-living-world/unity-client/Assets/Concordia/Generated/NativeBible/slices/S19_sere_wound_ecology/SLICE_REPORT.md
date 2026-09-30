# SLICE REPORT — S19_sere_wound_ecology

STATUS: COMPLETE

World: Sere (canon world id `sere`). Facet: ecology_bosses. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Caps, three mini-bosses, boss, token, quests, unspawned |
| ECOLOGY.json | Primary: opens, 6 creature rows with caps, 1 zero-cap drone cite, 3 mini-bosses, 1 boss, 1 token, 4 side quests |
| STORIES.md | Waystone essay, open arithmetic, creature stories, quest backstories, withheld lines |
| AURA_BIND_NOTES.md | Bind order, seam rules, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S19_sere_wound_ecology/`.

## Counts

- Creature rows with a Sere cap above zero: 5 (`faun_smog_roach`, `faun_sodium_rat`, `faun_mark_hound`, `hyb_markharpy`, `mon_road_watcher`).
- Caps: roaches 8 on the Keshar lip; rats 6 night and 2 day on the 5.13 m seam; hound 1 by day; harpy ambient 1 and window 2, peak 2, both zero after the hall is placed; watcher 1 on the brother-gap. Event windows do not add a second hound or a second watcher.
- Zero cap: `mon_grid_drone` (S11). Also unfielded here: Tunya harpy, Ruins wraith, ribwolf, ash wolf, Crime bill-drone, Un-Ender, road bandit.
- Mini-bosses: 3. `enc_chest_stamp` (new window, existing `hyb_markharpy`, count 2). `enc_one_tile` (new window, existing `faun_mark_hound`, count 1). `enc_empty_post` (new window, existing `mon_road_watcher` skin `sere_invoice`, count 1).
- Boss: `enc_compound_mark` / `mon_boss_compound_mark`. Volume phases, volume hours, volume cron. Floor is the unplaced `furnace_belt` set. Recommended seat is the Verge-side 8 m of the 19.67 m open. This file does not author the transform.
- Remembrance: the one existing Sere id, `item_rem_furnace_eye`. No second token.
- Side quests: 4. Two enforcers inside the volume budget of 4. The empty-post quest has no NPC giver and no faction delta. No skill grant. No coin. No DTU. Hidden truths withheld.
- Volume weights and `enc_compound_mark`: cited, not edited.
- Prior Sere quests left in place: `q_sere_half_tile`, `q_sere_open_table`, `q_sere_curtain_line`, `q_sere_mark_price`, `q_sere_roach_count`, `q_sere_one_brand`, `q_sere_same_truth`, `q_sere_furnace_scout`.

## Law placement

No Refusal held, so the Mark compounds and the door is a waystone. The roach practices that by being a count of bodies on a leak. The rat practices it by eating a spill in a seam too narrow to be a hall, with dark eyes. The hound practices it by wearing one tile and baying at a second. The harpy practices it by trying to file a faction as a debtor, and by missing when one chest tile is knocked off on the stamp. The watcher practices it by standing over three blank lines and attacking only a hand that fills them in. The Compound Mark practices it by offering interest, by taking a real holder's name, and by failing the clear if the open ledger is sold into the circle. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). The Grid disc stays on the Grid. The furnace eye stays out of the Crucible bay.

## Geography

`gap_verge_keshar` is derived. Verge (−31.52, −12.74) r 23 and Keshar (−32.0, 55.43) r 25.5 are 68.17 m apart, leaving 19.67 m. Midpoint (−31.76, 21.34). `gap_aldermere_tally` is 22.86 m at (18.99, 5.14). `gap_dovrane_keshar` is 26.23 m at (1.22, 35.74). `gap_tally_hollow` is 5.13 m at (−27.24, 13.29). Tessera and Mercy Fund are 4.07 m apart and overlap by 44.43 m; that pile is cap 0. Keshar's far rim is 89.5 m, short of the wilds ring at 90 m. The waystone present on the megaworld plane is (−125.27, −269.29), angle 4.277 rad, radius 297 m, and is not an interior floor.

## Honesty gaps

- `furnace_belt`, `tessera_spire`, and `mark_tenement` have no Canon.cs transform. Until the hall is placed, the Compound Mark spawns nothing, and placing the hall retires the harpy window. Capitals and district steps are not substitute floors.
- The opens depend on CountryCenter still reading those capitals and radii. If that resolver changes, the floors unplace with it.
- `faun_mark_hound`, `mon_road_watcher`, and `mon_boss_compound_mark` are `hostile: true` in the bible. Roach, rat, and mark harpy are `hostile: false`. Instance aggro is in this slice. The catalogs were not edited.
- The monster row names `skill_presence_name_the_holder`. The skill id on file is `skill_presence_name_holder`. This slice binds the real id and does not add a twin.
- The enforcer role's faction string is `tessera_hold`. Quest deltas use canon ids from `factions.json`. The role file was not corrected. Volume quests use shortened ids such as `tessera` and `open_table`. Those files were not rewritten.
- S11 set `mon_grid_drone` Sere cap to 0. WorldDef still lists drone. This facet leaves the alias unresolved and does not field a sodium disc.
- S09's sodium-rat street caps and its `sere_added_by_this_slice: 0` stay. The seam cap is a separate Sere budget, not an edit to that file.
- `q_s19_heat_not_a_name` cannot be finished if `furnace_belt` is placed before `enc_chest_stamp` ever arms. That stop is recorded, not patched with a new species.
- `q_s19_empty_tariff` has an empty faction delta on purpose. A delta would name an owner.
- Health, damage, and loot stay table names and item ids already on the bible or vendor rows. No live numbers were invented.
- `mon_boss_compound_mark` is tagged humanoid for gait. The bind note forbids a CX mesh. The monster file was not edited.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` WorldId.Sere WorldDef (title, refusal, theNo, steel live, law, fauna aliases hound and drone, Wing Chun). `Canon.Gates` eight spokes, Sere absent. `HubLawRadius` 42. `MegaworldMap` angle, radius, `HasLinkGate`. `WorldGate.GatePost` waystone branch. `WorldGeography` wilds ring 90–126 m. Sere `lore.json`, `countries.json` capitals and radii, `factions.json` ids, `npcs.json` uniques. Native bible art direction Sere row, taxonomy Sere line, hound, roach, rat, mark harpy, Compound Mark, census drone, road watcher, `arch_kit_sere_mark` named sets and allowed kitbash, volume density, `enc_compound_mark`, `item_rem_furnace_eye`, `skill_presence_name_holder`, enforcer role. Prior slices S05, S07, S09, S11, S13, and S17 where they already capped Tunya harpies, Ruins bodies, Crime rats, Grid discs, the Frontier watcher, and the Crucible face of the furnace evening. S01 through S18 were not retuned.
