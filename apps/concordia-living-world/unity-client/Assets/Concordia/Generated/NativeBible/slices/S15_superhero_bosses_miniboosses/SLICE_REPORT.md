# SLICE REPORT — S15_superhero_bosses_miniboosses

STATUS: COMPLETE

World: Superhero (The Permanent Dawn, canon world id `superhero`). Facet: bosses. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity, Concord, or Claude process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Caps, four mini-bosses, boss, token, quests, unspawned |
| BOSSES.json | Primary: floors, caps, four mini-bosses, one boss, one token, four side quests |
| STORIES.md | Law essay, circle arithmetic, encounter stories, quest backstories, withheld lines |
| AURA_BIND_NOTES.md | Bind order, seam rules, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S15_superhero_bosses_miniboosses/`.

## Counts

- Creature rows with a Dawn cap above zero: 2 (`faun_aegis_kestrel` 2 by day on `roof_pad`; `hyb_dawnjackal` 0 ambient and 2 inside `enc_open_brow`).
- Role budgets, unchanged: `npc_role_dawn_elite` 4 on `roof_pad` once placed; `npc_role_dawn_mystic` 2, one of them at the Baseline gate until `street_kitchen` exists.
- Boss: `enc_unfinished_sunrise` / `mon_dawn_mercy_sentinel`. Volume hours 5–7, every second day. Ambient weight stays 0. Floor is the unplaced `aegis_spire` set.
- Mini-bosses: 4. `enc_yielded_stoop` (new window, existing kestrel, count 2). `enc_open_brow` (new window, existing dawn jackal, count 2). `enc_pauldron_medal` (new window, one CX elite inside the budget of 4, three witnesses). `enc_podium_chalk` (new window, one CX adept inside the budget of 2, one feeder, no legal strike).
- Zero caps: `mon_grid_sentinel` (S11), `mon_grid_drone` (not a Dawn world id), `hyb_mercywraith` (S07, both worlds), `mon_grid_construct`, and the five canon seeds with no bible id.
- Remembrance: the one existing Dawn id, `item_rem_mercy_band`. No second token.
- Side quests: 4, one mystic role inside budget 2. No skill grant. No DTU. Hidden truths withheld.
- Volume weight, elite budget, mystic budget, circlet weight, and the sunrise clock: cited, not edited.
- Prior Dawn quests left in place, including the eight volume rows and the Mira, Iron Hex, and sifu canon chains.

## Law placement

Mercy. They stand. The dawn does not end. The kestrel pair practices the failure by stooping a body that has yielded. The jackals practice it with the brow plate already gone, so the nip will finish. The medal elite practices it by wearing a win. The podium adept practices it by writing a name that would end the morning. The sentinel practices it by offering a finishing blow and calling the offer help. Taking that help is how a person becomes the Luminary, which is the world def's second line, and it is not a costume change into Vesper. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). The Grid sentinel stays off this continent.

## Geography

`gap_baseline_spire` is derived, not invented as a new capital. Baseline (−34.07, −40.6) radius 23 and Spire (25.27, −34.79) radius 23 are 59.62 m apart, leaving 13.62 m of open. Midpoint (−4.4, −37.7). Enforcers and Luminary are 8.03 m apart and nested, with the Task Force overlapping both. That nest is cap 0. Rights and Baseline overlap by 9.09 m and the country file already marks the border disputed. Campus air (26.57 m) and the Spire–College gap (14.62 m) are empty on purpose. All seven district anchors are the capital plus (8, −6). The far college rim is about 81.5 m. The wilds ring is 90–126 m. `roof_pad`, `aegis_spire`, and `street_kitchen` remain unplaced kit sets.

## Honesty gaps

- Named sets have no Canon.cs transform. Until they are placed, kestrels, elites, the podium, and the boss spawn nothing. Capitals are not substitute roofs. The jackal gap does not wait on a set, and it still spawns nothing while the mesh is a stub.
- The gap depends on CountryCenter still reading those two capitals. If that resolver changes, the jackal floor unplaces with it.
- `faun_aegis_kestrel` and `mon_dawn_mercy_sentinel` are `hostile: true`. `hyb_dawnjackal` is `hostile: false`. Instance aggro is in this slice. The catalogs were not edited.
- `ROLES.json` stamps `aegis` and `luminary`. Volume deltas say `permanent_dawn`. Neither string is in `factions.json`. This slice's deltas use `enforcers_movement`, `luminary_empire`, `superhero_normie_resistance`, and `superhero_civil_rights_emerged`. The role file and the volume file were not corrected.
- The elite and the adept have no health table. No hit-point number was written. The elite clears by the existing mercy knockdown. The adept is not a damage target.
- `hyb_dawnjackal` is absent from the Superhero density fauna list, and its catalog spawn line says 3–5. This slice fields 2 in one window and 0 otherwise, and does not edit either source.
- WorldDef fauna lists drone and sentinel. Sentinel resolves only to the mercy sentinel inside the volume hour. Drone resolves to nothing here. `mon_grid_sentinel` stays at the S11 Superhero cap of 0.
- Canon seeds `street_mutant`, `energy_wraith`, `mech_hound`, `shadow_stalker`, and `riot_elemental` have no bible ids. They stay unspawned.
- `mon_dawn_mercy_sentinel` is tagged humanoid for gait. The bind note forbids a CX mesh. The monster file was not edited.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` WorldId.Superhero WorldDef (title, refusal, theNo, steel live, Karate, law, fauna aliases drone and sentinel, gate angle 3π/2). `HubLawRadius` 42. `WorldGeography` country circles and the 90–126 m wilds ring. Superhero `lore.json`, `countries.json` capitals and radii, `factions.json` ids, `creatures.json` seeds, quest files for Mira, Iron Hex, and the sifu chain. Native bible art direction Superhero row, taxonomy Superhero line, kestrel, mercy sentinel, dawn jackal, mercy wraith, Grid drone and sentinel world ids, `arch_kit_superhero_dawn` named sets, volume density, `enc_unfinished_sunrise`, `item_rem_mercy_band`, `skill_steel_mercy`, dawn elite and adept roles. Prior slices S05, S07, and S11 where they already capped the jackal, the mercy wraith, and the Grid sentinel. S01 through S14 were not retuned.
