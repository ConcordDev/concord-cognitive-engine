# Aura bind notes — S23 Cross raids

Bind this facet after volume `BOSSES_AND_RAIDS.json` and after S01–S22. It adds one board, one arm predicate, and four quests. It does not edit the volume file, S09's hard gates, S14's spawn count, S17's two calendars, or any floor transform.

Do not commission a creature, a hybrid, a ninth gate, a wharf, a furnace hall, a census block, an aegis spire, or a Court boss. Do not download packs. Do not wipe `Library`. Do not re-download pines. Do not stop Concord, Unity, or Claude. A missing mesh spawns nothing. A Quaternius body is not a substitute for a CX person or for a monster.

## Board

1. `notice_seat_board` at Maren Ashveil's GuestDef stand (6.4, −3.1). Spawn count 0. All hours. The text is the qualified seats in hour order, with `yielded` on any seat that lost an hour of its window. No chalk circle, no prop mesh, no second Maren.
2. The world's own board, scout, and sound still have to play before a circle arms. The Court line is a fourth telegraph, not a replacement. Missing any of the four keeps the circle dark.
3. Do not print `hub_field_weakening`, `hub_dome_stabilisation`, the sealed genealogy, or the impossible print on this board.

## Arm predicate

Qualify each row on the clock its source already uses. Volume `every_nth_day` stays that file's cron hint. Do not move `enc_unender` onto `day_index`. Do not move S09's `day_index_equals` onto the volume cron.

For each integer hub hour, consider qualified rows whose window contains it. Seats outrank locals. Among seats, lowest `(gate_index - day_index % 9 + 9) % 9` wins. Among locals, earlier `open_hour` wins, then lower gate index. A row arms only when it wins every hour of its published window. Otherwise it yields the occurrence. Its next date is unchanged.

A yielded row does not backfill an hour the winner cannot use. If the winner's floor is unplaced or the mesh is a stub, spawn nothing and leave the hour empty.

S09 still skips `raid_unpaid_shift` when `enc_outstanding` is active, and still applies that raid's own suppression. This predicate is an additional filter. It does not delete those gates.

`raid_link_offschedule` stays spawn count 0. It is not a candidate. Its notice may name the seat. It does not spawn a domebreaker, a watcher, or a wolf.

## Floors that stay empty until their own slice places them

| Seat | Do not substitute |
| --- | --- |
| Census | `census_block`. Not the deck. Not a coast gap. |
| Unfinished | `unburial_court`. Not the war tent, not the political court, not `catalogue_hall`. |
| Held Curse | The fold set S03 named. Not the north hills. |
| Twelfth Reaper | The twelfth lip. Not Aekon Glacier Gate. |
| Last Dome | The mile past the frontier gate. Not the drift gap. Not the plaque at (−34, 0). |
| Outstanding Invoice | The wharf set. Not the warehouse anchor (10.72, 32.9). |
| Unfinished Sunrise | `aegis_spire`. Not a capital roof. |
| Un-Ender | S17's open and S17's width rule. Do not remeasure. |
| Compound Mark | `furnace_belt`. Not the lip (−17.71, −38.08). Not a capital. Do not retire S19's harpy window early. |

Pinewood Crossing stays (62, −28). `enc_milepost_fold` fights on the Fantasy side of that seam and does not enter the 42 m disk. `hyb_saltwyrm` stays outside the disk. `hyb_billdrone` stays `enc_rotor_saddle` with Cyber cap 0.

## Hit resolution

The Court board does not enter hit resolution. Inside 42 m, outside the Arena disk, Flower Law still flowers steel. Do not arm a circle at (0, 0). Do not put a seat on the Arena sand to dodge the flowers.

Phase verbs stay the ones volume already named: `skill_presence_refuse_count`, `skill_steel_unburial`, `skill_steel_curse_fold`, `skill_presence_do_not_reap`, `skill_steel_dust_kick`, `skill_steel_mercy`, `skill_craft_unend`, `skill_steel_shard`, `skill_presence_name_holder`, and S09's `skill_presence_witness` and `skill_steel_invoice` on the unpaid shift. No skill is granted. No remembrance is minted. A remembrance from one seat does not satisfy another seat's phase.

One companion from S22 may walk a gate on a seat night. The companion is not an add, not a tank, and not a turn-in. Naming none remains allowed. Jax does not walk a gate for `q_s23_yield_written`.

## Quest mouths

`q_s23_one_circle` offers and turns in on `archivist_maren`. The plaque walk uses the seat table in `RAIDS.json`. Sere and an empty day turn in with the sentence that there is no plaque. Do not complete `q_s21_no_ninth_plaque` by this sentence, and do not complete this quest by standing on the lip.

`q_s23_tide_of_flowers` offers and turns in on `oldseam`. The witness point is (0, 0). Spawning a creature there fails the quest. Do not advance the Nesha distance. Do not move the objective to Pinewood.

`q_s23_not_a_ladder` offers and turns in on `lyra`. She does not teach a ninth. Do not spawn a second Lyra in the Crucible.

`q_s23_yield_written` offers and turns in on `jax`. The slips are not `item_invoice_slip`. Coin on all four quests is 0. Faction deltas stay empty. Do not write a delta to `ghost_network`, `concordant_watch`, or any far-face id.

## Silhouette

Seat bodies keep the native-bible read: one mass, one emissive, distinct at 100 m. The Census is a hoop, not a crowd of UI. The furnace eye is the only emissive on the mark. The mercy sentinel is not the kestrel. The bill hound is not the dock hound. The road watcher reads as a post that is not a post, on a CX proportion, and is not a Quaternius body.
