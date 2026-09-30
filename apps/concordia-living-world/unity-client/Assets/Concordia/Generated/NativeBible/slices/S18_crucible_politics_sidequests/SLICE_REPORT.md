# SLICE REPORT — S18_crucible_politics_sidequests

STATUS: COMPLETE

World: Crucible (The Crucible, canon folder `lattice-crucible`, client world id `Crucible`). Facet: politics_quests. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity, Concord, or Claude process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Anchors, quests, combat ceiling, rows left in place |
| POLITICS.json | Primary: four presences, five cultures, one slate, seven side quests |
| STORIES.md | Geography of forges and seams, cultures, quest backstories, withheld lines |
| AURA_BIND_NOTES.md | Bind order, empty anchors, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S18_crucible_politics_sidequests/`.

## Counts

- Presences: 4. Pem at `central_crucible` hours 11–15. Vaud at `engineering_workshop` hours 12–15. Calla of the Six Drifts at `temple_of_six_drifts` hours 7–11 and 15–19. Taln at `refugee_camp_outer` hours 8–12 and 15–19. One body each. They do not spend the mystic budget of 4.
- Slate: `notice_split_unvoted` at `procgen_assembly_hall`, spawn count 0. `meta_observatory` empty.
- Side quests: 7. No skill grant. No item. No coin. No faction delta.
- Bosses and mini-bosses added: 0. S17 clocks cited and not retuned.
- Volume weight, mystic budget, prop counts, Un-Ender clock, Mark clock, and the three opens: cited, not edited.

## Law placement

If it would end, un-end it. There is no ninth. The bench practices the law by leaving an amendment unvoted, the doors at seven, and a drift-mark uncashed. The pact practices it as six blanks where a declaration would have closed Year 11. The maps practice it as a filing that withholds recognition. The desk practices it as two alloys and a blank third line. The bay practices it by measuring the only 4 m seat, 7.66 m with 1.83 m of air each side, and not pouring. The camp practices it by logging a likeness and refusing a cause. The sermon practices it as six glyphs and no verdict. The assembly practices it as a split with no vote. Flower Law stays a Hub disk of 42 m. The gate stone at (24.04, −24.04) is inside that disk, so steel there is a flower. Country floors stay live steel. Pinewood Crossing stays (62, −28).

## Geography

`central_crucible` is (−54.76, −0.51), 10 m inside the Witnesses capital (−62.76, 5.49), radius 23. `engineering_workshop` is (56.72, −42.71), 10 m inside the engineer capital (48.72, −36.71), radius 25.5. It is 58.75 m from `gap_cult_procgen` and 47.26 m from `gap_eng_procgen`. `temple_of_six_drifts` is (36.29, −23.0). `refugee_camp_outer` is (52.99, 3.56), 40.50 m from the engineer capital and outside that circle. `gap_wit_procgen` is 3.72 m at (−43.66, −10.42) and cannot hold a 4 m module. `gap_cult_procgen` is 7.66 m at (1.87, −21.66). `gap_eng_procgen` is 25.50 m at (10.85, −31.34). Cultists and meta are 7.44 m apart and nested by 38.56 m. Cultists and engineers overlap by 20.11 m. Engineers and refugees overlap by 2.08 m. Engineer outer rim is 86.50 m. Wilds start at 90 m. The 3.50 m sliver is empty. All six district anchors are the capital plus (8, −6).

## Honesty gaps

- `arch_ix_crucible_foundry`, `unend_hall`, `shard_yard`, and `leaning_stack` have no Canon.cs transform. The bay quest completes by leaving them unplaced. It does not wait on a mesh, and it does not succeed by spawning one.
- The seven doors, the Calvex forge, the verge, the sage hut, the lattice circle, the drill yard, the pilgrimage path, the field kitchen, the unwriting yard, and the recursion balcony have no country anchor. Quests that need them file the public sentence on an anchor that exists, or they fail if a binder tries to spawn the room.
- Orla and Sael are on `central_crucible` during Pem's window. This facet stands one body on purpose. A binder who spawns the council of three has left the slice.
- Vaud's 5–8 workshop block is the same string and is not interactable. The desk does not open then.
- Calla's phase-family rows also name the temple across hours that conflict with the pilgrimage gap. Those hours stay unstaged.
- `high_priestess_calla_drift` and Calla Bren share a given name and are different sheets. The sermon quest fails if they are merged.
- Kit Voss is a child. No pin.
- The opens depend on CountryCenter still reading those capitals and radii. If that resolver changes, the bay measures unplace with it.
- `ROLES.json` and the volume deltas still say `open_lattice`. That string is not in `factions.json`. This slice writes no delta. The role file and the volume file were not corrected. `calvex_forge`, `lattice_cohort`, `kell_circle`, and `verge_scouts` were not given standing.
- People have no health table in this facet. No hit-point number was written from the sheet levels.
- Firearm verb coverage is zero. Sheet weapons stay on sheets.
- Meshes for these four people are not commissioned here. Until Aura binds a native CX dress, each presence spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` WorldId.Crucible WorldDef (title, refusal, theNo, steel live, law, fauna aliases drift, wraith, and construct, gate angle 7π/4, PickFight). `HubLawRadius` 42. `MegaworldMap.Present`. Crucible `lore.json`, `countries.json`, `factions.json`, `factions-extra.json`, `npcs.json`, `npcs-extra.json`, and the Voss, Emer, and Ono quest files. Native bible art direction Crucible row and the Unclosed Foundry blend, taxonomy Crucible line, `arch_kit_crucible_lattice` named sets, `arch_ix_crucible_foundry`, volume quests, `enc_unender`, `enc_compound_mark`. Prior slice S17 for opens, caps, clocks, and the four creature errands. S01 through S16 were not retuned. S19 was not opened.
