# Catalog — S03 Sundering creatures

Eight creature rows, three mini-bosses, one boss. Caps are alive-at-once for the Fantasy instance. Volume weights are unchanged.

| id | Name | Where | Cap | Law | Temper |
| --- | --- | --- | --- | --- | --- |
| `faun_sunder_wolf` | Sundering Wolf | One pack, dusk–night, on a legal hill origin or in wardwood, never both | 6 | Hunt outward. The vine snare is not a tool | Pack. Aggro if pressed or if you stand in the kill |
| `faun_ash_wolf` | Catalogue Wolf | NE pad, x ≥ 28 and outside the 56 m wall | 4 on the Fantasy side | Return to the kill and leave it | Pack. Same rig as the pine wolf, ash material |
| `faun_dust_wolf` | Dome Wolf | Frontier range | 0 here, including quests | Pale coat on the verge is salt or resin on a pine wolf | Absent |
| `faun_wardwood_boar` | Wardwood Boar | Oak pockets by day, off the ward path | 5 | Shoulder is the take. A curse-marked tusk is not loot | Prey. Charges if cornered |
| `faun_cursefold_owl` | Cursefold Owl | Night, curse-stones outside both fold circles, after the shrine set exists | 3 | A scream means the fold already turned | Perch |
| `faun_blackroot_elk` | Blackroot Elk | `blackroot_road` meadows at dawn, after that set exists | 6 adults, 0 calves | Antlers are shed bark | Herd. Calf stays on the old quest |
| `faun_grove_finch` | Veil Finch | Day, legal hill origins and wardwood edge, pine dust | 12 | Quiet Grove holds none | Flock |
| `faun_pinewood_stag` | Pinewood Stag | Grove side of the Pinewood post | 0 added | S01 cap of 5 is the herd | Read-only from this slice |

## Mini-bosses

| Encounter | Body | Count | When | Offer |
| --- | --- | --- | --- | --- |
| `enc_fold_basilisk` | `mon_sunder_basilisk` | 1 | Volume clock: fold noon, every second day. Floor only, shrine set placed | Stillness. Move on the hood windup |
| `enc_ashfang_seam` | `hyb_ashfang` | 2 | Morning, hours 7–10, every second day. Same ash stand as the catalogue wolves | A plate you could wear. Break the seam and leave it |
| `enc_cursebeak_lip` | `hyb_cursebeak` | 1 | Hours 15–17, every third day, never on a Held Curse dusk. Lip only | One peck after the hood. Fold inward or leave the line |

None of those refuses is the boss refuse tag. `skill_steel_curse_fold` rank 5 still waits on `boss:held_curse_refused`.

## Boss

| id | Name | Where | Clock |
| --- | --- | --- | --- |
| `mon_boss_held_curse` | The Held Curse | Fold floor, shrine set placed. Overlook is scout-only | Volume: dusk, hours 19–22, every third day |

Serpentine. Crest is the only vertical. Gold opens and closes. No adds. Not a mount. Not the Crown's dragon.

## Cited, not restaged

`enc_milepost_fold` on `mon_sunder_griffin`. Fantasy side of the Pinewood seam. The post stays Hub. The north hills do not receive it.

## Quests in this slice

| id | Giver | Turn-in | Does not replace |
| --- | --- | --- | --- |
| `q_s03_ash_return` | Sundering ward, NE margin | Same ward | `q_ruins_crow_catalogue` |
| `q_s03_not_a_dome_wolf` | Sundering ward, pine verge | Same ward | `q_hub_pinewood_milepost` |
| `q_s03_quiet_count` | Thorne (`thorne`, sheet `thorne_blackroot`) | Thorne | `q_fantasy_elk_calf`, `q_fantasy_held_offer` |
| `q_s03_inward_howl` | Velora Mossheart | Velora | `q_fantasy_boar_off_path` |

## Unspawned seeds

`thorn_wolf`, `mana_drake`, `bone_sentinel`, `gloom_stalker`, `crystal_elemental`. Topologies in the seed file are real. Ids in the bible are not, so the bodies stay absent.

## Weights already shipped

Wolf 4, boar 2, owl 2, elk 1, finch 3, stag 1. Basilisk 0. Griffin 0. Ash and dust weights live on the Ruins and Frontier blocks and are not edited.

## Places with coordinates

Lane x = 11.2, half-width 2.6 m, z to 240. Wall 56 m. Hub flower disk 42 m, not in force here. NE pad center (28, 70), extents 18 m by 27.5 m; ash stands need x ≥ 28 and a center outside the wall. Pinewood Crossing (62, −28).

Hill origins that stay empty: `CourtWalkHill_Near_0` (72° at 48 m), `Near_1` (90° at 52 m), `Near_2` (108° at 50 m), and `CourtWalkHill_Mid_1` (90° at 128 m). The first three are inside the wall. Near_0 and Mid_1 still block the stride after the builder's single shift. Legal stands are the other near and mid origins, at the shifted point, not on a skirt that crosses the lane. The 90°/74 m origin is a legal stand. Its 14 m skirt is not.

S04's pantheon temple (14.24, 23.34), wildwood gate (−29.55, 37.82), and salt toll (62, −20) are not fauna floors. Fold, Quiet Grove, blackroot road, wardwood interior, Thornwood, and the bog have lore names and no Canon.cs point. Until a named set is placed, its creatures spawn nothing.
