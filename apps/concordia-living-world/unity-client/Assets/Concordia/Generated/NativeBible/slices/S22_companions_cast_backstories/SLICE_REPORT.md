# SLICE REPORT — S22_companions_cast_backstories

STATUS: COMPLETE

Revision: cycle 2. The cycle-1 cast was already on disk. This pass deepens the same twelve. It does not add a person.

World: Cross. Cross is not a `WorldId`. It is the cast that already stands between the Hub and the spokes. Facet: companions. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity, Concord, or Claude process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Twelve homes, radii, verbs, flags, four quests |
| CAST.json | Primary: backstories, banter, attendance, errands |
| STORIES.md | The limits, the secrets left unsaid, the four errands |
| AURA_BIND_NOTES.md | Flag names, name-list, flower-law resolution |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S22_companions_cast_backstories/`.

## Counts

- Companions with intro, mid, and postboss lines: 12, each with one conditional alternate that shares the same flag. New companion ids: 0. The twelve are the volume ids.
- Gate walkers: 6 (Thorne, Maeris with a bog limit, Nyx, Jax, Kel, Calla). Stall, sand, salt-road, plaque, and Sere-only: the other 6.
- Mutual exclusion pairs: 1 (Jax, Vesper).
- Side quests: 6. The cycle-1 four, plus `q_s22_penanus_minute` and `q_s22_bead_count`.
- Rewards: xp only (40, 45, 50, 35, 40, 30). Coin 0. Items none. Skills none. Faction deltas none.
- Speak windows: taken from sheet phases where a sheet exists. Maren and Gale still have none, and none were invented.
- New creatures, mini-bosses, bosses, props required to spawn: 0.
- Guests explicitly not promoted: 7, plus the three pillars, plus Tunya and the Crucible as empty homes.

## Law placement

Flower Law stays 42 m. Gale's `skill_steel_parry` is live only in the Arena disk at (0, 18), radius 8 m. Every other steel assist on this list is a flower inside the Court and outside that disk. Brackish never enters hit resolution. Pinewood Crossing stays (62, −28). The Sere lip is not an objective of this facet.

One walker through a gate. Naming none completes `q_s22_one_walker`. The Hub salt-road errand is the documented exception and is not a combat party.

Volume shared banter flags are not the bind. Per-id flags are. The volume file was not edited.

## Sheet corrections recorded, not patched

Kel's volume `world_home` is Frontier. His sheet home is the Hub courier house. This slice follows the sheet and keeps the volume string visible as the Silas-quest label.

Vesper's volume `world_home` is Hub. The Dawn sheet's world is Superhero. The stall coordinate is the companion. The empire is not a dungeon added here.

Vesper's pronoun differs between `superhero/npcs.json` (he) and the Hub guest plate (she). Banter uses the name and no pronoun.

Esha's role id and Nyx's role id and Kel's role id are the volume's nearest plates. Bind notes forbid the costume those ids would naively pull.

Thorne's sheet body is an elf with full-body glow. The plate and the art direction win: CX, one wrist thread.

Maren and Gale have no npc-sheet biography. None was invented.

## Cycle-2 corrections

Mama Delgado is not written as already knowing the unit authorization. The crime sheet gives a cease-fire. The Dawn sheet gives a back-channel. The withheld-knowledge sentence was an inference and is withdrawn. The player remains forbidden to deliver the fact, and forbidden to tell Vesper who the Ghost is.

Maeris's sheet offers a lattice-fragment lesson. This slice refuses that path. The eight steps that return are the crossing she already teaches.

Kel's off-schedule minute is logged and not reported. The creature breach named on his weaponise line is not confirmed and not spawned.

Thorne can be dismissed by a taken bead as well as by a taken curse offer. No bead item is created.

## Honesty gaps

- `hub_portal_plaza`, `hub_courier_house`, `hub_bell_tower`, `fantasy_bog_clearing`, `the_open_table_meeting_ground`, and `ruins_rebel_war_tent` are schedule rooms without metres in `Canon.cs`. Quests point at the room names and at GuestDef stands. No coordinate was fabricated for the rooms.
- Maeris, Esha, Calla, and Kel have no `GuestDef` height. Height is null in the primary file.
- Brackish's unlock and Maren's unlock and Vesper's unlock share `q_hub_brackish_supper`, because that quest is the one that already touches all three. They do not thereby become one party.
- Postboss lines assume a remembrance item can be tested as still held. The item ids live in `VENDORS_AND_ITEMS.json` and were not duplicated here. A binder without that inventory check should not play the line.
- The apprentice who released Thorne's curse, whether that apprentice is alive, the three adults Nyx has not told, her unacknowledged eye replacement, Jax's survivor counts, Zaen's disguises, the Iyatte tavern, the Seam–Esha letter text, the ledger pages, and the ark stay unsaid. A later slice that speaks them has to be that slice on purpose.
- Mama's knowledge of the authorization is not in the unsaid list, because the sheets do not establish it.
- No live play session was run. This slice is text. Guest coordinates are copied from `Canon.cs` `HubGuests`.

## Sources read

`Canon.cs` WorldId, Gates, HubGuests, Pillars, Hub law. Volume `COMPANIONS.json`, `BOSSES_AND_RAIDS.json` encounter ids, `QUESTS_BY_WORLD.json` unlock ids, `QUESTS_CATALOG.md`. Native bible art direction, guest plate, roles, the eleven assist verbs in `SKILLS.json`. Hub npc sheets for Brackish, Kel Sandren, Old Seam. Fantasy Thorne and Maeris. Cyber Nyx. Crime Jax. Dawn Vesper. Ruins Calla and the third-uprising lore. Sere Esha, including the Old Seam hook. Frontier Silas chain for Kel. S21 for the lip, the tariff, and the rule that this facet does not retune them. S01 through S20 were not retuned.
