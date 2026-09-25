# S23 catalog — Cross raids

Cross is the clock. WorldIds remain Hub, Cyber, Ruins, Fantasy, Tunya, Frontier, Crime, Superhero, Crucible, Sere. Nine law-raids. Hub holds the board and no circle. No new creature, item, skill, or faction delta.

## Arm law

| Rule | What it does |
| --- | --- |
| Qualification | Unchanged source clock. Volume cron stays a day-of-month hint. S09 keeps `day_index_equals`. S17 keeps the Un-Ender on that cron and the vein on `day_index`. |
| Hour | `open_hour <= h < close_hour`. |
| Rank | A qualified seat beats every local. Locals contest only an hour no seat won. |
| Rotation | `position = (gate_index - day_index % 9 + 9) % 9`. Lowest position wins the hour. |
| Locals | Earlier `open_hour` wins. Equal opens break to the lower gate index. |
| Full window | Arm only if the row wins every hour it published. Otherwise the whole occurrence yields. Next cadence date stays. |
| Quiet | Hours a row won and then could not keep, and hours whose winner has no floor, stay empty. No backfill. |
| Court | Nothing arms inside 42 m. Arena sand is not a seat. |

## Nine seats

Gate order, then Sere. Schedules are the volume windows, not a new calendar. Remembrance ids are the volume ids.

| Seat | World | Hours | Cadence | Body | Remembrance | Plaque |
| --- | --- | --- | --- | --- | --- | --- |
| `raid_seat_census` | Cyber, The Grid | 2–4 | every 3rd | `mon_boss_census` | `item_rem_missing_number` | (34.00, 0.00) |
| `raid_seat_unfinished` | Ruins | 21–23 | every 3rd | `mon_boss_unfinished` | `item_rem_unfinished_mask` | (24.04, 24.04) |
| `raid_seat_held_curse` | Fantasy, the Sundering | 19–22 | every 3rd | `mon_boss_held_curse` | `item_rem_crest_shard` | (0.00, 34.00) |
| `raid_seat_twelfth_reap` | Tunya | 6–9 | every 3rd | harpy + reap jackal | `item_rem_reap_talon` | (−24.04, 24.04) |
| `raid_seat_last_dome` | Frontier | 12–15 | every 3rd | `mon_frontier_domebreaker` | `item_rem_dome_rivet` | (−34.00, 0.00) |
| `raid_seat_outstanding` | Crime, Iron Coast | 18–21 | every 2nd | `mon_coast_billhound` | `item_rem_invoice_stamp` | (−24.04, −24.04) |
| `raid_seat_unfinished_sunrise` | Superhero, Permanent Dawn | 5–7 | every 2nd | `mon_dawn_mercy_sentinel` | `item_rem_mercy_band` | (0.00, −34.00) |
| `raid_seat_unender` | Crucible | 20–23 | every 3rd, day-of-month cron | `mon_boss_unender` | `item_rem_unclosed_seam` | (24.04, −24.04) |
| `raid_seat_compound_mark` | Sere, waystone | 17–20 | every 3rd | `mon_boss_compound_mark` | `item_rem_furnace_eye` | none |

Floors stay with the slices that measured them. Census block, unburial court, fold set, twelfth lip, frontier mile, wharf, aegis spire, and furnace belt are unplaced sentences. The Un-Ender's open stays S17's width rule. Until those floors exist, the winner spawns nothing.

## Locals

Not seats. They keep their own clocks and lose any hour a seat won.

| Id | World | Hours | Clock | Body | Remembrance |
| --- | --- | --- | --- | --- | --- |
| `enc_fold_basilisk` | Fantasy | 11–14 | every 2nd | `mon_sunder_basilisk` | `item_rem_hood_scale` |
| `enc_milepost_fold` | Fantasy, seam | 16–18 | every 4th | `mon_sunder_griffin` | `item_rem_milepost_splinter` |
| `enc_catalogue_walks` | Ruins | 15–17 | every 2nd | crawler + wraiths | `item_rem_catalogue_tooth` |
| `enc_junction_null` | Cyber | 13–15 | every 2nd | sentinel + construct | `item_rem_null_ring` |
| `enc_road_followed` | Frontier | 8–11 | every 4th | `mon_road_watcher` | `item_rem_watcher_nail` |
| `enc_stair_switch` | Crime | 10–13 | `day_index % 2 == 1` | one CX bandit | none |
| `enc_hook_shift` | Crime | 14–17 | `day_index % 3 == 0` | one CX laborer | none |
| `enc_rotor_saddle` | Crime | 5–7 | `day_index % 3 == 1` | `hyb_billdrone` | none |
| `raid_unpaid_shift` | Crime | 22–24 | `day_index % 4 == 3` | foreman, two hoods, two dock hounds | slip only, never the stamp |
| `raid_link_offschedule` | Frontier | 21–24 | `day_index % 7 == 0` | none, spawn 0 | none |

The milepost griffin stays on the Fantasy side of Pinewood Crossing (62, −28). The rotor stays on the coast gap. The unpaid shift stays on the warehouse anchor (10.72, 32.9). The link notice stays at (48.72, −9.79) and is not a candidate.

## Worked days

Under the stand-in `day_index % n == 0` for volume `every_nth_day` (not a retune of the Un-Ender's calendar):

| Day | Rotation start | Arms | Quiet on purpose |
| --- | --- | --- | --- |
| 0 | Cyber | Census, Twelfth Reaper, Last Dome, Unfinished | Curse wins 19–20 and then loses 21, so those hours stay empty. Hook wins 15–16 and then fails its window, so the catalogue does not backfill. |
| 12 | Tunya | Census, Twelfth Reaper, Last Dome, Outstanding Invoice | The invoice's position beats the curse. The curse yields. The hound still waits on the wharf set. |

## Quests

| Id | Giver | Stand | Turn-in |
| --- | --- | --- | --- |
| `q_s23_one_circle` | Maren Ashveil | (6.4, −3.1) | same stand, after the board and one plaque or the no-plaque sentence |
| `q_s23_tide_of_flowers` | Old Seam | (−11.2, −4.1) | same stand, after (0, 0) |
| `q_s23_not_a_ladder` | Lyra Silentchant | (5.5, 14.8) | same stand, after the remembrance sentence |
| `q_s23_yield_written` | Jax Rivera | (−18.2, −5.5) | same stand, after the board |

Rewards: xp 40, 45, 40, 50. Coin 0. Items none. Skills none. Faction deltas none. Spawn count on the board is 0.

## Combat ceiling

Phases and creature ids are the volume rows. This slice adds the Court line of the telegraph and the yield. Flower Law still flowers steel inside 42 m outside the Arena. A seat is fought in its own world, on its own floor, after board, scout, and sound. One S22 walker may cross a gate. The walker is not on the creature roster.
