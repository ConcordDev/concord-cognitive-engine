# Catalog — S07 Sovereign Ruins bosses

Six living rows with caps, two hybrids held at zero, one griffin held at zero, one boss. Volume weights are unchanged. Country circles are rims. Kit sets spawn nothing until they have a transform.

| id | Name | Where | Cap | Place in the ash | Temper |
| --- | --- | --- | --- | --- | --- |
| `faun_ash_wolf` | Catalogue Wolf | `basin_open_carry` | 4, one pack, dusk–night. Day 0. During the returned-kill window the pack is the event | Returns to a kill and leaves it | Nip only if the kill is disturbed |
| `faun_catalogue_crow` | Catalogue Crow | `bone_yard`, day | 8, and 0 inside an active yard circle. Night 0 | Commas on a rib | Perch |
| `faun_rib_lizard` | Rib Lizard | `bone_yard`, day, sunned bone | 3, and 0 inside an active circle. Night 0 | Furniture, not loot | Bask |
| `mon_ruins_wraith` | Unfinished Wraith | Archivist edge, interiors once a hall exists | Ambient 2. Zero during the late breath and during the catalogue walk | Person-shaped gap. Bell is the mass | Reach. Breath arrives late |
| `mon_ruins_crawler` | Rib Crawler | `bone_yard` | Ambient 1. Zero during the catalogue walk, when the event is the one walker | Writes a line with no author | Brace, ram, nail |
| `hyb_ribwolf` | Ribwolf | `bone_yard` | Ambient 2. Zero during the basket window, when the event is the pair | Wolf with an external rib basket | Rattle, then charge |
| `mon_boss_unfinished` | The Unfinished | `unburial_court` | 1, and only in the volume night window, and only after the set is placed | A death catalogued mid-page | Slab, long arm, ask |

## Held at zero

| id | Why the cap is zero |
| --- | --- |
| `hyb_ashfang` | S03 `enc_ashfang_seam` on the Fantasy shoulder. Hours 7–10, every second day, count 2. |
| `hyb_mercywraith` | Lists Superhero and Ruins. Those worlds are not ring neighbors. No import floor is built on the envoy capital. |
| `mon_sunder_griffin` | Milepost encounter. WorldDef names a griffin. This facet does not resolve that alias into a spawn. |

## Mini-bosses

| Encounter | Body | Count | When | Clear |
| --- | --- | --- | --- | --- |
| `enc_catalogue_walks` | Crawler, wraiths as margins | 1 + 2 | Volume clock: hours 15–17, every second day. Yard only. Does not arm if the basket circle is still up | Name the line. Do not finish a wraith. Tooth only then |
| `enc_rib_basket` | `hyb_ribwolf` | 2 | Hours 11–13, every second day. Yard only | Cut the lash. Leave the rib. Charge still happens |
| `enc_returned_kill` | `faun_ash_wolf` | 4 | Hours 18–20 when the volume day index modulo 3 is 0. Open between the two capitals | Count them. Step out of the kill. No hide |
| `enc_late_breath` | `mon_ruins_wraith` | 1 | Hours 18–20 when that index modulo 3 is 1. Archivist edge of the same open | Break both bangles. Leave the cloth. It stays unfinished |

## Boss

`enc_unfinished`. Volume clock: hours 21–23, every third day. Phases stay ask, staples, refuse the last line. `skill_steel_unburial` opens staples. `skill_presence_lament` at rank 3 or higher, or an interact during the ask, closes the page without a gore finisher. Pure DPS stands the slab back up once. Wearing the mask fails the Refusal of Death and suppresses `item_rem_unfinished_mask`.

## Tokens

| id | Drops from | Suppressed when |
| --- | --- | --- |
| `item_rem_unfinished_mask` | Page closed, mask refused | The mask was worn |
| `item_rem_catalogue_tooth` | Line broken, margins unfinished | The crawler was killed as a road, or a wraith was finished |

No remembrance id is added for the basket, the returned kill, or the late breath.

## Quests in this slice

| id | Giver | Starts when | Does not replace |
| --- | --- | --- | --- |
| `q_s07_open_carry` | `npc_role_ruins_keeper` | At the archivist capital | `q_ruins_crow_catalogue`, `q_ruins_unstack` |
| `q_s07_basket_left` | same role | `bone_yard` has a transform | `q_ruins_lizard_rib` |
| `q_s07_mask_to_shelf` | same role | `item_rem_unfinished_mask` is already in the pack | `q_ruins_mask_scout` |
| `q_s07_tooth_not_chit` | same role, Thren speaks the price once | `item_rem_catalogue_tooth` is already in the pack | `q_ruins_fourth_plan` |

Faction deltas use `ruins_archivists` and, on the tooth, `ruins_scavenger_crews` at −1. No quest grants a skill. No quest mints a token.

## Unspawned canon seeds

`ruin_rat_king`, `ash_revenant`, and `gloom_stalker` are in `Canon/sovereign-ruins/creatures.json` and have no bible species id. They do not receive encounter windows.
