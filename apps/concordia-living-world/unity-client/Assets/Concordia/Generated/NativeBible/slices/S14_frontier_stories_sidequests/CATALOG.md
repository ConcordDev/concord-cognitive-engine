# Catalog — S14 Frontier politics, culture, side quests

WorldId Frontier. Law: drop the dome; wind will do the rest. People on these pins fight Muay Thai with empty hands. Caps below are alive counts for this facet. S13's caps are cited and unchanged. Weights in `DENSITY_TABLES.json` stay as written.

## Claims

| Country | Center | Radius | Sheet reputation | Motto |
| --- | --- | --- | --- | --- |
| Couriers' Guild | (48.86, −17.79) | 23 | 70 | We carry what cannot be sent. |
| Freenodes | (37.13, 45.85) | 23 | 55 | Every peer is a sovereign. |
| Signal Pirates | (−9.77, 28.37) | 23 | 28 | If it crosses our ground, it crosses our cut. |
| Isolationist Enclaves | (27.08, 35.94) | 23 | 42 | We were here before the Web. We remain. |
| Mesh Cult | (−12.68, −59.67) | 23 | 38 | The Web has chosen us. Listen to the routing. |
| Pioneer Township Alliance | (46.82, −42.16) | 23 | 62 | We built this with our own hands and the Web in our pockets. |

Overlaps that matter here: Couriers with Pioneer 21.54 m (the salt), Freenodes with Isolationists 31.89 m (the ridge and the camp sit in both). Gaps S13 already used: Freenodes–Couriers 18.71 m (drift), Mesh–Pioneer 16.02 m (pale flat), Pirates–Couriers 28.62 m (cut). The militia has no disc.

## Hash pins

Key `settlement/concord-link-frontier/{faction}:{district}`. Radius 8 + 2 × index. Coordinates rounded to two decimals.

| District | Point | Staff |
| --- | --- | --- |
| `link_post_alpha` | (48.72, −9.79) | Ria, 5–19. Placed post (56.86, −23.79) stays cap 0, 16.19 m away. |
| `courier_safehouses` | (45.94, −8.23) | Empty. 3.19 m from Ria. |
| `brokers_camp` | (44.74, 48.32) | Temir, 6–15. Inside Freenodes and Isolationists. Placed camp empty, 8.48 m. |
| `field_relays` | (47.09, 44.98) | Empty. 4.08 m from Temir. |
| `pirate_cove_north` | (−16.16, 33.18) | Vexa, 7–11 and 19–23. 45.31 m from the cut. |
| `ambush_corridor_seven` | (−13.03, 18.91) | Empty. |
| `enclave_north_ridge` | (20.78, 40.87) | Brunn, 8–12 and 15–19. Placed ridge stays cap 0, 18.00 m. |
| `enclave_old_rivermouth` | (19.20, 42.10) | Empty. 2.00 m from Brunn. |
| `mesh_temple_central` | (−19.74, −55.91) | Torven, 7–19. 37.15 m from the pale flat. |
| `routing_meditation_hall` | (−15.77, −50.16) | Empty. 6.99 m from the temple. |
| `alliance_council_township` | (53.82, −38.28) | Marsenn, 8–12. 13.14 m from Pinewood. 9.93 m from the hitch. |
| `trade_caravan_route` | (41.52, −50.64) | Empty. 17.44 m from Marsenn. |

## Presences

| Id | Who | Window | Hands |
| --- | --- | --- | --- |
| `presence_ria_post` | Postmaster Ria Hale | 5–19 | Empty. Dagger stays on the sheet. |
| `presence_temir_camp` | Temir | 6–15 | Empty. They. |
| `presence_vexa_cove` | Vexa of the North Cove | 7–11, 19–23 | Empty. Belt blades unbound. |
| `presence_brunn_ridge` | Brunn | 8–12, 15–19 | Empty. |
| `presence_torven_temple` | Torven | 7–19 | Empty. Staff unbound. |
| `presence_marsenn_council` | Marsenn | 8–12 | Empty. No rifle. |

## Side quests

| Id | Giver | Stops at |
| --- | --- | --- |
| `q_s14_seven_unstated` | Ria | Seven days, three relays, Guild still silent. xp 40. |
| `q_s14_both_signatures` | Temir | Both names, or it is not a record. xp 45. |
| `q_s14_two_log_lines` | Ria | Receipt logged, delivery not logged. xp 40. |
| `q_s14_constitution_quiet` | Ria | No line for Lin. She will not add one. xp 35. |
| `q_s14_seal_at_the_cove` | Vexa | Seal shut, second captain unnamed. xp 50. |
| `q_s14_ridge_unspoken` | Brunn | Three prohibitions. The grandson sentence unasked. xp 40. |
| `q_s14_page_stays` | Torven | Sermon preparing. Page not copied. xp 45. |
| `q_s14_postponed_third` | Marsenn | Postponed three times. Family unnamed. xp 40. |

No coin, no item, no skill, no faction delta. Sheet reputations stay.

## Link telegraph

| Id | When | Where | Roster |
| --- | --- | --- | --- |
| `raid_link_offschedule` | Hours 21–24, `day_index % 7 == 0` | Board at (48.72, −9.79). Ria absent. | 0 |

`enc_last_dome`, `enc_road_followed`, `enc_chevron_morning`, and `enc_canvas_dive` keep their clocks. This notice does not suppress them and they do not suppress it.

## Unspawned on purpose

Lin, Dorvik, Kestra, Iso, Kerith, Zara, Hane, Oren Voss, Jensa, Pell, Dust Rose, Mara, Silas. The militia. The Mesh Gate plaque. The six-capital average (22.91, −1.58). Generated Accord Heirs and Assembly Witnesses. Hidden truths listed in `POLITICS.json`.
