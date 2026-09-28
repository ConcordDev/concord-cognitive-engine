# Audio-visual cue sheets (B30)

Source: `~/.zuko/lookfeel/FEEL_AUDIO_VISUAL_CUES.md`. Machine rows: `CUE_SHEETS.json`.

Every row has `audio_file: null`. The shape and the color carry the tell. A later pass may hang a clip on the same id. This slice writes no wav, no stinger, and no gallop loop.

Shared timing: a telegraph stays under half a second. A law the player must read may run longer. Reduced motion holds the end shape. Spoils are things on the ground. No rainbow loot beam. No rarity pillar.

## Spoils

| Id | Visual | Mesh this slice |
| --- | --- | --- |
| `cue_spoil_petal` | one flat petal, `#c8721a`, inside 42 m | new `prop_hub_spoil_petal` |
| `cue_spoil_fruit` | at most three masses on the tree, tree uncut | none; `flora_tunya_terrace_tree` |
| `cue_spoil_ash` | pinch settles, `#b89060` | none |
| `cue_spoil_bill` | blank paper rectangle, `#c8a060` | new `prop_crime_spoil_bill` |
| `cue_spoil_digit` | dark token, cyan only in the missing corner | reuse `vfx_cyber_number_break` |
| `cue_spoil_rivet` | short iron bar, `#4a3828` | new `prop_frontier_spoil_rivet`, gated |
| `cue_spoil_tile` | chipped square, `#8a3030` | reuse `prop_brand_tile` |
| `cue_spoil_shard` | fat chip, lilac one frame, then stone | reuse `prop_unclosed_shard` |
| `cue_spoil_crest` | closed worn crest, `#c8a060` | new `prop_fantasy_spoil_crest` |

The petal is not `vfx_hub_cut_flower`. The bill is not `ui_board_crime_bill`. The rivet appears only after `item_rem_dome_rivet` has already dropped on the scout loop. Do not place the Last Dome and do not invent its mile. The ash pinch is not the ash cairn and not the ash page. The tile is a broken mark, not a gem. The shard is not the thrown weapon. The crest stays shut.

## Gossip

Peripheral. No new subtitle.

| Id | Tell | Visual |
| --- | --- | --- |
| `cue_gossip_court` | lantern ring on a passerby | `vfx_hub_flame_pool`, inside 42 m |
| `cue_gossip_coast` | one sodium chalk stroke | `vfx_crime_chalk_tick` |
| `cue_gossip_grid` | banner hem flickers once, word unchanged | no new mesh |
| `cue_gossip_frontier` | canvas snap, a shape in the dust | no voice |
| `cue_gossip_sere` | furnace eye shutters half a second | `env_sere_furnace_stack` |
| `cue_gossip_dawn` | one office window goes dark | no victory word |
| `cue_gossip_tunya` | a few pollen grains | `vfx_tunya_pollen_stance`, small |
| `cue_gossip_ruins` | a stele line does not grow | spawn nothing |
| `cue_gossip_crucible` | a seam ticks and stays open | `vfx_crucible_unclosed_seam` |
| `cue_gossip_sundering` | a gold scar stays dull | do not play the curse fold |

## Threats

The windup differs from the idle. The tell is in the world, under the feet or on the prop.

| Id | Shape | Color | Reads as |
| --- | --- | --- | --- |
| `cue_threat_melee` | thick ground wedge along the swing | world accent, see sheet | get off the wedge |
| `cue_threat_grab` | broken ankle ring | Coast `#e0b050`, Sere `#e07030` | step out before it closes |
| `cue_threat_count` | digit ring with a gap | `#3dffa0` | the gap is the safe bearing |
| `cue_threat_dust` | ankle-height fan | `#c8b070` | lateral, not a jump |
| `cue_threat_fold` | line closes on the attacker | `#c8a060` | `vfx_fantasy_curse_fold` |
| `cue_threat_mercy` | gold ring stops short | `#ffd0a0` | `vfx_dawn_mercy_stop` |
| `cue_threat_unclosed` | teal crack opens again | `#20ffd0` | `vfx_crucible_unclosed_seam` |
| `cue_threat_ash` | vertical line that ends | `#b89060` | the ending fails |
| `cue_threat_harvest` | circle on the tree | `#c8721a` | striking the tree is the mistake |
| `cue_threat_mark` | tile lights under one foot | `#8a3030` | move before the compound |
| `cue_threat_aerial` | shadow disc grows | `#2a241c` | griffin, harpy, dustgriffin |

Melee accents: Hub `#c8721a`, Fantasy `#c8a060`, Tunya `#c8721a`, Ruins `#b89060`, Crime `#e0b050`, Cyber `#3dffa0`, Frontier `#c8b070`, Dawn `#ffd0a0`, Crucible `#20ffd0`, Sere `#8a3030`. Ruins uses amber so the wedge reads. Crime uses sodium, not the bill gold.

The steel wedge is `vfx_steel_ground_wedge`. Inside 42 m, Ward Cut stays `vfx_hub_cut_flower`. The grab is `vfx_invoice_ankle_gap`. The dust fan is `vfx_frontier_dust_fan`. The ash stop is `vfx_ruins_ash_stop`. The harvest ring is `vfx_tunya_harvest_ring` on the terrace tree. Those five cards already exist. This sheet does not re-prompt them.

Aerial parents already exist: `mon_sunder_griffin`, `mon_tunya_harpy`, `hyb_dustgriffin`. The disc is the tell. No scream file.

## Contact

The windup is the telegraph. Contact is the next beat. It still has no clip. Rows live in `CUE_CONTACTS_CYCLE2.json` and in the same `CUE_SHEETS.json` array. No new mesh.

| Id | After | Visual | Law |
| --- | --- | --- | --- |
| `cue_contact_steel` | melee wedge | `vfx_steel_ground_wedge` ticks once | not inside 42 m |
| `cue_contact_flower` | flower-law flash | `vfx_hub_cut_flower` | inside 42 m; do not also spawn the wedge |
| `cue_contact_invoice` | ankle gap | pack `vfx_Impact_01` once | the gap stays open |
| `cue_contact_dust` | dust fan | the same fan settles | no shockwave, no dome |
| `cue_contact_ash` | ash stop | pack `vfx_Smoke_01` once | the puff must not column |
| `cue_contact_harvest` | harvest ring | ring stays on the tree | no spark on the player |
| `cue_contact_mercy` | mercy ring | `vfx_dawn_mercy_stop` | no Impact on that body |
| `cue_contact_aerial` | shadow disc | disc stops on the ground | no scream file |
| `cue_contact_count` | digit ring | gap stays empty | no digit |
| `cue_contact_fold` | curse line | line stays on the attacker | not a flamethrower |
| `cue_contact_unclosed` | teal crack | seam stays open | construct cap stays 0 |
| `cue_contact_mark` | lit tile | tile dulls | no flame tongue |

Dawn street jab and cross still use Impact. They are not `cue_contact_mercy`. Invoice keeps the thrust tick and does not close the ring.

## Screen tint

`cue_flash_flower_law` tints the existing grade inside the 42 m disk when a blade becomes a flower. `cue_flash_furnace_eye` tints the existing grade when the furnace eye is seen through a window. Neither is a white hit. Toasts stay the B29 chrome. A threat is not a HUD flash.

## Refused

No gunshot language. No mount gallop loop. No musical stinger ids. No aerial scream file. `Pistol_*` stays unbound. No rifles.
