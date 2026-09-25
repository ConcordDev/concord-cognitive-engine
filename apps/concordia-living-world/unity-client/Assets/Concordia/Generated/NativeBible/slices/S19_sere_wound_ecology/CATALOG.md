# Catalog — S19 Sere wound ecology

WorldId `Sere`. Caps are this facet's instance budget. Volume weights stay 2 / 6 / 3 for hound, roach, and rat.

## Creatures

| Id | Cap | Where |
| --- | --- | --- |
| `faun_smog_roach` | 8, day and night | Keshar-facing 4 m lip of the 19.67 m Verge–Keshar open. Zero inside the harpy circle and inside a placed hall. |
| `faun_sodium_rat` | 6 night, 2 day | 5.13 m Tally–Hollowford seam only. Crime caps stay S09's. |
| `faun_mark_hound` | 1 by day, 0 at night | 22.86 m Aldermere–Tally open. Peak stays 1 during `enc_one_tile`. |
| `hyb_markharpy` | 1 ambient, 2 in the window, peak 2 | Verge–Keshar open while `furnace_belt` is unplaced. Both caps become 0 once the hall is placed. |
| `mon_road_watcher` `sere_invoice` | 1 | 26.23 m Dovrane–Keshar open, all hours. The window does not add a second body. |
| `mon_boss_compound_mark` | 0 ambient, 1 in `enc_compound_mark` | Unplaced `furnace_belt`. Recommended seat is the Verge-side 8 m of the same open. |
| `mon_grid_drone` | 0 | S11. Sodium skin stays unfielded. |

## Mini-bosses

| Id | Bodies | Clock | Floor |
| --- | --- | --- | --- |
| `enc_chest_stamp` | `hyb_markharpy` × 2 | 10–12, `day_index % 2 == 0` | Midpoint circle (−31.76, 21.34), hall unplaced |
| `enc_one_tile` | `faun_mark_hound` × 1 | 12–14, `day_index % 2 == 0` | Midpoint (18.99, 5.14) |
| `enc_empty_post` | `mon_road_watcher` × 1, skin `sere_invoice` | 5–7, `day_index % 4 == 1` | Midpoint (1.22, 35.74) |

## Boss

| Id | Clock | Token | Floor |
| --- | --- | --- | --- |
| `enc_compound_mark` | 17–20, cron `0 17 */3 * *`, unchanged | `item_rem_furnace_eye` | `furnace_belt` once placed |

## Quests

| Id | Giver | Floor |
| --- | --- | --- |
| `q_s19_lip_not_omen` | one `npc_role_sere_enforcer` | Verge–Keshar lip |
| `q_s19_no_second_pan` | a second enforcer, budget still 4 | Aldermere–Tally open |
| `q_s19_heat_not_a_name` | the lip enforcer, second loop | stamp window |
| `q_s19_empty_tariff` | the post board, no NPC | brother-gap, pre-dawn window |

No new item, no skill grant, no coin. `q_s19_empty_tariff` writes no faction delta.

## Unspawned

Sub-4 m slivers, the 4.16 m Tally–Spire corridor, every negative-gap overlap, district steps at (+8, −6), wilds 90–126 m, `tessera_spire`, `mark_tenement`, hollow–keshar 10.80 m, curtain–table 11.07 m, Pinewood Crossing, the megaworld present (−125.27, −269.29).

`mon_tunya_harpy`, `mon_ruins_wraith`, `hyb_ribwolf`, `faun_ash_wolf`, `hyb_billdrone`, `mon_boss_unender`, and `npc_role_road_bandit` stay at 0 on this facet.
