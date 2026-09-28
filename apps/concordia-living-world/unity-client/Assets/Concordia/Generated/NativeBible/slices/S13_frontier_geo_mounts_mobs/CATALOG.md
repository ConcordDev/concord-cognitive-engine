# Catalog — S13 Frontier geography, mounts, road mobs

WorldId Frontier. Law: drop the dome; wind will do the rest. People fight Muay Thai and carry wagon iron or a skinner. The cross-world road-bandit row still says Sword in the catalog; this instance skins the weapon as `wpn_1h_frontier_skinner` and does not edit the role file. Caps are alive counts. Weights in `DENSITY_TABLES.json` stay as written.

## Floors

| Floor | Point | What it is |
| --- | --- | --- |
| Salt lens | Capital midpoint (47.84, −29.98) | Couriers radius 23 and Pioneer radius 23, centers 24.46 m apart, overlap 21.54 m. Pinewood Crossing sits inside both discs. |
| Pinewood exclusion | (62, −28), radius 12 m | S01 owns the hitch, the stag, the hare, and the salt wyrm. This facet's fauna and crowds stay outside the disk. |
| Drift gap | (42.99, 14.03) | Open 18.71 m between Freenodes and Couriers. Wolves, the morning chevron, the canvas dive. |
| Pale flat | (17.07, −50.92) | Open 16.02 m between Mesh Cult and Pioneer. One pronghorn herd by day. |
| Cut | (19.55, 5.29) | Open 28.62 m between Signal Pirates and Couriers. Two dome bandits, one road bandit. |
| Council hitch | (54.82, −48.16) | Placed `alliance_council_township`. Two led horses. One guard. 21.40 m from Pinewood. |
| Courier rim of the cut | (31.70, 0.82) and (26.74, −5.46) | Two guards, 2 m outside the Couriers disc, facing the camp. |
| Drift shoulders | (50.86, 15.48) and (35.13, 12.58) | Two guards. The north shoulder gives the sail quest. Wolves stay on the gap center. |
| Link Post Alpha | (56.86, −23.79) | Placed district. 6.64 m from Pinewood, inside the exclusion. Cap 0 for this facet. |
| Enclave ridge | (35.08, 29.94) | Placed `enclave_north_ridge`, inside the Freenodes disc and the Isolationist disc. Cap 0. |
| Unplaced | — | `wagon_yard`, `wind_camp`, `broken_dome_rib`, `ambush_corridor_seven`, `frontier_perimeter`, the Mesh Gate, Silas's western route, the volume mile, the volume wagon-mile. |

## Mounts and vehicles

| Id | Verb | Cap | Floor |
| --- | --- | --- | --- |
| `mount_wagon_horse` / `faun_wagon_horse` | lead | 2 here, plus S01's 2 at the Crossing | Council hitch |
| `mount_wind_pronghorn` / `faun_wind_pronghorn` | call and follow, no tack | 6 day / 0 night, one herd | Pale flat |
| `veh_salt_wagon` | hitch and walk, horse required | Uses the council pair | Council hitch toward the lens rim, stopping at the 12 m exclusion |
| `veh_frontier_windwagon` | drift with wind, no horse | One pushed prop during the sail quest | Drift gap |

Griffins are not mounts. The dust courser, the thunder yak, and the rail vulture have no bible row. They spawn nothing.

## Crowds and fauna

| Id | Kind | Cap | Floor | Note |
| --- | --- | --- | --- | --- |
| `npc_role_frontier_guard` | CX road warden | 5 | Council 1, drift shoulders 2, cut rim 2 | Volume budget. Hail stays on. |
| `npc_role_frontier_bandit` | CX dome bandit | 2 | Cut | Off the salt rut. Yoke collar is a necklace. |
| `npc_role_road_bandit` | CX, Frontier skin | 1 | Cut | One camp. Hail giver for the argument quest. |
| `faun_dust_wolf` | Animal | 3 | Drift gap | Drops to 0 while the canvas dive is up. The morning window uses these three, not three more. |
| `faun_wagon_horse` | Mount | 2 | Council hitch | Lead, tack, pin. S01's pair is a different floor. |
| `faun_wind_pronghorn` | Prey | 6 day / 0 night | Pale flat | Unpenned. White rump is the flag. |
| `mon_frontier_domebreaker` | Brute | 0 until the mile is placed | Volume anchor | Weight 0 in the density table. Encounter only. |
| `mon_road_watcher` | Elite, skin `frontier_iron` | 0 until the wagon-mile is placed | Volume anchor | One per spoke in the bible. This spoke's point is still a sentence. |
| `hyb_dustgriffin` | Hybrid | 0 ambient, 1 in the dusk window | Drift gap | Catalog `hostile` stays false. Mesa sentence has no mesa. |

## Mini-bosses

| Window | Body | When | Floor |
| --- | --- | --- | --- |
| `enc_chevron_morning` | The same three dust wolves | Hours 5–7, `day_index % 2 == 0` | Drift gap |
| `enc_canvas_dive` | One dustgriffin | Hours 16–19, `day_index % 5 == 4` | Drift gap, wolves cleared off |
| `enc_last_dome` | One domebreaker | Volume: hours 12–15, every third day | Unplaced mile. Clock kept. |
| `enc_road_followed` | One road watcher | Volume: hours 8–11, every fourth day | Unplaced wagon-mile. Clock kept. |

No raid. The rivet and the nail do not move onto the drift gap to give those clocks a substitute body.

## Side quests

| Id | Giver | Pays |
| --- | --- | --- |
| `q_s13_salt_chord` | One council guard inside the budget of 5 | xp 40. Pioneer standing +1. No item. |
| `q_s13_sail_not_roof` | The north drift-shoulder guard | xp 45. Freenodes standing +1 if the sail stays cloth. No skill grant. |
| `q_s13_two_cuts` | The one road bandit | xp 50. Couriers standing +1 for leaving both cuts unpaid. No ransom chit. |

The eight `q_frontier_*` volume rows and the canon chains they extend stay as they are.

## Unspawned on purpose

Canon seeds `dust_courser`, `rail_vulture`, `thunder_yak`. Alias `hound` with no Frontier animal row. Named sets with no point. Zara's rifle, the pioneer rifle preference, and Hane Okra's rifle work. Hidden truths in the compromised relays, the Handshake seeding, and the parcel addressee. Mesh Gate at a computed centroid that is not a monument. `frontier_militia` with no country disc.
