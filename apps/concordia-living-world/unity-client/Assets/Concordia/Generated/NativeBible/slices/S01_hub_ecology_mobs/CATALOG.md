# Catalog — S01 Hub ecology

Seven spawn rows. Zero bosses. Caps are alive-at-once for the Hub instance. Volume weights are unchanged and listed so a binder does not add them on top of the caps.

| id | Name | Where | Cap | Law | Temper |
| --- | --- | --- | --- | --- | --- |
| `faun_court_pigeon` | Court Pigeon | Roofs inside 42 m, plus 2 on the gatehouse | 14 in the law, 4 perched at night, 24 only for the Founding Day reading | Flower. No land on sand | Ambient |
| `faun_lantern_moth` | Lantern Moth | Lantern radii inside 42 m, dusk and night | 24, of which at most 6 on the southern quarter | Flower. No damage | Ambient |
| `faun_court_cat` | Market Mouser | Market wedge and archive steps | 3 solitary territories | Flower. Pounce is for mice | Light hostile, vermin only |
| `faun_saltroad_hare` | Salt-Road Hare | Shoulders from 42 m out to Pinewood | 0 ambient inside the law, 4 on the gate shoulder, 6 past the wall | Steel on the road. Quest stray is the only one inside | Flee. Freezes at flowers, bolts at steel |
| `faun_pinewood_stag` | Pinewood Stag | Verge past the wall, toward (62, −28) | 0 inside the wall, 5 when the group is up | Steel on the road. Shove is for horse or wyrm | Wary herd |
| `faun_wagon_horse` | Wagon Horse | Hitch outside the law | 2 | Led across the disk by day only | Working. Not rideable in this slice |
| `hyb_saltwyrm` | Salt Wyrm | Milepost ditch past 42 m | 1 | Spit that crosses the disk becomes flower-crust and no slow | Territorial. Not a boss |

## Weights already shipped

Pigeon 6, moth 4, cat 3, hare 2, stag 1, horse 1. The wyrm is not in the volume fauna weight list. Its cap is the bible spawn of one, with `plaza_forbid`.

## Quests in this slice

| id | Giver | Turn-in | Does not replace |
| --- | --- | --- | --- |
| `q_hub_moth_count` | Lamplighter, once, or his chalk if Three Lanterns already took the meeting | Maren Ashveil | `q_hub_lamplighter_round` |
| `q_hub_mouser_third_crate` | Asbir | Asbir | `q_hub_three_notebooks` |
| `q_hub_hare_empty_hands` | Kiren Owl | Kiren Owl | — |
| `q_hub_ditch_spit` | Kiren Owl | Kiren Owl | `q_hub_pinewood_milepost` (prerequisite) |

## Unspawned

`plaza_strider`, `cistern_lurker`. `lamplighter_moth` is the moth's old seed name, not a second animal. `ember_sprite` stays on the Training Hollow drill.

## Rings used

Court 16 m, embassy ring 34 m, Flower Law 42 m, wall 56 m, Arena disk 8 m around (0, 0, 18). Pinewood Crossing is outside the wall.
