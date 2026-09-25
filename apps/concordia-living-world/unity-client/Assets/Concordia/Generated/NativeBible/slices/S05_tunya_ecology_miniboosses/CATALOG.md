# Catalog — S05 Tunya ecology

Eight creature rows, two hybrid windows, one volume event treated as a mini-boss. Caps are alive-at-once for the Tunya instance. Volume weights are unchanged. No region-boss id.

| id | Name | Where | Cap | Place in the veil | Temper |
| --- | --- | --- | --- | --- | --- |
| `faun_nil_sealie` | Nil Sealie | `nil_shoal_stair` after the set exists | 4 | Shelf fisher. Not harvest, not a ship-killer | Bask. Lunge at fish |
| `faun_veil_hound` | Veil Hound | With labor on `terrace_farm` | 4 | Herds goats, bays a root-tear | Working. Reed collar |
| `faun_terrace_goat` | Terrace Goat | Weed strips between solar tile and vine | 8 | Keeps the tiles clear. The graft is not pasture | Herd. Lead, do not ride |
| `faun_pollen_hare` | Pollen Hare | Terrace floor in bloom weeks | 6, and 0 off bloom | Prey. Gold is pollen and washes off | Freeze, then bolt |
| `faun_ark_heron` | Ark Heron | Irrigation cuts, day | 3 | Wader. A folded bird is alive, not a relic | Still, then spear |
| `faun_grove_finch` | Veil Finch | Terrace and canopy edge, day, pollen dust | 10 | Moves seed along the lips | Flock |
| `mon_tunya_harpy` | Veil Harpy | Canopy visits, not constant | 4, and 0 while the twelfth window owns them | Thief of fruit and tools. A trunk is the crime | Skirmisher |
| `mon_tunya_reapjackal` | Reap Jackal | Wounded terrace edge | 5, and 0 while the twelfth window owns them | Eats the root. A breach, not game | Flank, then tear |

## Mini-bosses

| Encounter | Body | Count | When | Offer |
| --- | --- | --- | --- | --- |
| `enc_twelfth_reap` | `mon_tunya_harpy` dressed as alpha, `mon_tunya_reapjackal` as the pack | 1 + 4 | Volume clock: grove morning, hours 6–9, every third day. Lip outside the closed district, once that lip is placed | Fruit as the fine. Blood and pinions are the wrong payment |
| `enc_pollen_sleep` | `hyb_pollenwyrm` | 1 | Hours 11–13, every second day. Deep shade past the last terrace. Not on a twelfth morning | Sleep. Leave on the bee tell. One burst sac, then go |
| `enc_graft_charge` | `hyb_veilstag` | 1 | Hours 14–16, every fourth day, not during the twelfth window. Terrace lip only | An antler. Leave it. The pollen on the scar is the ward |

None of these is a boss refuse tag. There is no Tunya boss tag to stamp.

## Boss

None. Taxonomy's Tunya monsters are the harpy and the jackal. `enc_twelfth_reap` already spends those meshes. A new `mon_boss_` body is a catalog change, and this slice does not make it.

## Cited, not restaged

Volume phases of `enc_twelfth_reap`: tool theft, reap attempt, fine. Remembrance `item_rem_reap_talon` stays the volume item. `skill_presence_do_not_reap` already staggers the alpha in phase 2.

`hyb_veilstag` lists Fantasy among its worlds. S03 did not stage it. This slice adds a Fantasy cap of 0 and does not edit S03.

`faun_grove_finch` on the Sundering keeps S03's cap of 12 and the pine-dust coat. Tunya uses pollen dust and the cap in the table above.

## Quests in this slice

| id | Giver | Turn-in | Does not replace |
| --- | --- | --- | --- |
| `q_s05_weed_between_tiles` | Veil labor, lower terrace | Same laborer | `q_tunya_terrace_bell` |
| `q_s05_not_an_orca` | Veil merchant, baskets | Same merchant | `q_tunya_sealie_not_bird` |
| `q_s05_hound_off_the_root` | Veil labor, wounded edge | Same laborer | `q_tunya_reap_fine`, `q_tunya_twelfth_edge` |
| `q_s05_photonic_second` | Veil merchant, irrigation lip | Same merchant | `q_tunya_heron_hold`, the Arks of Memory chain |
| `q_s05_hull_stays_empty` | Veil labor, upper stall | Same laborer, on the terrace | `q_s06_threshold_unmet`, both Arks of Memory quests, `q_s05_photonic_second` |

Givers sit inside the density budgets: labor 6, merchant 3. No new role. No skill grant.

## Ark place

The name "ark fauna" is the heron's memory and the sealie's age. The bodies stay where the bible spawn lines put them.

| Ark | Ground | Fauna from this slice |
| --- | --- | --- |
| Africa | Hold of First Arrival, no CountryCenter | 0. The hold quest and Torrek's three panels already own it |
| North America | Asbir Ark (−90, −58) | 0 within 40 m. Exterior sand may be walked. Door stays shut |
| Eurasia | Bahiij, Dormas, Fluxom, Dinye | 0. No elephant id, no dye-bug id |
| South America | Aekon fold, twelfth lip | The twelfth window only, after the lip is placed. Glacier gate stays empty |
| Antarctica | No landfall | 0. Berths went to Africa before launch |
| Unpinned remainder | Seven arks in the launch entry; four landings pinned | 0. No invented wreck |
| Vessine ship | Crash and stillrooms | 0. Not an Earth ark |

`verdant_veil` on the quest deltas is the laborer's standing book in `ROLES.json` and the volume Tunya list. It is not a row in `factions.json`. This slice does not add one.

## Unspawned

The orca-horn sealie. It is a real row, `sealies`, in `content/world/tunya/bestiary.json`, and it is absent from `Canon/tunya/`. No bible mesh, so it stays quiet. Ivory, blubber, and the dye sac are not drops. A flamingo bind. A parrot harpy. Bahiij's elephant. The cactem dye-bug. Asbir's shellfish, which is paper, not a mob. The content herd that is not `faun_terrace_goat`. `hyb_dawnjackal`.

## Weights already shipped

Sealie 2, hound 3, goat 3, hare 3, heron 1, finch 4, harpy 2, jackal 2. Pollenwyrm and veil stag are not in the Tunya density fauna list. Their ambient weight stays 0. They exist as the two new windows.

## Places with coordinates

Nil Threshold (18, −8) and radius 22 are the political center, not the shoal. Aekon Glacier Gate (−15, 68) is not the twelfth lip. Asbir Ark (−90, −58) receives no fauna from this facet. Fluxom Gate (62, 18) is not Pinewood Crossing (62, −28) and receives no sealie. Masond has no `country_id` row, so the Hold of First Arrival has no CountryCenter. `nil.extends_world` says `sovereign-ruins` and `asbir.extends_world` says `lattice-crucible`. Lore keeps both on Tunya. Animals do not follow those strings.

Flower Law stays a Hub disk of 42 m. The Tunya gate is at 3π/4.
