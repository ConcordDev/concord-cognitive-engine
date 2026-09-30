# Catalog — S04 Sundering geography

Eight faction rows already on the sheet. No new faction id. Six side quests. One political presence. No new boss.

Distances are hypot from the Court origin. Flower means inside 42 m. Wall means inside 56 m.

| Anchor | Point | Dist | Disk | Spawn |
| --- | --- | --- | --- | --- |
| Pinewood Crossing | (62, −28) | 68.0 | outside | Read the Hub post. Do not plant another. |
| Salt toll | (62, −20) | 65.2 | outside | One CX road bandit. No health table. |
| League gate | (−58.26, −21.21) | 62.0 | outside | A board with two marks. No crowd. 120 m from the post. |
| Camp north | (−50.26, −27.21) | 57.2 | outside | Named. Not stocked. |
| Crown gate | (−53.83, 15.44) | 56.0 | on the wall | Do not stride a palace across the line. |
| Voss gate | (46.64, 29.15) | 55.0 | wall, steel | Do not open the audience again. |
| Crimson quarter | (54.64, 23.15) | 59.3 | outside | No masquerade set. |
| Spire gate | (−49.73, 5.23) | 50.0 | wall, steel | No practicum yard. |
| Wildwood gate | (−29.55, 37.82) | 48.0 | wall, steel | One ward, off the lane. |
| Obsidian palace point | (−45.83, 9.44) | 46.8 | wall, steel | No throne mesh. |
| Spire district | (−41.73, −0.77) | 41.7 | flower | No yard. |
| Thornwood glade | (−21.55, 31.82) | 38.4 | flower | Corin, if his mesh exists. Not the keep. |
| Chapter house point | (−8.97, −36.61) | 37.7 | flower | Not used. The gate is the meeting. |
| Thieves gate | (−17.94, 32.36) | 37.0 | flower | No raid. A knife here is a flower. |
| Underwarrens point | (−9.94, 26.36) | 28.2 | flower | No fence stock. |
| Paladin gate | (−16.97, −30.61) | 35.0 | flower | Aria, if her mesh exists. |
| Pantheon gate | (6.24, 29.34) | 30.0 | flower | Kaelan, if her mesh exists. Clear of the lane by 2.4 m. |
| Pantheon temple | (14.24, 23.34) | 27.3 | flower, on the stride | Spawn nothing. Clearance to the blocked strip is 0.4 m. |

## Cultures

| id | Where it is visible | Body | Gold |
| --- | --- | --- | --- |
| Grove | Ward path, wildwood gate, salt-road reading, glade | CX ward, moss leather, one stitch | Leaf worn through to granite |
| Ash | Quiet Grove (unplaced), bog absence, NE margin already capped by S03 | CX mystic, not a second Thorne | Leaf painted shut |

## Presences

| id | Role | Count | Budget |
| --- | --- | --- | --- |
| Pinewood ward | `npc_role_sunder_guard` | 1 | Same body as the S03 pine-verge ward |
| NE ward | `npc_role_sunder_guard` | 1 | S03 post, unchanged |
| Wildwood-gate ward | `npc_role_sunder_guard` | 1 | New post, still inside the 5 |
| Barrack pair | `npc_role_sunder_guard` | 2 | Spawn nothing until `ward_barrack` exists |
| Bog mystic | `npc_role_sunder_mystic` | 1 | Only after the bog crossing has a transform |
| Quiet mystic | `npc_role_sunder_mystic` | 1 | Spawn nothing |

`enc_salt_toll` is the Salt Writ. Count 1. No hit points.

## Quests

| id | Giver | Where it closes | Does not replace |
| --- | --- | --- | --- |
| `q_s04_salt_writ` | Pinewood ward | Same ward | Hub milepost, S03 coat, quench |
| `q_s04_greenmire_blank` | Maeris | Maeris | Both bog chains |
| `q_s04_unwritten_third` | Kaelan | Pantheon gate | Fold refusal, lacquer box |
| `q_s04_nineteen_days` | Corin | Glade anchor | Seraphine's audience |
| `q_s04_one_braid` | Pinewood ward | League gate, then the ward | The salt writ |
| `q_s04_no_verdict` | Aria | Paladin gate | Lacquer box, the truce errand |

## Combat ceiling, cited

Held Curse, basilisk, ashfang pair, cursebeak, milepost griffin. Caps and clocks stay on S03 and the volume. This slice tells who would like to use them, and does not restage them.

## Unplaced on purpose

Quiet Grove, bog coordinates, Thornwood keep, the Verge, camp south, raid corridor three, the neutral monastery, the Voss estate and vault, the drake aerie, the crypt perimeter, Greenmire, and the four Houses without rows: Vaelmoor, Thornvale, Sereth, Ablon.
