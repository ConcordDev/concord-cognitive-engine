# SLICE REPORT — S17_crucible_arcane_creatures

STATUS: COMPLETE

World: Crucible (The Crucible, canon folder `lattice-crucible`, client world id `Crucible`). Facet: creatures_bosses. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity, Concord, or Claude process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Caps, three mini-bosses, boss, adjacency, token, quests, unspawned |
| CREATURES.json | Primary: opens, caps, windows, one token, four side quests |
| STORIES.md | Law essay, three opens, creature stories, quest backstories, withheld lines |
| AURA_BIND_NOTES.md | Bind order, seam rules, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S17_crucible_arcane_creatures/`.

## Counts

- Foundry beasts with a Crucible cap above zero: 3 (`faun_lattice_moth` 4 at night on the 3.72 m open; `mon_crucible_drift` 2 on the 25.50 m open; `hyb_latticebasilisk` 0 ambient and 1 inside `enc_rib_notch`).
- Role budget, unchanged: `npc_role_crucible_mystic` 4 on spans and cart. One of them loans to the moth open during `enc_vein_short` only.
- Boss: `enc_unender` / `mon_boss_unender`. Volume hours 20–23, every third day. Ambient cap 0. Floor is the derived 7.66 m cultist–procgen open.
- Mini-bosses: 3. `enc_rib_notch` (basilisk × 1, 8–10, `day_index % 3 == 0`). `enc_two_masses` (drift × 2, 11–13, `% 3 == 1`). `enc_vein_short` (moth × 4 and one CX walker, 21–23, `% 3 == 2`, suppressed on an Un-Ender night).
- Adjacency: `enc_numeral_open`, hours 17–19 on the Compound Mark's every-third-day cron, creature count 0, floor unplaced `glue_clock_face_unclosed`. The Mark stays Sere.
- Zero caps: `mon_grid_construct` (S11), `hyb_censusconstruct` (S11), `mon_boss_compound_mark`, `mon_road_watcher`, `mon_ruins_wraith`, `hyb_mercywraith`, and the three canon seeds with no bible id.
- Remembrance: the one existing Crucible id, `item_rem_unclosed_seam`. No second token. The furnace eye stays Sere.
- Side quests: 4, one mystic role inside budget 4. No skill grant. No new item. Hidden truths withheld.
- Volume weight, mystic budget, prop counts, Un-Ender clock, and Mark clock: cited, not edited.
- Prior Crucible quests left in place, including the eight volume rows and the Voss, Ono, and Emer canon chains.

## Law placement

If it would end, un-end it. There is no ninth. The moth practices the law by dying if its vein finishes, so the clear is to stop the vein. The drift mass practices it by keeping a fourth light out of the body count. The basilisk practices it with quartz ribs that do not meet, which is also the third Calvex alloy staying untaught. The Un-Ender practices it by offering a completion and respecting a walk away. The missing numeral practices it beside the Compound Mark: the kiln's evening has a Crucible face, and that face does not gain a digit. Taking the digit would be how a foreign bill closes an eighth refusal. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). The Grid construct stays off this continent. The Mark stays on Sere.

## Geography

`gap_wit_procgen` is 3.72 m at (−43.66, −10.42). `gap_cult_procgen` is 7.66 m at (1.87, −21.66). One 4 m module centered there has 1.83 m of air each side. It is the narrowest country gap that clears 4 m, and the recommended seat for one module. Six other gaps are also wider than 4 m and stay empty of beasts. The kit snap is a 2×2 bay, 8 m on the 4 m grid, and that bay does not fit the throat. `gap_eng_procgen` is 25.50 m. Its floor is (10.85, −31.34), on the segment, because the engineer radius is 25.5 and the capital midpoint (12.08, −31.52) is 1.25 m off the open's center. The drift masses keep that floor. Six wider opens stay cap 0: procgen–meta 14.74 m at (5.54, −22.24), the narrowest field that clears 8 m; procgen–refugees 32.26 m; Witness–cultists 47.79 m; Witness–meta 55.20 m; Witness–refugees 61.83 m; Witness–engineers 70.70 m. Cultists and meta are 7.44 m apart and nested by 38.56 m. Five further east pairs overlap, down to 2.08 m between engineers and refugees. That weld is cap 0. Engineer outer rim is 86.50 m. Wilds start at 90 m. The 3.50 m sliver is cap 0. All six district anchors are the capital plus (8, −6).

## Honesty gaps

- `arch_ix_crucible_foundry` and the lattice named sets have no Canon.cs transform. Until the foundry is placed, the numeral window and its quest spawn and complete nothing. The 7.66 m open is a recommended seat for one 4 m module, not a placement, and not a fit for the kit's 8 m 2×2 snap. The 14.74 m procgen–meta field would clear that snap and stays empty. The Un-Ender and the basilisk use the 7.66 m open as ground and do not wait on the kit.
- An earlier draft of this slice called the 7.66 m throat the only country gap a 4 m module can occupy. Remeasured all 15 country pairs. Six further gaps are wider than 4 m. They are listed under `wider_opens_cap_0` and stay at cap 0. Caps, clocks, quest ids, and the recommended seat did not move.
- The opens depend on CountryCenter still reading those capitals and radii. If that resolver changes, the floors unplace with it.
- A boss mesh wider than 7.66 m must not clip a country disc. It spawns nothing until a wider floor exists. No footprint was invented to force a fit.
- `faun_lattice_moth`, `mon_crucible_drift`, and `hyb_latticebasilisk` are `hostile: false`. Instance aggro is in the rib window and the two-mass window. The catalogs were not edited.
- The basilisk is absent from the Crucible density fauna list. This slice fields 1 in one window and 0 otherwise, and does not add a weight.
- Drift catalog spawn says 1–3. This slice fields 2, matching the density weight, and does not edit the spawn line.
- Moth herd says 3–10. This slice fields 4, matching the density weight.
- `ROLES.json` stamps `open_lattice`. Volume deltas say `open_lattice`. Neither string is in `factions.json`. This slice's deltas use the six country ids. The role file and the volume file were not corrected. `calvex_forge` and the other lore cohort ids were not given standing.
- The walker has no health table. No hit-point number was written. The walker is not a damage target.
- The monster row names `skill_craft_lattice_unend`. The skills catalog and the volume phase name `skill_craft_unend`. This slice binds the volume id and does not mint the other string.
- WorldDef fauna lists wraith and construct. Wraith resolves to nothing. Construct resolves to `mon_grid_construct`, whose Crucible cap stays 0.
- Canon seeds `drift_mote_swarm`, `crucible_warden`, and `echo_serpent` have no bible ids. They stay unspawned. They are not renamed onto the drift mass or the basilisk.
- `mon_boss_unender` is amorphous. The walker is the only CX body this facet loans onto a beast floor. The monster file was not edited.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.
- `enc_unender` uses a day-of-month cron. The mini-boss windows use `day_index`. The vein window also suppresses itself whenever the volume schedule is open, so the two night clocks cannot both arm.

## Sources read

`Canon.cs` WorldId.Crucible WorldDef (title, refusal, theNo, steel live, law, fauna aliases drift, wraith, and construct, gate angle 7π/4). `HubLawRadius` 42. `WorldGeography` country circles, the 90–126 m wilds ring, and the Crime–Sere route. Crucible `lore.json`, `countries.json` capitals and radii, `factions.json` ids, `creatures.json` seeds, quest files for Voss, Ono, and Emer. Native bible art direction Crucible row and the Unclosed Foundry blend, taxonomy Crucible line, moth, drift mass, Un-Ender, Compound Mark, lattice basilisk, Grid construct world ids, `arch_kit_crucible_lattice` named sets, `arch_ix_crucible_foundry`, volume density, `enc_unender`, `enc_compound_mark`, `item_rem_unclosed_seam`, `item_rem_furnace_eye`, `skill_craft_unend`, `skill_steel_shard`, the lattice walker role. Prior slices S07, S11, S13, and S15 where they already capped the mercy wraith, the construct, the watcher, and the Dawn. S01 through S16 were not retuned. S18 politics and S19 Sere ecology were not opened.
