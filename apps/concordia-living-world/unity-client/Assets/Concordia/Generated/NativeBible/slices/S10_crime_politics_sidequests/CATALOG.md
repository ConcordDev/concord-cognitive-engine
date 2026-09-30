# Catalog — S10 Iron Coast politics

WorldId `Crime`. Display Iron Coast. Primary file `POLITICS.json`.

## Claims

| Country | Capital | Radius | Relation that matters |
| --- | --- | --- | --- |
| `ghost_network` | (2.72, 38.9) | 23 | 9.27 m from Rose, overlap 41.73 m |
| `iron_rose_syndicate` | (−6.41, 40.5) | 28 | Estate pin sits inside the Ghost disk |
| `crime_federal_task_force` | (38.81, 43.1) | 23 | Circles overlap Ghost by 9.67 m; the secure-floor pin does not |
| `crime_north_market_gang` | (13.45, −43.99) | 23 | 83.58 m from Ghost, gap 37.58 m |
| `crime_corrupt_precinct` | (23.05, −54.31) | 23 | 1.03 m from Halloran's capital |
| `crime_pi_agency` | (24.0, −53.9) | 23 | Office door is 9.49 m from the precinct house |
| `crime_white_collar_ring` | (−49.17, −16.93) | 25.5 | Office is 70.51 m from the warehouse, outside every other circle |

No country, so no pin: `thorpe_family`, `crime_watch`, `city_judiciary`, `wharf_workers`. Generated `gen_crime_faction_0000` (Iron Racket) is not an eighth claim.

## Where people stand

| Presence | Pin | Point | Window |
| --- | --- | --- | --- |
| `mama_delgado` | `iron_rose_estate` | (−7.66, 28.57) | 8–12 |
| `captain_marquez_14th` | `14th_precinct_house` | (15.44, −56.78) | 8–12 |
| `pi_lead_halloran` | `halloran_greer_office` | (23.44, −61.88) | 8–12 |
| `gang_lead_dom_north_market` | `north_market_main_block` | (21.39, −44.96) | 9–13 |
| `accountant_iris_hexshore` | `hexshore_holdings_office` | (−45.29, −9.93) | 7–12 |
| `agent_navarro_federal` | `federal_field_office_secure_floor` | (36.07, 35.58) | 7–12 |
| `informant_silas_bell` | gap midpoint | (8.09, −2.55) | 10–16, even `day_index` only |

S09 floors that stay mob floors and gain no new cap: warehouse (10.72, 32.9), gap for bandits and rats, wharf set still dark. Fixed-step labels this facet does not occupy: (1.59, 34.5), (46.81, 37.1), (21.45, −49.99). Hash dockside (2.30, 46.89) is not the warehouse.

## Vendors

| Id | Person | Spawn |
| --- | --- | --- |
| `vend_crime_bell` | Bell | The gap, on the rule above. Stock unchanged: slip, switchknife, hook, rose pin. One tip per slate. |
| Maddox Kray | Wharf fence | Nothing. Wharf unplaced. Volume quests already use him. |
| Old Lou | Sunken Anchor | Nothing. No drink id. Collar quest stays S09. Memorial stays on the unplaced pier. |

## Side quests

| Id | Giver | Stops at |
| --- | --- | --- |
| `q_s10_seven_minutes` | Mama | Seven minutes, both alive, no transcript |
| `q_s10_three_unnamed` | Mama | Three skimmers, no names |
| `q_s10_other_call` | Marquez | The quiet cut, locker shut |
| `q_s10_walkup_door` | Halloran | Two doors, residence empty |
| `q_s10_source_unknown` | Navarro | The word unknown |
| `q_s10_ledger_undecided` | Iris | No decision, two warrens shut |
| `q_s10_pitch_refused` | Dom | Pitch already refused, alley empty |
| `q_s10_gap_between` | Bell | Docks north, block south, slate still one |

No skill, no coin, no item, no faction delta.

## Combat ceiling

S09 keeps `enc_outstanding`, `enc_stair_switch`, `enc_hook_shift`, `enc_rotor_saddle`, and `raid_unpaid_shift`. This facet's four encounters have no health table. `enc_s10_south_morning` is three pins. `enc_s10_two_desks` is 93.22 m of not meeting. A kill fails the quest and drops nothing.

## Unspawned on purpose

Jax, Cipher, Tomás, Renny, Lou, Maddox, Dahlia, Ada, Iniko, Pia, Thorpe, Pidgeon, the generated coast names, Iron Racket. Canon creature seeds with no bible mesh stay S09's list and are still not spawned: `rage_junkie`, `scrap_golem`, `night_crawler`, `chrome_enforcer`, `ash_hound`.
