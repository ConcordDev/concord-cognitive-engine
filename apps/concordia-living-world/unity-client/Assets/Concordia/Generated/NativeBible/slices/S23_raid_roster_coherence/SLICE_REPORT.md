# SLICE REPORT — S23_raid_roster_coherence

STATUS: COMPLETE

World: Cross. Cross is not a `WorldId`. It is the hub clock over the eight gates and the Sere waystone. Facet: raids. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity, Concord, or Claude process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Nine seats, ten locals, the arm law, four quests |
| RAIDS.json | Primary |
| STORIES.md | The nine refusals, the Court, the four errands |
| AURA_BIND_NOTES.md | Predicate, empty floors, quest mouths |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S23_raid_roster_coherence/`.

## Counts

- Named seats: 9. One law-raid for Cyber, Ruins, Fantasy, Tunya, Frontier, Crime, Superhero, Crucible, and Sere. Hub is the board, not a seat.
- New creature ids: 0. New remembrance ids: 0. New skills: 0. Faction deltas: 0. Coin: 0.
- Local rows cited, not retuned: 10, including `raid_unpaid_shift` and the telegraph-only `raid_link_offschedule`.
- Side quests: 4. `q_s23_one_circle`, `q_s23_tide_of_flowers`, `q_s23_not_a_ladder`, `q_s23_yield_written`. Rewards xp 40, 45, 40, 50.
- Volume file edited: no. Prior slices retuned: no.

## Law placement

Flower Law stays 42 m. No circle arms in that disk. Arena steel stays the disk at (0, 18), radius 8 m, and is not a seat. Pinewood Crossing stays (62, −28). The milepost griffin stays on the Fantasy side of that seam.

A row keeps the schedule its source published. The new predicate is exclusion only: one circle in an hour, seats ahead of locals, rotation `(gate_index - day_index % 9 + 9) % 9`, full window or yield, no backfill when the winner's floor is empty. Remembrance does not cross seats.

On the stand-in day_index 0, the rows that arm are the Census, the Twelfth Reaper, the Last Dome, and the Unfinished. The curse wins two hours and then loses a third, so it yields and those hours stay quiet. The arithmetic was checked against the predicate. It is an illustration under `day_index % n == 0`, not a move of the Un-Ender off its day-of-month cron.

## Honesty gaps

- Every seat floor named by S03, S05, S07, S09, S11, S13, S15, and S19 is still an unplaced sentence, except the Un-Ender, whose open and width rule stay S17's. Winning the clock spawns nothing until that floor exists. This slice does not invent the metres.
- `enc_unender` and the volume crons may be day-of-month while S09 and S17's vein use `day_index`. The predicate applies after whichever clock qualified the row. The worked examples use one stand-in so the overlap can be read. They are not a second calendar.
- Maren has no separate npc-sheet biography. The quest uses the GuestDef and S02's filing instrument. Asbir is not made a confessor. The southern arc, the sealed genealogy, and the impossible print stay off the board.
- No live play session was run. This slice is text. Guest coordinates and plaque coordinates are copied from `Canon.cs` and from S21's published ring points.

## Sources read

`Canon.cs` WorldId, Gates, HubGuests, Hub law, Flower Law 42 m, Arena, refusals. Hub lore: the ring, the Year 38 attempt, the embassy era, the ninth refusal, the lattice correspondence, the present web. Volume `BOSSES_AND_RAIDS.json` and the remembrance ids in `VENDORS_AND_ITEMS.json`. Native bible taxonomy, art direction, hybrid world pairs. S09 unpaid shift and coast windows. S14 telegraph-only door. Floor sentences in S03, S05, S07, S11, S13, S15, S17, S19. S21 plaques and the Sere lip. S22 one-walker rule, so Jax is not hired into a seat. S02 so Maren, Lyra, Old Seam, and the unpublished southern arc were not restaged.
