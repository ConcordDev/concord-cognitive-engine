# SLICE REPORT — S05_tunya_ecology_miniboosses

STATUS: COMPLETE

World: Tunya. Facet: ecology_bosses. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Caps, mini-bosses, boss gap, quests, unspawned |
| ECOLOGY.json | Primary: 8 creature rows, 3 mini-bosses, boss null, 5 side quests, ark-place table, 6 quiet ids |
| STORIES.md | Law essay, place of each species, three encounter stories, five quest backstories |
| AURA_BIND_NOTES.md | Bind order, seam rules, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S05_tunya_ecology_miniboosses/`.

## Counts

- Creature rows: 8 (`faun_nil_sealie`, `faun_veil_hound`, `faun_terrace_goat`, `faun_pollen_hare`, `faun_ark_heron`, `faun_grove_finch`, `mon_tunya_harpy`, `mon_tunya_reapjackal`).
- Caps: sealie 4 on the shoal set; hound 4; goat 8 on weed strips; hare 6 in bloom and 0 off bloom; heron 3 by day; finch 10 by day with pollen dust; harpy 4 and jackal 5, both ambient caps 0 while `enc_twelfth_reap` is up.
- Mini-bosses: 3. `enc_twelfth_reap` (existing clock, law deepened, no new mesh). `enc_pollen_sleep` (new window, existing `hyb_pollenwyrm`, count 1). `enc_graft_charge` (new window, existing `hyb_veilstag`, count 1, Fantasy cap added 0).
- Boss: none. No `mon_boss_` id exists for Tunya. The gap is recorded. No substitute body was scaled up.
- Side quests: 5, givers inside the labor budget of 6 and the merchant budget of 3. No skill grant. No DTU. Hidden truths withheld. The fifth, `q_s05_hull_stays_empty`, checks day finches on the terrace tiles and a fauna cap of 0 within 40 m of the Asbir Ark (−90, −58). It does not open the anomaly and does not turn in to `the_ark_wright`.
- Ark place: Africa hold, North American hull, Eurasian cohorts, South American lip, Antarctic berths, the unpinned remainder of the seven, and the Vessine wreck. Only the twelfth window puts bodies on an ark-adjacent lip, and only after that lip is placed. Terrace tiles are the living panel. Hulls are not paddocks.
- Food web and day clock added in `ECOLOGY.json`. Caps on that clock are the same numbers as the creature rows.
- Content bestiary crosswalk: `sealies`, `goat`, `elephant`, `s_mollusca`, `frog`. The other content ids stay off the terrace. No new bible id.
- Mini-boss ark roots: `enc_twelfth_reap` cites `lore_south_arrival_stranded`. `enc_pollen_sleep` cites `lore_no_electricity`. `enc_graft_charge` cites `lore_curated_archive` and `lore_north_arrival_walk_off`. Clocks and meshes unchanged.
- Volume weights and `enc_twelfth_reap`: cited, not edited.
- Prior Tunya quests left in place: `q_tunya_fruit_not_tree`, `q_tunya_sealie_not_bird`, `q_tunya_pollen_ward`, `q_tunya_reap_fine`, `q_tunya_terrace_bell`, `q_tunya_heron_hold`, `q_tunya_choir_one_chart`, `q_tunya_twelfth_edge`, plus the canon chains those volume rows extend.

## Law placement

Fruit, not the tree. Poise returns if you are not striking. Theft of fruit or a tool is a fine paid in fruit. A trunk, a graft, or a root is the reap. The twelfth alpha practices that reap from the air. The pollenwyrm practices a reap of attention: sleep through the bloom and the season is gone. The veil stag practices the defense of a graft and plants a pollen ward instead of paying an antler. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). The stag rig is shared with that herd and the animal is not added to it.

## Honesty gaps

- `lore_fluxom_founding` describes an orca-scale horned sealie and cites `bestiary.json#sealies`. The file is `content/world/tunya/bestiary.json`. It is not copied into `Canon/tunya/`. The content row is apex, horned, and lists ivory, blubber, bone, and a purple sac. The bible row is 0.55× player length, dog-faced, no horn. This slice spawns the bible body or nothing. It does not invent a second id, does not grant those materials, and does not delete the lore sentence. The two animals share a word. The merchant errand is the correction a player can walk.
- `CreatureCompiler.StemFor` may bind `sealie` to a flamingo. The sealie row already forbids it. Unplaced or mis-bound, the shoal stays empty.
- `faun_veil_hound` is `hostile: true` in `ANIMALS.json`. Harpies, jackals, the wyrm, and the stag are `hostile: false`. Instance aggro is in this slice. The catalogs were not edited.
- `nil.extends_world` is `sovereign-ruins`. `asbir.extends_world` is `lattice-crucible`. Lore keeps both places on Tunya. Fauna were not moved along those fields, and the fields were not patched.
- Masond, Corre, Dormas, and Vrellan have no `country_id` in `countries.json`, so they have no CountryCenter. The Hold of First Arrival stays on `q_tunya_heron_hold`. This slice adds no heron there.
- `verdant_veil` is the faction string on `npc_role_tunya_labor` and on the volume Tunya quests. It is absent from `factions.json`. Deltas in this slice write that standing book. They do not add a fifteenth canon faction. S06's refusal stands.
- `faun_veil_hound.tame_hook` names `npc_role_tunya_veil_labor`. That role is not in `ROLES.json`. The heel uses `npc_role_tunya_labor`. The animal file was not edited.
- Lore says seven arks and pins four landings, with Antarctica's berths given to Africa before launch. The unpinned remainder is left empty. No wreck coordinate was invented.
- Named sets `terrace_farm`, `nil_shoal_stair`, and `veil_hall` have kit names and no Canon.cs point. Until a set is placed, its creatures spawn nothing. RealmFill corn and the country capitals are not substitute floors. The twelfth lip has a volume sentence and no coordinate. Aekon Glacier Gate is not that lip.
- Bahiij's elephant trade and the cactem dye-bug have no creature ids. They stay unspawned.
- `hyb_veilstag` lists Fantasy. S03 did not stage it. This slice does not add a Fantasy body and does not edit S03, S01's stag cap, or S04.
- Health, damage, and loot stay table names and item ids already on the bible rows. No live numbers were invented.
- `skill_presence_do_not_reap` names a heal VFX prefab. The bind note points at `cue_grove`. The skill file was not edited.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` WorldId order, Tunya WorldDef, gate angle 3π/4, steel live, Capoeira, fauna aliases sealie, hound, harpy. Tunya `lore.json`, `countries.json`, `factions.json` ids, `quests/arks-of-memory.json`. `content/world/tunya/bestiary.json` (the file lore names; not present under `Canon/tunya/`). Native bible art direction, taxonomy biome line, Tunya animal and monster and hybrid rows, `arch_kit_tunya_veil` named sets, volume density, `enc_twelfth_reap`, volume Tunya quests, `skill_presence_do_not_reap`. `WorldGeography.CountryCenter`. `RealmFill` Tunya case, only to refuse it as a farm. Art style guide WorldId map. Prior slices S01 through S04 and S06, read so this facet would not retune their caps, their finch coat, their stag herd, or their quests. S06 keeps the wright, the anomaly door, and the refusal to add a `verdant_veil` faction row. S23 cites `enc_twelfth_reap` and was not edited.
